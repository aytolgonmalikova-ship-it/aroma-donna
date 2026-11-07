// C3.3, этап 3: обработчик /api/order до обращения к базе (поддельный Admin SDK), безопасный выбор
// режима Admin SDK, тестовая проверка App Check и отсутствие серверных секретов в клиентском коде.
// Полные сценарии с эмуляторами — tests-emulator/orderApi.emulator.js (npm run test:rules). Запуск: npm test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { handleOrder } from '../api/_lib/orderHandler.js';
import { MAX_BODY_BYTES } from '../api/_lib/orderCore.js';
import { createTestAppCheckToken, resolveAdminConfig } from '../api/_lib/firebaseAdmin.js';
import orderFunction from '../api/order.js';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const SECRET = 'h'.repeat(40);
const ENV = { ORDER_HMAC_SECRET: SECRET };
const RID = '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const GSID = '9a8b7c6d-5e4f-4321-9abc-def012345678';
const body = (over = {}) => ({
  requestId: RID,
  items: [{ productId: 'rose-poudree', volume: 30, quantity: 1 }],
  promoCode: null,
  deliveryMethod: 'pickup',
  paymentMethod: 'cashOnDelivery',
  customer: { name: 'Айгерим', lastName: 'Асанова', phone: '700123456', email: 'a@mail.kg' },
  shipping: { comment: '' },
  agree: true,
  expectedTotal: 1000,
  ...over,
});

/** Поддельный Admin SDK: обращения к базе запрещены (эти проверки должны срабатывать раньше) */
function fakeAdmin({ verifyIdToken, verifyAppCheck } = {}) {
  const calls = [];
  const db = new Proxy({}, { get: (_, name) => () => { calls.push(String(name)); throw new Error(`обращение к базе: ${String(name)}`); } });
  return {
    calls,
    admin: {
      db,
      auth: { verifyIdToken: verifyIdToken || (async () => { throw Object.assign(new Error('x'), { code: 'auth/argument-error' }); }) },
      verifyAppCheck: verifyAppCheck || (async () => { throw new Error('app-check'); }),
    },
  };
}
const call = (over) => handleOrder({ method: 'POST', headers: {}, body: body(), socketAddress: '127.0.0.1', env: ENV, ...over });

test('метод, размер (16 КБ) и разбор тела: 405, 413, 400 — до обращения к базе', async () => {
  const { admin, calls } = fakeAdmin();
  assert.equal((await call({ method: 'GET', deps: { admin } })).status, 405);
  assert.equal((await call({ headers: { 'content-length': String(MAX_BODY_BYTES + 1) }, deps: { admin } })).status, 413);
  const big = body({ shipping: { comment: 'x'.repeat(MAX_BODY_BYTES) } });
  assert.equal((await call({ body: big, deps: { admin } })).status, 413);
  assert.equal((await call({ body: 'x'.repeat(MAX_BODY_BYTES + 1), deps: { admin } })).status, 413);
  const bad = await call({ body: '{не json', deps: { admin } });
  assert.deepEqual([bad.status, bad.body.error], [400, 'bad_json']);
  for (const b of [null, 5, undefined]) assert.equal((await call({ body: b, deps: { admin } })).status, 400);
  assert.deepEqual(calls, []);
});

test('без секретов — 503 not_configured, а не небезопасный режим', async () => {
  const { admin } = fakeAdmin();
  for (const env of [{}, { ORDER_HMAC_SECRET: 'short' }]) {
    const r = await call({ env, deps: { admin } });
    assert.deepEqual([r.status, r.body.error], [503, 'not_configured']);
  }
  const r = await call({ env: ENV, deps: { admin: { error: 'not-configured' } } });
  assert.equal(r.status, 503);
  // Реальная функция без переменных окружения: 503, ничего не отправлено
  const res = { code: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  const saved = { ...process.env };
  for (const k of ['FIREBASE_SERVICE_ACCOUNT_B64', 'ORDER_HMAC_SECRET', 'FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) delete process.env[k];
  try {
    await orderFunction({ method: 'POST', headers: {}, body: body({ guestSessionId: GSID }), socket: {} }, res);
  } finally {
    process.env = saved;
  }
  assert.deepEqual([res.code, res.body.error, res.headers['Cache-Control']], [503, 'not_configured', 'no-store']);
});

test('строгая схема: items: [null], лишние поля (userId, total, paymentStatus) — 400 до базы', async () => {
  const { admin, calls } = fakeAdmin();
  for (const b of [body({ items: [null] }), body({ userId: 'victim' }), body({ total: 1 }), body({ paymentStatus: 'paidDemo' }), body({ items: Array(21).fill({ productId: 'a', volume: 1, quantity: 1 }) })]) {
    const r = await call({ body: b, deps: { admin } });
    assert.deepEqual([r.status, r.body.error], [400, 'invalid_request'], JSON.stringify(b).slice(0, 60));
  }
  assert.deepEqual(calls, []);
});

test('вошедший: неверный, просроченный, отозванный токен — 401; в гостевой режим не переключается', async () => {
  for (const [code, expected] of [['auth/id-token-expired', 'auth_expired'], ['auth/id-token-revoked', 'auth_revoked'], ['auth/user-disabled', 'auth_revoked'], ['auth/argument-error', 'auth_invalid']]) {
    let appCheckCalled = false;
    const { admin, calls } = fakeAdmin({
      verifyIdToken: async (_t, checkRevoked) => {
        assert.equal(checkRevoked, true, 'verifyIdToken(token, true)');
        throw Object.assign(new Error(code), { code });
      },
      verifyAppCheck: async () => { appCheckCalled = true; },
    });
    const r = await call({ headers: { Authorization: `Bearer ${'a'.repeat(40)}` }, body: body({ guestSessionId: GSID }), deps: { admin } });
    assert.deepEqual([r.status, r.body.error], [401, expected]);
    assert.equal(appCheckCalled, false, 'App Check гостя не проверялся — гостевого пути нет');
    assert.deepEqual(calls, []);
  }
  // Заголовок не в формате Bearer
  const { admin } = fakeAdmin();
  for (const h of ['Basic abc', 'Bearer', 'Bearer a b', 'bearer abcdefghijklmnopqrstuvwxyz']) {
    const r = await call({ headers: { Authorization: h }, deps: { admin } });
    assert.deepEqual([r.status, r.body.error], [401, 'auth_invalid'], h);
  }
});

test('гость: без guestSessionId — 400; без App Check или с неверным — 403, обхода нет', async () => {
  const { admin, calls } = fakeAdmin();
  const noSession = await call({ deps: { admin } });
  assert.deepEqual([noSession.status, noSession.body.error, noSession.body.fields], [400, 'invalid_request', { guestSessionId: 'required' }]);
  const missing = await call({ body: body({ guestSessionId: GSID }), deps: { admin } });
  assert.deepEqual([missing.status, missing.body.error], [403, 'app_check_required']);
  const invalid = await call({ headers: { 'X-Firebase-AppCheck': 'x'.repeat(50) }, body: body({ guestSessionId: GSID }), deps: { admin } });
  assert.deepEqual([invalid.status, invalid.body.error], [403, 'app_check_failed']);
  assert.deepEqual(calls, []);
});

test('ответы об ошибках — без трассировок, токенов и персональных данных', async () => {
  const { admin } = fakeAdmin({ verifyIdToken: async () => { throw new Error('secret stack at /var/task/x.js'); } });
  const r = await call({ headers: { Authorization: `Bearer ${'t'.repeat(40)}` }, deps: { admin } });
  const text = JSON.stringify(r.body);
  assert.doesNotMatch(text, /stack|\/var\/task|tttttttt|Айгерим|700123456/);
  assert.equal(r.headers['Cache-Control'], 'no-store');
});

test('Admin SDK: эмулятор — только demo-проект, оба эмулятора, не на Vercel, без рабочего ключа', () => {
  const emu = { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', GCLOUD_PROJECT: 'demo-aroma-donna' };
  assert.deepEqual(resolveAdminConfig(emu), { mode: 'emulator', projectId: 'demo-aroma-donna' });
  assert.equal(resolveAdminConfig({ ...emu, GCLOUD_PROJECT: 'aroma-donna' }).error, 'emulator-not-demo');
  assert.equal(resolveAdminConfig({ ...emu, VERCEL: '1' }).error, 'emulator-on-vercel');
  assert.equal(resolveAdminConfig({ FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', GCLOUD_PROJECT: 'demo-aroma-donna' }).error, 'emulator-incomplete');
  assert.equal(resolveAdminConfig({ ...emu, FIREBASE_SERVICE_ACCOUNT_B64: 'eA==' }).error, 'emulator-with-credentials');
  assert.equal(resolveAdminConfig({}).error, 'not-configured');
  assert.equal(resolveAdminConfig({ FIREBASE_SERVICE_ACCOUNT_B64: '!!!' }).error, 'credentials-invalid');
  const fake = (o) => Buffer.from(JSON.stringify({ type: 'service_account', project_id: 'aroma-x', client_email: 'a@b', private_key: 'k', ...o })).toString('base64');
  assert.equal(resolveAdminConfig({ FIREBASE_SERVICE_ACCOUNT_B64: fake({ type: 'user' }) }).error, 'credentials-invalid');
  assert.equal(resolveAdminConfig({ FIREBASE_SERVICE_ACCOUNT_B64: fake({ project_id: 'demo-x' }) }).error, 'credentials-demo-project');
  assert.equal(resolveAdminConfig({ FIREBASE_SERVICE_ACCOUNT_B64: fake() }).mode, 'production');
});

test('тестовый App Check: формат и подпись токена; в коде рабочего режима — verifyToken(…, { consume: true })', () => {
  const token = createTestAppCheckToken('s'.repeat(40), { nonce: 'abcdefgh12', now: 1_000_000_000_000 });
  assert.match(token, /^test\.abcdefgh12\.\d{13}\.[0-9a-f]{64}$/);
  const src = read('api/_lib/firebaseAdmin.js');
  assert.match(src, /verifyToken\(token, \{ consume: true \}\)/);
  assert.match(src, /if \(result\.alreadyConsumed\)/);
  // Тестовая проверка доступна только в режиме эмулятора
  assert.match(src, /verifyAppCheck: config\.mode === 'production' \? productionAppCheck\(app\) : emulatorAppCheck\(db, env\)/);
  assert.match(src, /if \(env\.VERCEL\) return \{ error: 'emulator-on-vercel' \}/);
});

test('серверные секреты не попадают в клиентский код: src/ не импортирует firebase-admin и api/_lib; нет имён секретов', () => {
  const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
  for (const file of walk(join(ROOT, 'src')).filter((f) => /\.(js|jsx)$/.test(f))) {
    const code = readFileSync(file, 'utf8');
    assert.doesNotMatch(code, /firebase-admin|api\/_lib|FIREBASE_SERVICE_ACCOUNT|ORDER_HMAC_SECRET|APP_CHECK_TEST_SECRET|TELEGRAM_BOT_TOKEN/, file);
  }
  // Сборка (если есть): ни имён секретов, ни Admin SDK
  const dist = join(ROOT, 'dist');
  if (existsSync(dist)) {
    for (const file of walk(dist).filter((f) => /\.(js|html|css)$/.test(f))) {
      const code = readFileSync(file, 'utf8');
      assert.doesNotMatch(code, /firebase-admin|FIREBASE_SERVICE_ACCOUNT|ORDER_HMAC_SECRET|APP_CHECK_TEST_SECRET|private_key|BEGIN PRIVATE KEY/, file);
    }
  }
});

test('диагностика App Check: в лог — только код ошибки, без токена и текста ошибки', async () => {
  const token = `tok.${'s'.repeat(60)}`;
  const logs = [];
  const original = console.warn;
  console.warn = (...args) => logs.push(args.join(' '));
  try {
    const run = async (verifyAppCheck, headers) => {
      const { admin } = fakeAdmin({ verifyAppCheck });
      return call({ headers, body: body({ guestSessionId: GSID }), deps: { admin } });
    };
    const missing = await run(undefined, {});
    const rejected = await run(async () => { throw Object.assign(new Error(`Decoding failed: ${token}`), { code: 'app-check/invalid-argument' }); }, { 'X-Firebase-AppCheck': token });
    const weird = await run(async () => { throw Object.assign(new Error(token), { code: `bad code ${token}` }); }, { 'X-Firebase-AppCheck': token });
    assert.deepEqual([missing.status, rejected.status, weird.status], [403, 403, 403]);
  } finally {
    console.warn = original;
  }
  assert.deepEqual(logs, [
    '[order] App Check: нет заголовка X-Firebase-AppCheck',
    '[order] App Check отклонён: app-check/invalid-argument',
    '[order] App Check отклонён: unknown',
  ]);
  assert.ok(logs.every((l) => !l.includes(token) && !l.includes('Decoding')));
});
