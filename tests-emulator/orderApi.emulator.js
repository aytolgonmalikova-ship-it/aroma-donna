// C3.3, этап 3: серверное оформление заказа (/api/order) с настоящим Firebase Admin SDK на эмуляторах
// (Auth + Firestore, проект demo-aroma-donna). Telegram подменён — наружу ничего не уходит.
// Запуск: npm run test:rules. Рабочий Firebase не используется: Admin SDK в режиме эмулятора работает
// только с demo-проектом (api/_lib/firebaseAdmin.js).
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, collectionGroup, doc, getDoc, getDocs } from 'firebase/firestore';
import { handleOrder } from '../api/_lib/orderHandler.js';
import { createTestAppCheckToken, getAdmin } from '../api/_lib/firebaseAdmin.js';
import { keys } from '../api/_lib/orderCore.js';
import { notifyOrder } from '../api/_lib/orderStore.js';
import { products } from '../src/data/products.js';
import { toFirestoreProduct } from '../src/utils/products.js';
import { calcDelivery, calcDiscount } from '../src/utils/promo.js';

const PROJECT = 'demo-aroma-donna';
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;
const FS = `http://${process.env.FIRESTORE_EMULATOR_HOST}`;
const SECRET = 'order-hmac-secret-for-emulator-tests-only-0123456789';
const APP_CHECK_SECRET = 'app-check-test-secret-for-emulator-only-0123456789';
const ENV = {
  FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST,
  FIREBASE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST,
  GCLOUD_PROJECT: PROJECT,
  ORDER_HMAC_SECRET: SECRET,
  APP_CHECK_TEST_SECRET: APP_CHECK_SECRET,
  TELEGRAM_BOT_TOKEN: '123:test',
  TELEGRAM_CHAT_ID: '1',
};

const inStock = products.filter((p) => p.availability === 'inStock');
const A = inStock[0];
const B = inStock[1];
const HIDDEN = inStock[2];
const OUT = inStock[3];
const smallest = (p) => [...p.volumes].sort((x, y) => x.price - y.price)[0];
const largest = (p) => [...p.volumes].sort((x, y) => y.price - x.price)[0];

let admin;
let rulesEnv;
let telegram; // { calls, mode: 'ok' | 'fail' | 'throw' | 'slow' }
let ipCounter = 0;

const uuid = () => crypto.randomUUID();
const totalFor = (items, { promo = null, delivery = 'pickup' } = {}) => {
  const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
  const discount = calcDiscount(subtotal, promo);
  return subtotal - discount + calcDelivery(delivery, subtotal - discount);
};
function orderBody(over = {}) {
  const v = smallest(A);
  return {
    requestId: uuid(),
    guestSessionId: uuid(),
    items: [{ productId: A.id, volume: v.ml, quantity: 1 }],
    promoCode: null,
    deliveryMethod: 'pickup',
    paymentMethod: 'cashOnDelivery',
    customer: { name: 'Айгерим', lastName: 'Асанова', phone: '700123456', email: 'aigerim@example.com' },
    shipping: { comment: '' },
    agree: true,
    expectedTotal: totalFor([{ price: v.price, quantity: 1 }]),
    ...over,
  };
}
const fakeFetch = async () => {
  telegram.calls++;
  if (telegram.mode === 'throw') throw new TypeError('fetch failed');
  if (telegram.mode === 'slow') await new Promise((r) => setTimeout(r, 300));
  return telegram.mode === 'fail' ? { ok: false, status: 500, json: async () => ({ ok: false }) } : { ok: true, status: 200, json: async () => ({ ok: true }) };
};
/** Запрос к обработчику: гость (App Check) или вошедший (ID-токен) */
function post(body, { token, appCheck = true, ip, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  else if (appCheck === true) h['x-firebase-appcheck'] = createTestAppCheckToken(APP_CHECK_SECRET);
  else if (typeof appCheck === 'string') h['x-firebase-appcheck'] = appCheck;
  return handleOrder({ method: 'POST', headers: h, body, socketAddress: ip || `198.51.100.${(ipCounter++ % 250) + 1}`, env: ENV, deps: { fetchImpl: fakeFetch } });
}
async function signUp(email) {
  const res = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'secret-123456', returnSecureToken: true }),
  });
  const data = await res.json();
  assert.ok(data.idToken, JSON.stringify(data));
  return { uid: data.localId, token: data.idToken };
}
async function clearFirestore() {
  await fetch(`${FS}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
}
async function seed() {
  const batch = admin.db.batch();
  for (const p of [A, B, OUT]) batch.set(admin.db.collection('products').doc(p.id), { ...toFirestoreProduct(p), updatedAt: new Date() });
  batch.set(admin.db.collection('products').doc(HIDDEN.id), { ...toFirestoreProduct(HIDDEN), hidden: true, updatedAt: new Date() });
  batch.update(admin.db.collection('products').doc(OUT.id), { availability: 'outOfStock' });
  await batch.commit();
}
const allOrders = async () => (await admin.db.collectionGroup('orders').get()).docs;

before(async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST, 'запускайте через npm run test:rules');
  admin = getAdmin(ENV);
  assert.equal(admin.mode, 'emulator');
  assert.equal(admin.projectId, PROJECT);
  rulesEnv = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') } });
});
beforeEach(async () => {
  telegram = { calls: 0, mode: 'ok' };
  await clearFirestore();
  await seed();
});
after(async () => {
  await rulesEnv?.cleanup();
});

describe('вошедший покупатель', () => {
  test('1. действительный токен: заказ в users/{uid}/orders, суммы и статусы — от сервера, Telegram отправлен', async () => {
    const user = await signUp(`u1-${Date.now()}@example.com`);
    const v = largest(B);
    const body = orderBody({ guestSessionId: undefined, items: [{ productId: B.id, volume: v.ml, quantity: 2 }], deliveryMethod: 'courier', paymentMethod: 'cardDemo', shipping: { region: 'bishkek', city: 'bishkek', address: 'ул. Токтогула, 12', comment: '' }, expectedTotal: totalFor([{ price: v.price, quantity: 2 }], { delivery: 'courier' }) });
    const r = await post(body, { token: user.token });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.order.total, body.expectedTotal);
    assert.doesNotMatch(JSON.stringify(r.body), /700123456|aigerim@|Токтогула/, 'ответ без персональных данных');
    const snap = await admin.db.doc(`users/${user.uid}/orders/${r.body.order.orderId}`).get();
    const order = snap.data();
    assert.equal(order.userId, user.uid);
    assert.equal(order.customerType, 'registered');
    assert.equal(order.paymentStatus, 'awaitingPayment');
    assert.equal(order.payment, 'cardDemo');
    assert.equal(order.status, 'new');
    assert.equal(order.items[0].price, v.price);
    assert.equal(order.customer.phone, '+996700123456');
    assert.equal(order.notification.status, 'sent');
    assert.equal(telegram.calls, 1);
    // Покупатель читает свой заказ по правилам; чужой — нет
    await assertSucceeds(getDoc(doc(rulesEnv.authenticatedContext(user.uid).firestore(), `users/${user.uid}/orders/${order.id}`)));
    await assertFails(getDoc(doc(rulesEnv.authenticatedContext('someone-else').firestore(), `users/${user.uid}/orders/${order.id}`)));
  });

  test('2. недействительный, просроченный и отозванный токен — 401; в гостевой режим не переключается', async () => {
    const user = await signUp(`u2-${Date.now()}@example.com`);
    const garbage = await post(orderBody(), { token: 'not-a-real-token-but-long-enough-xx' });
    assert.deepEqual([garbage.status, garbage.body.error], [401, 'auth_invalid']);
    // Просроченный: тот же токен эмулятора, но exp в прошлом
    const [h, p] = user.token.split('.');
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    const expired = `${h}.${Buffer.from(JSON.stringify({ ...payload, iat: payload.iat - 7200, exp: payload.iat - 3600, auth_time: payload.iat - 7200 })).toString('base64url')}.`;
    const exp = await post(orderBody(), { token: expired });
    assert.deepEqual([exp.status, exp.body.error], [401, 'auth_expired']);
    // Отозванный: refresh-токены отозваны после выдачи токена
    await new Promise((r) => setTimeout(r, 1100));
    await admin.auth.revokeRefreshTokens(user.uid);
    const rev = await post(orderBody(), { token: user.token });
    assert.deepEqual([rev.status, rev.body.error], [401, 'auth_revoked']);
    assert.equal((await allOrders()).length, 0);
    assert.equal(telegram.calls, 0);
  });

  test('5. подделка UID: userId в теле — 400; заказ всегда записывается на UID из токена', async () => {
    const user = await signUp(`u5-${Date.now()}@example.com`);
    const victim = await signUp(`victim-${Date.now()}@example.com`);
    const spoof = await post({ ...orderBody(), userId: victim.uid }, { token: user.token });
    assert.deepEqual([spoof.status, spoof.body.error, spoof.body.fields.userId], [400, 'invalid_request', 'unknown']);
    const ok = await post(orderBody(), { token: user.token });
    assert.equal(ok.status, 201);
    const orders = await allOrders();
    assert.deepEqual(orders.map((d) => d.ref.parent.parent.id), [user.uid]);
    assert.equal((await admin.db.collection(`users/${victim.uid}/orders`).get()).size, 0);
  });
});

describe('гость', () => {
  test('3. действительный App Check: заказ в guests/{guestKey}/orders, ключ без персональных данных; браузер его не читает', async () => {
    const body = orderBody();
    const r = await post(body);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.order.customerType, 'guest');
    assert.doesNotMatch(JSON.stringify(r.body), /700123456|aigerim@|Айгерим/);
    const guestKey = keys.guest(SECRET, body.guestSessionId);
    const snap = await admin.db.doc(`guests/${guestKey}/orders/${r.body.order.orderId}`).get();
    assert.ok(snap.exists);
    assert.equal(snap.get('userId'), null);
    assert.doesNotMatch(guestKey, /aigerim|700123456/);
    assert.notEqual(guestKey, body.guestSessionId);
    // Правила: ни гость, ни покупатель не читают гостевой заказ и служебные коллекции; администратор — читает
    const path = `guests/${guestKey}/orders/${r.body.order.orderId}`;
    await assertFails(getDoc(doc(rulesEnv.unauthenticatedContext().firestore(), path)));
    await assertFails(getDoc(doc(rulesEnv.authenticatedContext('customer-1').firestore(), path)));
    await assertFails(getDocs(collectionGroup(rulesEnv.authenticatedContext('customer-1').firestore(), 'orders')));
    for (const c of ['orderRequests', 'orderRateLimits', 'promoRedemptions', 'guests']) {
      await assertFails(getDocs(collection(rulesEnv.authenticatedContext('customer-1').firestore(), c)));
    }
    await admin.db.doc('admins/admin-1').set({ grantedAt: new Date(), grantedBy: 'console' });
    await assertSucceeds(getDoc(doc(rulesEnv.authenticatedContext('admin-1').firestore(), path)));
    const all = await getDocs(collectionGroup(rulesEnv.authenticatedContext('admin-1').firestore(), 'orders'));
    assert.ok(all.docs.some((d) => d.ref.path === path), 'гостевой заказ виден в общем запросе админки');
  });

  test('4. без App Check, с неверным, просроченным и повторно использованным токеном — 403', async () => {
    const none = await post(orderBody(), { appCheck: false });
    assert.deepEqual([none.status, none.body.error], [403, 'app_check_required']);
    const bad = await post(orderBody(), { appCheck: 'test.abcdefgh12.9999999999999.' + '0'.repeat(64) });
    assert.deepEqual([bad.status, bad.body.error], [403, 'app_check_failed']);
    const wrongSecret = await post(orderBody(), { appCheck: createTestAppCheckToken('another-secret-another-secret-another-secret') });
    assert.equal(wrongSecret.status, 403);
    const old = await post(orderBody(), { appCheck: createTestAppCheckToken(APP_CHECK_SECRET, { now: Date.now() - 10 * 60 * 1000 }) });
    assert.equal(old.status, 403);
    const once = createTestAppCheckToken(APP_CHECK_SECRET);
    assert.equal((await post(orderBody(), { appCheck: once })).status, 201);
    const reuse = await post(orderBody(), { appCheck: once });
    assert.deepEqual([reuse.status, reuse.body.error], [403, 'app_check_failed'], 'одноразовый токен');
    assert.equal((await allOrders()).length, 1);
  });
});

describe('подмена данных и товары', () => {
  test('6. подмена цены и суммы: цена в позиции — 400; неверная сумма — 409 с ценами сервера, заказа нет', async () => {
    const v = smallest(A);
    const priceInItem = await post(orderBody({ items: [{ productId: A.id, volume: v.ml, quantity: 1, price: 1 }] }));
    assert.equal(priceInItem.status, 400);
    const r = await post(orderBody({ expectedTotal: 1 }));
    assert.deepEqual([r.status, r.body.error], [409, 'total_changed']);
    assert.equal(r.body.lines[0].price, v.price);
    assert.equal(r.body.totals.total, totalFor([{ price: v.price, quantity: 1 }]));
    assert.equal((await allOrders()).length, 0);
    assert.equal(telegram.calls, 0);
  });

  test('7. paidDemo из браузера: поле paymentStatus — 400; cardDemo сохраняется как awaitingPayment', async () => {
    const r = await post({ ...orderBody(), paymentStatus: 'paidDemo' });
    assert.deepEqual([r.status, r.body.fields.paymentStatus], [400, 'unknown']);
    const pm = await post(orderBody({ paymentMethod: 'paidDemo' }));
    assert.equal(pm.status, 400);
    const ok = await post(orderBody({ paymentMethod: 'cardDemo' }));
    assert.equal(ok.status, 201);
    const [order] = await allOrders();
    assert.deepEqual([order.get('payment'), order.get('paymentStatus')], ['cardDemo', 'awaitingPayment']);
  });

  test('8–9. скрытый, удалённый, нет в наличии, недопустимый объём — 409 items_unavailable; 400 для нецелого объёма', async () => {
    const line = (p, ml) => ({ productId: p.id, volume: ml, quantity: 1 });
    const cases = [
      [line(HIDDEN, smallest(HIDDEN).ml), 'missing'],
      [{ productId: 'deleted-product', volume: 50, quantity: 1 }, 'missing'],
      [line(OUT, smallest(OUT).ml), 'outOfStock'],
      [line(A, 777), 'volumeUnavailable'],
    ];
    for (const [item, reason] of cases) {
      const r = await post(orderBody({ items: [item] }));
      assert.deepEqual([r.status, r.body.error, r.body.problems[0].reason], [409, 'items_unavailable', reason], item.productId);
    }
    assert.equal((await post(orderBody({ items: [{ productId: A.id, volume: 50.5, quantity: 1 }] }))).status, 400);
    assert.equal((await allOrders()).length, 0);
  });

  test('16–17. некорректные данные (items: [null], чужие типы, длинные строки) — 400; тело больше 16 КБ — 413', async () => {
    for (const b of [orderBody({ items: [null] }), orderBody({ items: 'x' }), orderBody({ customer: { name: 'А'.repeat(5000), lastName: 'Б', phone: '1', email: 'x' } }), orderBody({ shipping: [] })]) {
      assert.equal((await post(b)).status, 400);
    }
    const big = orderBody({ shipping: { comment: 'x'.repeat(17 * 1024) } });
    assert.deepEqual([(await post(big)).status], [413]);
    const r = await handleOrder({ method: 'POST', headers: { 'content-length': '20000' }, body: '{}', socketAddress: '127.0.0.1', env: ENV, deps: { fetchImpl: fakeFetch } });
    assert.equal(r.status, 413);
    assert.equal((await allOrders()).length, 0);
  });
});

describe('идемпотентность и гонки', () => {
  test('10. повтор с тем же requestId и тем же содержимым — тот же заказ, без нового заказа и уведомления', async () => {
    const body = orderBody();
    const first = await post(body);
    const second = await post(body);
    assert.equal(first.status, 201);
    assert.deepEqual([second.status, second.body.idempotent], [200, true]);
    assert.equal(second.body.order.orderId, first.body.order.orderId);
    assert.equal((await allOrders()).length, 1);
    assert.equal(telegram.calls, 1);
  });

  test('11. тот же requestId с изменённым содержимым — 409; ключ привязан к гостевой сессии или UID', async () => {
    const body = orderBody();
    assert.equal((await post(body)).status, 201);
    const changed = await post({ ...body, items: [{ ...body.items[0], quantity: 2 }], expectedTotal: body.expectedTotal * 2 });
    assert.deepEqual([changed.status, changed.body.error], [409, 'request_conflict']);
    // Тот же requestId в другой гостевой сессии — отдельный заказ (ключ не глобальный)
    const other = await post({ ...body, guestSessionId: uuid() });
    assert.equal(other.status, 201);
    assert.equal((await allOrders()).length, 2, 'другая сессия — отдельный заказ');
  });

  test('13. гонки: 6 одинаковых запросов одновременно — один заказ и одно уведомление; лимит частоты не превышается', async () => {
    const body = orderBody();
    const results = await Promise.all(Array.from({ length: 6 }, () => post(body, { ip: '203.0.113.10' })));
    const created = results.filter((r) => r.status === 201);
    assert.equal(created.length, 1, results.map((r) => r.status).join(','));
    assert.ok(results.every((r) => r.status === 201 || (r.status === 200 && r.body.idempotent) || r.status === 429), results.map((r) => r.status).join(','));
    const ids = new Set(results.filter((r) => r.body.ok).map((r) => r.body.order.orderId));
    assert.equal(ids.size, 1);
    assert.equal((await allOrders()).length, 1);
    assert.equal(telegram.calls, 1);
    // 8 разных заказов гостя с одного IP одновременно — ровно 5 приняты (транзакционный счётчик)
    const burst = await Promise.all(Array.from({ length: 8 }, () => post(orderBody(), { ip: '203.0.113.20' })));
    assert.equal(burst.filter((r) => r.status === 201).length, 5, burst.map((r) => r.status).join(','));
    assert.equal(burst.filter((r) => r.status === 429).length, 3);
  });
});

describe('WELCOME15', () => {
  const welcomeBody = (over = {}) => {
    const v = largest(A);
    const qty = Math.ceil(3000 / v.price);
    return orderBody({ items: [{ productId: A.id, volume: v.ml, quantity: qty }], promoCode: 'WELCOME15', expectedTotal: totalFor([{ price: v.price, quantity: qty }], { promo: 'WELCOME15' }), ...over });
  };

  test('12. повторное использование: гость по телефону и e-mail, вошедший по UID и телефону; ключи без открытых данных', async () => {
    assert.equal((await post(welcomeBody())).status, 201);
    const samePhone = await post(welcomeBody({ guestSessionId: uuid(), customer: { name: 'Другая', lastName: 'Гостья', phone: '700123456', email: 'other@example.com' } }));
    assert.deepEqual([samePhone.status, samePhone.body.error], [409, 'promo_used']);
    const sameEmail = await post(welcomeBody({ guestSessionId: uuid(), customer: { name: 'Другая', lastName: 'Гостья', phone: '555000111', email: 'aigerim@example.com' } }));
    assert.deepEqual([sameEmail.status, sameEmail.body.error], [409, 'promo_used']);
    // Принятое ограничение: другой телефон и e-mail — код снова принимается
    const fresh = await post(welcomeBody({ guestSessionId: uuid(), customer: { name: 'Новая', lastName: 'Гостья', phone: '777000222', email: 'new@example.com' } }));
    assert.equal(fresh.status, 201);
    // Вошедший: по UID — даже с другим телефоном
    const user = await signUp(`w-${Date.now()}@example.com`);
    const u1 = await post(welcomeBody({ guestSessionId: undefined, customer: { name: 'Айжан', lastName: 'Бекова', phone: '700999888', email: 'x1@example.com' } }), { token: user.token });
    assert.equal(u1.status, 201);
    const u2 = await post(welcomeBody({ guestSessionId: undefined, customer: { name: 'Айжан', lastName: 'Бекова', phone: '700999777', email: 'x2@example.com' } }), { token: user.token });
    assert.deepEqual([u2.status, u2.body.error], [409, 'promo_used']);
    // Ключи — HMAC, без телефонов, e-mail и UID
    const ids = (await admin.db.collection('promoRedemptions').get()).docs.map((d) => d.id).join(' ');
    assert.doesNotMatch(ids, /700|555|777|example|@|WELCOME/);
    assert.doesNotMatch(ids, new RegExp(user.uid));
  });

  test('13б. гонка WELCOME15: два разных заказа с одним телефоном одновременно — принят только один', async () => {
    const results = await Promise.all([post(welcomeBody()), post(welcomeBody({ guestSessionId: uuid(), customer: { name: 'Двойник', lastName: 'Бекова', phone: '700123456', email: 'twin@example.com' } }))]);
    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(statuses, [201, 409], JSON.stringify(results.map((r) => r.body.error)));
    assert.equal((await allOrders()).length, 1);
  });
});

describe('ограничение частоты', () => {
  test('14. гость: 5 заказов за 10 минут на IP, 6-й — 429; X-Forwarded-For вне Vercel не учитывается', async () => {
    for (let i = 0; i < 5; i++) assert.equal((await post(orderBody(), { ip: '203.0.113.30' })).status, 201);
    const sixth = await post(orderBody(), { ip: '203.0.113.30', headers: { 'x-forwarded-for': '1.2.3.4', 'x-vercel-forwarded-for': '5.6.7.8' } });
    assert.deepEqual([sixth.status, sixth.body.error], [429, 'rate_limited']);
    assert.ok(Number(sixth.headers['Retry-After']) > 0);
    assert.equal((await post(orderBody(), { ip: '203.0.113.31' })).status, 201, 'другой IP — свой лимит');
    const ids = (await admin.db.collection('orderRateLimits').get()).docs.map((d) => d.id).join(' ');
    assert.doesNotMatch(ids, /203\.0\.113/, 'IP в открытом виде не хранится');
  });

  test('14б. вошедший: 10 заказов за 10 минут на UID, 11-й — 429 (с разных IP)', async () => {
    const user = await signUp(`rl-${Date.now()}@example.com`);
    for (let i = 0; i < 10; i++) assert.equal((await post(orderBody({ guestSessionId: undefined }), { token: user.token })).status, 201, `заказ ${i + 1}`);
    const r = await post(orderBody({ guestSessionId: undefined }), { token: user.token, ip: '192.0.2.99' });
    assert.deepEqual([r.status, r.body.error], [429, 'rate_limited']);
  });
});

describe('Telegram', () => {
  test('15. сбой Telegram после сохранения: заказ остаётся, статус failed без персональных данных; повтор запроса не отправляет снова', async () => {
    for (const mode of ['fail', 'throw']) {
      telegram = { calls: 0, mode };
      const body = orderBody();
      const r = await post(body);
      assert.equal(r.status, 201, mode);
      assert.equal(r.body.notification, 'pending');
      const snap = (await allOrders()).find((d) => d.id === r.body.order.orderId);
      const n = snap.get('notification');
      assert.equal(n.status, 'failed');
      assert.equal(n.attempts, 1);
      assert.equal(n.leaseUntil, null);
      assert.match(n.lastError, /^telegram_/);
      const again = await post(body);
      assert.deepEqual([again.status, again.body.idempotent], [200, true]);
      assert.equal(telegram.calls, 1, 'автоматической повторной отправки нет');
    }
  });

  test('аренда уведомления: два процесса одновременно — одна отправка; после истечения аренды — снова можно', async () => {
    telegram = { calls: 0, mode: 'fail' };
    const r = await post(orderBody());
    const ref = (await allOrders())[0].ref;
    telegram = { calls: 0, mode: 'slow' };
    const results = await Promise.all([notifyOrder(admin.db, ref, { env: ENV, fetchImpl: fakeFetch }), notifyOrder(admin.db, ref, { env: ENV, fetchImpl: fakeFetch })]);
    assert.deepEqual(results.sort(), ['sent', 'skipped']);
    assert.equal(telegram.calls, 1);
    assert.equal((await ref.get()).get('notification.status'), 'sent');
    assert.equal(await notifyOrder(admin.db, ref, { env: ENV, fetchImpl: fakeFetch }), 'skipped', 'отправленное не отправляется снова');
    // Процесс «упал» в состоянии sending: пока аренда действует — пропуск, после — можно отправить
    await ref.update({ 'notification.status': 'sending', 'notification.leaseUntil': Date.now() + 60_000 });
    assert.equal(await notifyOrder(admin.db, ref, { env: ENV, fetchImpl: fakeFetch }), 'skipped');
    await ref.update({ 'notification.leaseUntil': Date.now() - 1 });
    assert.equal(await notifyOrder(admin.db, ref, { env: ENV, fetchImpl: fakeFetch }), 'sent');
    assert.ok(r.body.order.orderId);
  });

  test('сообщение Telegram — из сохранённого заказа сервера: цены каталога, «ожидает оплаты», экранирование', async () => {
    let sent;
    const capture = async (url, init) => {
      sent = JSON.parse(init.body);
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };
    const body = orderBody({ customer: { name: '<b>Айгерим</b>', lastName: 'Асанова', phone: '700123456', email: 'a@example.com' }, paymentMethod: 'cardDemo' });
    const r = await handleOrder({ method: 'POST', headers: { 'x-firebase-appcheck': createTestAppCheckToken(APP_CHECK_SECRET) }, body, socketAddress: '192.0.2.1', env: ENV, deps: { fetchImpl: capture } });
    assert.equal(r.status, 201);
    assert.equal(sent.parse_mode, 'HTML');
    assert.match(sent.text, /&lt;b&gt;Айгерим&lt;\/b&gt; Асанова \(гость\)/);
    assert.match(sent.text, new RegExp(`× ${smallest(A).price}`));
    assert.match(sent.text, /ожидает оплаты/);
    assert.doesNotMatch(sent.text, /Оплачен/);
    assert.ok(sent.text.length <= 4000);
  });
});
