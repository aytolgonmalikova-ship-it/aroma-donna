// C3.3, этап 5: гостевые заказы в админке и ручная повторная отправка уведомления в Telegram
// (/api/order-notify) — с настоящим Admin SDK и правилами firestore.rules на эмуляторах (demo-aroma-donna).
// Telegram подменён — наружу ничего не уходит. Этап 6: смена статуса гостевого заказа по правилам firestore.rules.
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collectionGroup, deleteDoc, doc, getDoc, getDocs, query, limit, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { handleOrder } from '../api/_lib/orderHandler.js';
import { handleNotify } from '../api/_lib/notifyHandler.js';
import { createTestAppCheckToken, getAdmin } from '../api/_lib/firebaseAdmin.js';
import { products } from '../src/data/products.js';
import { toFirestoreProduct } from '../src/utils/products.js';

const PROJECT = 'demo-aroma-donna';
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;
const FS = `http://${process.env.FIRESTORE_EMULATOR_HOST}`;
const APP_CHECK_SECRET = 'app-check-test-secret-for-emulator-only-0123456789';
const ENV = {
  FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST,
  FIREBASE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST,
  GCLOUD_PROJECT: PROJECT,
  ORDER_HMAC_SECRET: 'order-hmac-secret-for-emulator-tests-only-0123456789',
  APP_CHECK_TEST_SECRET: APP_CHECK_SECRET,
  TELEGRAM_BOT_TOKEN: '123:test-token-must-not-leak',
  TELEGRAM_CHAT_ID: '1',
};

const A = products.filter((p) => p.availability === 'inStock')[0];
const V = [...A.volumes].sort((x, y) => x.price - y.price)[0];

let admin;
let rulesEnv;
let telegram; // { calls, mode: 'ok' | 'fail', delayMs }
let ip = 0;
const fakeFetch = async (url) => {
  assert.ok(String(url).startsWith('https://api.telegram.org/'), 'только подменённый Telegram');
  telegram.calls++;
  if (telegram.delayMs) await new Promise((r) => setTimeout(r, telegram.delayMs));
  return telegram.mode === 'fail' ? { ok: false, status: 502, json: async () => ({ ok: false }) } : { ok: true, status: 200, json: async () => ({ ok: true }) };
};

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
const orderBody = (over = {}) => ({
  requestId: crypto.randomUUID(),
  items: [{ productId: A.id, volume: V.ml, quantity: 1 }],
  promoCode: null,
  deliveryMethod: 'pickup',
  paymentMethod: 'cashOnDelivery',
  customer: { name: 'Гость', lastName: 'Тестовый', phone: '555000111', email: 'guest@example.com' },
  shipping: { comment: '' },
  agree: true,
  expectedTotal: V.price,
  ...over,
});
/** Заказ через настоящий обработчик: гость (App Check) или вошедший. Возвращает { ref, id, path } */
async function placeOrder({ token } = {}) {
  const headers = token ? { authorization: `Bearer ${token}` } : { 'x-firebase-appcheck': createTestAppCheckToken(APP_CHECK_SECRET) };
  const body = token ? orderBody() : orderBody({ guestSessionId: crypto.randomUUID() });
  const r = await handleOrder({ method: 'POST', headers, body, socketAddress: `203.0.113.${(ip++ % 250) + 1}`, env: ENV, deps: { fetchImpl: fakeFetch } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const snap = (await admin.db.collectionGroup('orders').where('id', '==', r.body.order.orderId).get()).docs[0];
  return { ref: snap.ref, id: snap.id, path: snap.ref.path };
}
const target = (ref) => {
  const [col, ownerId, , orderId] = ref.path.split('/');
  return { kind: col === 'guests' ? 'guest' : 'user', ownerId, orderId };
};
const notify = (token, body) =>
  handleNotify({ method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body, env: ENV, deps: { fetchImpl: fakeFetch } });

let owner;
let manager;
let customer;

before(async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST, 'запускайте через npm run test:rules');
  admin = getAdmin(ENV);
  assert.equal(admin.mode, 'emulator');
  assert.equal(admin.projectId, PROJECT);
  rulesEnv = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') } });
  const stamp = Date.now();
  owner = await signUp(`owner-${stamp}@example.com`);
  manager = await signUp(`manager-${stamp}@example.com`);
  customer = await signUp(`customer-${stamp}@example.com`);
});
beforeEach(async () => {
  telegram = { calls: 0, mode: 'ok', delayMs: 0 };
  await fetch(`${FS}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  const batch = admin.db.batch();
  batch.set(admin.db.collection('products').doc(A.id), { ...toFirestoreProduct(A), updatedAt: new Date() });
  // Роли как в проекте: владелец — admins/{uid} + adminConfig/primary.ownerUid; обычный администратор — только admins/{uid}
  batch.set(admin.db.doc(`admins/${owner.uid}`), { grantedAt: new Date(), label: 'Владелец (тест)' });
  batch.set(admin.db.doc(`admins/${manager.uid}`), { grantedAt: new Date(), grantedBy: owner.uid, label: 'Администратор (тест)' });
  batch.set(admin.db.doc('adminConfig/primary'), { ownerUid: owner.uid, updatedAt: new Date(), updatedBy: owner.uid });
  await batch.commit();
});
after(async () => {
  await rulesEnv?.cleanup();
});

describe('гостевые заказы и правила firestore.rules', () => {
  test('12/16. администратор (владелец и обычный) читает гостевые и обычные заказы одним запросом collectionGroup с лимитом', async () => {
    const guest = await placeOrder();
    const user = await placeOrder({ token: customer.token });
    assert.match(guest.path, /^guests\/[0-9a-f]{40}\/orders\//);
    assert.equal(user.path, `users/${customer.uid}/orders/${user.id}`);
    for (const uid of [owner.uid, manager.uid]) {
      const db = rulesEnv.authenticatedContext(uid).firestore();
      const snap = await assertSucceeds(getDocs(query(collectionGroup(db, 'orders'), limit(500))));
      assert.deepEqual(snap.docs.map((d) => d.ref.path).sort(), [guest.path, user.path].sort());
      await assertSucceeds(getDoc(doc(db, guest.path)));
    }
  });

  test('17. покупатель и гость не читают гостевые заказы (ни документ, ни collectionGroup); свой заказ покупатель читает', async () => {
    const guest = await placeOrder();
    const user = await placeOrder({ token: customer.token });
    const db = rulesEnv.authenticatedContext(customer.uid).firestore();
    await assertFails(getDoc(doc(db, guest.path)));
    await assertFails(getDocs(query(collectionGroup(db, 'orders'), limit(10))));
    await assertSucceeds(getDoc(doc(db, user.path)));
    const anon = rulesEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anon, guest.path)));
    await assertFails(getDocs(query(collectionGroup(anon, 'orders'), limit(10))));
  });

  test('14/15. статус обычного заказа меняет администратор; системные поля (userId, цены, итог, уведомление) — нельзя', async () => {
    const user = await placeOrder({ token: customer.token });
    for (const uid of [owner.uid, manager.uid]) {
      const db = rulesEnv.authenticatedContext(uid).firestore();
      await assertSucceeds(updateDoc(doc(db, user.path), { status: 'confirmed', statusUpdatedAt: serverTimestamp() }));
      for (const forged of [{ userId: 'someone' }, { total: 1 }, { items: [] }, { paymentStatus: 'paidDemo' }, { 'notification.status': 'pending' }, { 'notification.attempts': 99 }, { createdAt: '2020-01-01T00:00:00.000Z' }, { status: 'paid' }]) {
        await assertFails(updateDoc(doc(db, user.path), { status: 'shipped', statusUpdatedAt: serverTimestamp(), ...forged }));
      }
    }
    // Покупатель статус своего заказа не меняет
    await assertFails(updateDoc(doc(rulesEnv.authenticatedContext(customer.uid).firestore(), user.path), { status: 'delivered', statusUpdatedAt: serverTimestamp() }));
  });

  test('14/15 (этап 6). статус гостевого заказа меняют владелец и обычный администратор; системные поля, создание и удаление — нельзя', async () => {
    const guest = await placeOrder();
    const before = (await guest.ref.get()).data();
    const guestKey = guest.path.split('/')[1];
    for (const [uid, status] of [[owner.uid, 'confirmed'], [manager.uid, 'shipped']]) {
      const db = rulesEnv.authenticatedContext(uid).firestore();
      await assertSucceeds(updateDoc(doc(db, guest.path), { status, statusUpdatedAt: serverTimestamp() }));
      assert.equal((await guest.ref.get()).get('status'), status);
      for (const forged of [
        { total: 1 },
        { subtotal: 1 },
        { discount: 9999 },
        { delivery: 500 },
        { items: [] },
        { 'items.0.price': 1 },
        { paymentStatus: 'paidDemo' },
        { payment: 'cardDemo' },
        { userId: uid },
        { customerType: 'registered' },
        { id: 'AD-FAKE' },
        { createdAt: '2020-01-01T00:00:00.000Z' },
        { 'customer.phone': '+996555000000' },
        { 'shipping.address': 'другой адрес' },
        { 'notification.status': 'failed' },
        { 'notification.attempts': 99 },
        { guestKey: 'x' },
        { mode: 'demo' },
      ]) {
        await assertFails(updateDoc(doc(db, guest.path), { status: 'delivered', statusUpdatedAt: serverTimestamp(), ...forged }), JSON.stringify(forged));
      }
      // Статус вне списка, время не серверное
      await assertFails(updateDoc(doc(db, guest.path), { status: 'paid', statusUpdatedAt: serverTimestamp() }));
      await assertFails(updateDoc(doc(db, guest.path), { status: 'delivered', statusUpdatedAt: new Date('2020-01-01') }));
      // Создать и удалить гостевой заказ администратор не может
      await assertFails(setDoc(doc(db, 'guests', guestKey, 'orders', 'AD-ADMIN-NEW'), { ...before, id: 'AD-ADMIN-NEW' }));
      await assertFails(deleteDoc(doc(db, guest.path)));
      // Корневой документ гостя и другие подколлекции закрыты
      await assertFails(getDoc(doc(db, 'guests', guestKey)));
      await assertFails(setDoc(doc(db, 'guests', guestKey, 'notes', 'n1'), { x: 1 }));
    }
    const after = (await guest.ref.get()).data();
    for (const key of ['id', 'userId', 'customerType', 'items', 'subtotal', 'discount', 'delivery', 'total', 'customer', 'shipping', 'payment', 'paymentStatus', 'createdAt', 'notification']) {
      assert.deepEqual(after[key], before[key], `${key} не изменилось`);
    }
  });

  test('17 (этап 6). покупатель, гость без входа и отозванный администратор не меняют и не создают гостевые заказы', async () => {
    const guest = await placeOrder();
    const guestKey = guest.path.split('/')[1];
    const order = (await guest.ref.get()).data();
    const tryAll = async (db) => {
      await assertFails(getDoc(doc(db, guest.path)));
      await assertFails(updateDoc(doc(db, guest.path), { status: 'confirmed', statusUpdatedAt: serverTimestamp() }));
      await assertFails(setDoc(doc(db, 'guests', guestKey, 'orders', 'AD-SELF-1'), { ...order, id: 'AD-SELF-1' }));
      await assertFails(setDoc(doc(db, 'guests', 'f'.repeat(40), 'orders', 'AD-SELF-2'), { ...order, id: 'AD-SELF-2' }));
      await assertFails(deleteDoc(doc(db, guest.path)));
    };
    await tryAll(rulesEnv.authenticatedContext(customer.uid).firestore());
    await tryAll(rulesEnv.unauthenticatedContext().firestore());
    // Отозванный администратор: документ admins удалён — прав больше нет
    await admin.db.doc(`admins/${manager.uid}`).delete();
    await tryAll(rulesEnv.authenticatedContext(manager.uid).firestore());
    await assertFails(getDocs(query(collectionGroup(rulesEnv.authenticatedContext(manager.uid).firestore(), 'orders'), limit(10))));
    assert.equal((await guest.ref.get()).get('status'), 'new', 'документ не изменился');
  });

  test('сервер (Admin SDK) по-прежнему создаёт гостевые заказы и обновляет уведомление — правила его не ограничивают', async () => {
    telegram.mode = 'fail';
    const guest = await placeOrder();
    assert.equal((await guest.ref.get()).get('notification.status'), 'failed');
    telegram.mode = 'ok';
    const r = await notify(owner.token, target(guest.ref));
    assert.deepEqual([r.status, r.body.notification], [200, 'sent']);
  });
});

describe('/api/order-notify: ручная повторная отправка в Telegram', () => {
  test('18. владелец и обычный администратор: failed → sent (гостевой и обычный заказ), попытки учитываются', async () => {
    telegram.mode = 'fail';
    const guest = await placeOrder();
    const user = await placeOrder({ token: customer.token });
    assert.equal((await guest.ref.get()).get('notification.status'), 'failed');
    telegram = { calls: 0, mode: 'ok', delayMs: 0 };
    for (const [who, order] of [[owner, guest], [manager, user]]) {
      const r = await notify(who.token, target(order.ref));
      assert.deepEqual([r.status, r.body], [200, { ok: true, notification: 'sent' }]);
      const n = (await order.ref.get()).get('notification');
      assert.equal(n.status, 'sent');
      assert.equal(n.attempts, 2);
      assert.equal(n.lastError, null);
      assert.ok(n.sentAt);
    }
    assert.equal(telegram.calls, 2);
  });

  test('18б. Telegram снова недоступен — статус failed с причиной, ответ notification: failed; токен нигде не виден', async () => {
    telegram.mode = 'fail';
    const guest = await placeOrder();
    const r = await notify(owner.token, target(guest.ref));
    assert.deepEqual([r.status, r.body], [200, { ok: true, notification: 'failed' }]);
    const n = (await guest.ref.get()).get('notification');
    assert.deepEqual([n.status, n.attempts, n.lastError], ['failed', 2, 'telegram_502']);
    assert.doesNotMatch(JSON.stringify([r, n]), /test-token-must-not-leak|123:/);
  });

  test('19. уже отправлено — 409 already_sent, повторной отправки нет; старый заказ без уведомлений — 409 not_needed', async () => {
    const guest = await placeOrder();
    assert.equal((await guest.ref.get()).get('notification.status'), 'sent');
    const calls = telegram.calls;
    const r = await notify(owner.token, target(guest.ref));
    assert.deepEqual([r.status, r.body.error], [409, 'already_sent']);
    // Старый заказ (до C3.3): поля notification нет, документ не меняется
    const legacyRef = admin.db.doc(`users/${customer.uid}/orders/OLD-LEGACY-1`);
    const legacy = { id: 'OLD-LEGACY-1', userId: customer.uid, createdAt: '2026-10-01T10:00:00.000Z', total: 1000, status: 'new', paymentStatus: 'paidDemo', mode: 'firebase' };
    await legacyRef.set(legacy);
    const old = await notify(owner.token, target(legacyRef));
    assert.deepEqual([old.status, old.body.error], [409, 'not_needed']);
    assert.deepEqual((await legacyRef.get()).data(), legacy, 'старый paidDemo-заказ не изменён');
    assert.equal(telegram.calls, calls);
  });

  test('20. два администратора одновременно — одна отправка (аренда), второй получает in_progress; идёт аренда — 409', async () => {
    telegram.mode = 'fail';
    const guest = await placeOrder();
    telegram = { calls: 0, mode: 'ok', delayMs: 300 };
    const [a, b] = await Promise.all([notify(owner.token, target(guest.ref)), notify(manager.token, target(guest.ref))]);
    const results = [a, b].map((r) => (r.status === 200 ? r.body.notification : r.body.error)).sort();
    assert.equal(telegram.calls, 1, 'одно сообщение');
    assert.ok(results.includes('sent'), JSON.stringify(results));
    assert.ok(results.every((x) => ['sent', 'in_progress'].includes(x)), JSON.stringify(results));
    assert.equal((await guest.ref.get()).get('notification.attempts'), 2);
    // Активная аренда (другой процесс отправляет) — 409 in_progress без отправки
    await guest.ref.update({ 'notification.status': 'sending', 'notification.leaseUntil': Date.now() + 60_000 });
    const busy = await notify(owner.token, target(guest.ref));
    assert.deepEqual([busy.status, busy.body.error], [409, 'in_progress']);
    // Аренда истекла (процесс упал) — снова можно
    await guest.ref.update({ 'notification.leaseUntil': Date.now() - 1 });
    const retry = await notify(owner.token, target(guest.ref));
    assert.deepEqual([retry.status, retry.body.notification], [200, 'sent']);
    assert.equal(telegram.calls, 2);
  });

  test('16/17. покупатель — 403 not_admin; без токена и с неверным токеном — 401; гость (App Check) — 401', async () => {
    telegram.mode = 'fail';
    const guest = await placeOrder();
    const t = target(guest.ref);
    const c = await notify(customer.token, t);
    assert.deepEqual([c.status, c.body.error], [403, 'not_admin']);
    assert.deepEqual([(await notify(null, t)).status, (await notify(null, t)).body.error], [401, 'auth_invalid']);
    const bad = await notify('not-a-real-token-but-long-enough-xx', t);
    assert.deepEqual([bad.status, bad.body.error], [401, 'auth_invalid']);
    const ac = await handleNotify({ method: 'POST', headers: { 'x-firebase-appcheck': createTestAppCheckToken(APP_CHECK_SECRET) }, body: t, env: ENV, deps: { fetchImpl: fakeFetch } });
    assert.equal(ac.status, 401);
    // Отозванный доступ администратора: документ admins удалён — 403
    await admin.db.doc(`admins/${manager.uid}`).delete();
    const revoked = await notify(manager.token, t);
    assert.deepEqual([revoked.status, revoked.body.error], [403, 'not_admin']);
    assert.equal(telegram.calls, 1, 'только первая (неудачная) попытка при оформлении');
    assert.equal((await guest.ref.get()).get('notification.status'), 'failed');
  });

  test('проверка запроса: метод, тело, путь; guestKey не принимается как UID и наоборот; нет заказа — 404', async () => {
    telegram.mode = 'fail';
    const guest = await placeOrder();
    const t = target(guest.ref);
    const get = await handleNotify({ method: 'GET', headers: { authorization: `Bearer ${owner.token}` }, env: ENV });
    assert.equal(get.status, 405);
    for (const body of [
      {},
      { ...t, extra: 1 },
      { ...t, kind: 'admin' },
      { ...t, ownerId: '../admins' },
      { ...t, orderId: 'x/y' },
      { kind: 'guest', ownerId: customer.uid, orderId: t.orderId }, // UID вместо guestKey
      'not json',
      Buffer.from('x'.repeat(2048)),
    ]) {
      const r = await notify(owner.token, body);
      assert.deepEqual([r.status, r.body.error], [400, 'invalid_request'], JSON.stringify(body).slice(0, 80));
    }
    // guestKey под видом UID — путь users/{guestKey}: такого заказа нет
    const asUser = await notify(owner.token, { ...t, kind: 'user' });
    assert.deepEqual([asUser.status, asUser.body.error], [404, 'not_found']);
    const missing = await notify(owner.token, { ...t, orderId: 'AD-00000000-NONE' });
    assert.deepEqual([missing.status, missing.body.error], [404, 'not_found']);
    assert.equal(telegram.calls, 1);
  });

  test('сервер не настроен — 503 not_configured без подробностей', async () => {
    const r = await handleNotify({ method: 'POST', headers: { authorization: `Bearer ${owner.token}` }, body: {}, env: {}, deps: { admin: { error: 'not-configured' } } });
    assert.deepEqual([r.status, r.body], [503, { ok: false, error: 'not_configured' }]);
  });
});
