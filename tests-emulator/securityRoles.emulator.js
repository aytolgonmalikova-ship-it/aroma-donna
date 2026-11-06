// C3.3, этап 6: финальная проверка правил firestore.rules по ролям — посетитель без входа, покупатель,
// владелец, обычный администратор, отозванный администратор и гость с гостевым заказом.
// Только эмулятор (demo-aroma-donna). Данные создаются с отключёнными правилами (как сервер через Admin SDK).
// Запуск: npm run test:rules.
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, collectionGroup, deleteDoc, doc, getDoc, getDocs, limit, query, serverTimestamp, setDoc, Timestamp, updateDoc, where, writeBatch } from 'firebase/firestore';

const PROJECT_ID = 'demo-aroma-donna';
const OWNER = 'owner-uid';
const ADMIN = 'admin-uid';
const REVOKED = 'revoked-uid';
const CUSTOMER = 'customer-uid';
const OTHER = 'other-uid';
const GUEST_KEY = 'a'.repeat(40);
const at = (iso) => Timestamp.fromDate(new Date(iso));

const serverOrder = (id, { userId = null, customerType = 'guest' } = {}) => ({
  id,
  createdAt: '2026-11-05T10:00:00.000Z',
  userId,
  customerType,
  items: [{ id: 'p1', name: 'Rose', brand: 'B', volume: 50, price: 1000, quantity: 1 }],
  subtotal: 1000,
  discount: 0,
  promoCode: null,
  delivery: 0,
  total: 1000,
  customer: { name: 'Гость', lastName: 'Тестов', phone: '+996555000111', email: 'g@example.com' },
  shipping: { method: 'pickup', region: null, city: null, address: null, comment: '' },
  payment: 'cashOnDelivery',
  paymentStatus: 'awaitingPayment',
  status: 'new',
  mode: 'firebase',
  notification: { status: 'failed', attempts: 1, leaseUntil: null, sentAt: null, lastError: 'telegram_500' },
});
const GUEST_ORDER = `guests/${GUEST_KEY}/orders/AD-261105-GUEST001`;
const CUSTOMER_ORDER = `users/${CUSTOMER}/orders/AD-261105-USER0001`;
const OTHER_ORDER = `users/${OTHER}/orders/AD-261105-OTHER001`;
const SERVER_ONLY = ['orderRequests/k1', 'promoRedemptions/k1', 'orderRateLimits/k1', 'appCheckTestTokens/n1', `guests/${GUEST_KEY}`];

let env;
const as = (uid) => (uid ? env.authenticatedContext(uid).firestore() : env.unauthenticatedContext().firestore());

before(async () => {
  env = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') } });
});
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const uid of [OWNER, ADMIN, CUSTOMER, OTHER, REVOKED]) {
      await setDoc(doc(db, 'users', uid), { name: uid, email: `${uid}@example.com`, createdAt: at('2026-10-01T00:00:00Z') });
    }
    await setDoc(doc(db, 'admins', OWNER), { grantedAt: at('2026-10-01T00:00:00Z'), grantedBy: OWNER });
    await setDoc(doc(db, 'admins', ADMIN), { grantedAt: at('2026-10-01T00:00:00Z'), grantedBy: OWNER });
    // REVOKED был администратором, документ admins удалён (доступ отозван) — документа нет
    await setDoc(doc(db, 'adminConfig', 'primary'), { ownerUid: OWNER, pendingOwnerUid: null, previousOwnerUid: null, updatedAt: at('2026-10-01T00:00:00Z'), updatedBy: OWNER });
    await setDoc(doc(db, GUEST_ORDER), serverOrder('AD-261105-GUEST001'));
    await setDoc(doc(db, CUSTOMER_ORDER), serverOrder('AD-261105-USER0001', { userId: CUSTOMER, customerType: 'registered' }));
    await setDoc(doc(db, OTHER_ORDER), serverOrder('AD-261105-OTHER001', { userId: OTHER, customerType: 'registered' }));
    for (const path of SERVER_ONLY) await setDoc(doc(db, path), { x: 1 });
    await setDoc(doc(db, 'reviews', 'r-pending'), { name: 'Аня', rating: 5, text: 'Отзыв ждёт модерации.', lang: 'ru', status: 'pending', createdAt: at('2026-11-01T00:00:00Z') });
  });
});
after(async () => {
  await env?.cleanup();
});

const statusChange = (status = 'confirmed') => ({ status, statusUpdatedAt: serverTimestamp() });

describe('заказы: создание напрямую через Firestore запрещено всем', () => {
  for (const [who, uid] of [['посетитель', null], ['покупатель', CUSTOMER], ['обычный администратор', ADMIN], ['владелец', OWNER], ['отозванный администратор', REVOKED]]) {
    test(`${who}: не создаёт ни свой, ни чужой, ни гостевой заказ (даже с «правильными» полями)`, async () => {
      const db = as(uid);
      const own = uid || 'nobody';
      await assertFails(setDoc(doc(db, 'users', own, 'orders', 'AD-SELF-0001'), { ...serverOrder('AD-SELF-0001', { userId: own, customerType: 'registered' }) }));
      await assertFails(setDoc(doc(db, 'users', OTHER, 'orders', 'AD-SELF-0002'), serverOrder('AD-SELF-0002', { userId: OTHER })));
      await assertFails(setDoc(doc(db, 'guests', GUEST_KEY, 'orders', 'AD-SELF-0003'), serverOrder('AD-SELF-0003')));
      await assertFails(setDoc(doc(db, 'guests', 'b'.repeat(40), 'orders', 'AD-SELF-0004'), serverOrder('AD-SELF-0004')));
      // Перезапись существующего заказа (setDoc = update) с другой суммой
      await assertFails(setDoc(doc(db, CUSTOMER_ORDER), { ...serverOrder('AD-261105-USER0001', { userId: CUSTOMER, customerType: 'registered' }), total: 1 }));
      await assertFails(deleteDoc(doc(db, CUSTOMER_ORDER)));
      await assertFails(deleteDoc(doc(db, GUEST_ORDER)));
    });
  }
});

describe('заказы: чтение', () => {
  test('посетитель (и гость, оформивший заказ): ни один заказ, ни collectionGroup', async () => {
    const db = as(null);
    for (const path of [GUEST_ORDER, CUSTOMER_ORDER]) await assertFails(getDoc(doc(db, path)));
    await assertFails(getDocs(query(collectionGroup(db, 'orders'), limit(10))));
    await assertFails(getDocs(collection(db, 'guests', GUEST_KEY, 'orders')));
  });

  test('покупатель: только свои заказы; чужие, гостевые и collectionGroup — нет', async () => {
    const db = as(CUSTOMER);
    await assertSucceeds(getDoc(doc(db, CUSTOMER_ORDER)));
    await assertSucceeds(getDocs(collection(db, 'users', CUSTOMER, 'orders')));
    await assertFails(getDoc(doc(db, OTHER_ORDER)));
    await assertFails(getDoc(doc(db, GUEST_ORDER)));
    await assertFails(getDocs(collection(db, 'guests', GUEST_KEY, 'orders')));
    await assertFails(getDocs(query(collectionGroup(db, 'orders'), limit(10))));
  });

  test('владелец и обычный администратор: все заказы (обычные и гостевые)', async () => {
    for (const uid of [OWNER, ADMIN]) {
      const db = as(uid);
      const snap = await assertSucceeds(getDocs(query(collectionGroup(db, 'orders'), limit(500))));
      assert.equal(snap.size, 3);
      await assertSucceeds(getDoc(doc(db, GUEST_ORDER)));
    }
  });

  test('отозванный администратор: заказы, профили и скрытые разделы больше не читает', async () => {
    const db = as(REVOKED);
    await assertFails(getDocs(query(collectionGroup(db, 'orders'), limit(10))));
    await assertFails(getDoc(doc(db, GUEST_ORDER)));
    await assertFails(getDoc(doc(db, 'users', CUSTOMER)));
    await assertFails(getDoc(doc(db, 'reviews', 'r-pending')));
    await assertFails(getDocs(collection(db, 'admins')));
  });
});

describe('заказы: изменение статуса и системных полей', () => {
  const FORGED = [
    { total: 1 },
    { subtotal: 1 },
    { discount: 999 },
    { delivery: 500 },
    { items: [] },
    { promoCode: 'WELCOME15' },
    { paymentStatus: 'paidDemo' },
    { payment: 'cardDemo' },
    { userId: OTHER },
    { customerType: 'admin' }, // значение отличается и у гостевого, и у обычного заказа — иначе это не изменение
    { id: 'AD-FAKE' },
    { createdAt: '2020-01-01T00:00:00.000Z' },
    { customer: { name: 'X', lastName: 'Y', phone: '+996700000000', email: 'x@example.com' } },
    { shipping: { method: 'courier', region: 'bishkek', city: 'bishkek', address: 'x', comment: '' } },
    { notification: { status: 'sent' } },
    { mode: 'demo' },
    { isAdmin: true },
  ];
  for (const [who, uid] of [['владелец', OWNER], ['обычный администратор', ADMIN]]) {
    test(`${who}: меняет только статус (обычный и гостевой заказ); цены, итог, UID, оплата, данные покупателя — нет`, async () => {
      const db = as(uid);
      for (const path of [CUSTOMER_ORDER, GUEST_ORDER]) {
        await assertSucceeds(updateDoc(doc(db, path), statusChange('confirmed')));
        for (const forged of FORGED) await assertFails(updateDoc(doc(db, path), { ...statusChange('shipped'), ...forged }), `${path} ${JSON.stringify(forged)}`);
        await assertFails(updateDoc(doc(db, path), statusChange('paid')));
        await assertFails(updateDoc(doc(db, path), { status: 'shipped', statusUpdatedAt: at('2020-01-01T00:00:00Z') }));
        await assertFails(updateDoc(doc(db, path), { status: 'shipped' })); // без серверного времени
        const data = (await getDoc(doc(db, path))).data();
        assert.deepEqual([data.status, data.total, data.paymentStatus, data.notification.status], ['confirmed', 1000, 'awaitingPayment', 'failed']);
      }
    });
  }

  for (const [who, uid] of [['посетитель', null], ['покупатель', CUSTOMER], ['отозванный администратор', REVOKED]]) {
    test(`${who}: не меняет статус ни своего, ни чужого, ни гостевого заказа`, async () => {
      const db = as(uid);
      for (const path of [CUSTOMER_ORDER, OTHER_ORDER, GUEST_ORDER]) {
        await assertFails(updateDoc(doc(db, path), statusChange('cancelled')));
        await assertFails(updateDoc(doc(db, path), { total: 1 }));
      }
    });
  }
});

describe('служебные данные сервера (идемпотентность, промокоды, лимиты, App Check)', () => {
  for (const [who, uid] of [['посетитель', null], ['покупатель', CUSTOMER], ['обычный администратор', ADMIN], ['владелец', OWNER]]) {
    test(`${who}: не читает, не пишет и не удаляет`, async () => {
      const db = as(uid);
      for (const path of SERVER_ONLY) {
        await assertFails(getDoc(doc(db, path)));
        await assertFails(setDoc(doc(db, path), { x: 2 }));
        await assertFails(deleteDoc(doc(db, path)));
      }
      await assertFails(setDoc(doc(db, 'promoRedemptions', 'new-key'), { usedAt: 1 }));
      await assertFails(getDocs(collection(db, 'orderRequests')));
    });
  }
});

describe('повышение привилегий', () => {
  test('покупатель: не делает себя администратором или владельцем, не пишет роль в профиль', async () => {
    const db = as(CUSTOMER);
    await assertFails(setDoc(doc(db, 'admins', CUSTOMER), { grantedAt: serverTimestamp(), grantedBy: CUSTOMER }));
    await assertFails(setDoc(doc(db, 'admins', CUSTOMER), { grantedAt: serverTimestamp(), grantedBy: OWNER }));
    await assertFails(updateDoc(doc(db, 'adminConfig', 'primary'), { ownerUid: CUSTOMER, updatedAt: serverTimestamp(), updatedBy: CUSTOMER }));
    await assertFails(setDoc(doc(db, 'adminConfig', 'primary'), { ownerUid: CUSTOMER, pendingOwnerUid: null, previousOwnerUid: null, updatedAt: serverTimestamp(), updatedBy: CUSTOMER }));
    await assertFails(updateDoc(doc(db, 'users', CUSTOMER), { role: 'admin' }));
    await assertFails(updateDoc(doc(db, 'users', CUSTOMER), { isAdmin: true }));
    await assertFails(getDoc(doc(db, 'admins', OWNER)));
    await assertFails(getDoc(doc(db, 'adminConfig', 'primary')));
    // Чужой профиль — ни читать, ни менять
    await assertFails(getDoc(doc(db, 'users', OTHER)));
    await assertFails(updateDoc(doc(db, 'users', OTHER), { name: 'взлом' }));
  });

  test('обычный администратор: не назначает и не удаляет администраторов, не делает себя владельцем', async () => {
    const db = as(ADMIN);
    await assertFails(setDoc(doc(db, 'admins', CUSTOMER), { grantedAt: serverTimestamp(), grantedBy: ADMIN }));
    await assertFails(deleteDoc(doc(db, 'admins', OWNER)));
    await assertFails(updateDoc(doc(db, 'admins', ADMIN), { role: 'owner' }));
    await assertFails(getDocs(collection(db, 'admins')));
    await assertFails(updateDoc(doc(db, 'adminConfig', 'primary'), { ownerUid: ADMIN, previousOwnerUid: OWNER, pendingOwnerUid: null, updatedAt: serverTimestamp(), updatedBy: ADMIN }));
    await assertFails(updateDoc(doc(db, 'adminConfig', 'primary'), { pendingOwnerUid: ADMIN, updatedAt: serverTimestamp(), updatedBy: ADMIN }));
    // Пакетом: «стать кандидатом и сразу принять» — тоже нет
    const batch = writeBatch(db);
    batch.update(doc(db, 'adminConfig', 'primary'), { ownerUid: ADMIN, previousOwnerUid: OWNER, pendingOwnerUid: null, updatedAt: serverTimestamp(), updatedBy: ADMIN });
    await assertFails(batch.commit());
    // Профили только читает
    await assertSucceeds(getDoc(doc(db, 'users', CUSTOMER)));
    await assertFails(updateDoc(doc(db, 'users', CUSTOMER), { name: 'изменено' }));
  });

  test('отозванный администратор: прежние права не действуют (назначение, отзыв, товары, отзывы)', async () => {
    const db = as(REVOKED);
    await assertFails(setDoc(doc(db, 'admins', REVOKED), { grantedAt: serverTimestamp(), grantedBy: OWNER }));
    await assertFails(setDoc(doc(db, 'admins', CUSTOMER), { grantedAt: serverTimestamp(), grantedBy: REVOKED }));
    await assertFails(updateDoc(doc(db, 'reviews', 'r-pending'), { status: 'approved', moderatedAt: serverTimestamp() }));
    await assertFails(getDocs(query(collection(db, 'products'), where('hidden', '==', true))));
  });

  test('владелец: управляет администраторами, но заказ создать и системные поля изменить не может', async () => {
    const db = as(OWNER);
    await assertSucceeds(setDoc(doc(db, 'admins', CUSTOMER), { grantedAt: serverTimestamp(), grantedBy: OWNER }));
    await assertSucceeds(deleteDoc(doc(db, 'admins', CUSTOMER)));
    await assertFails(deleteDoc(doc(db, 'admins', OWNER)));
    await assertFails(updateDoc(doc(db, GUEST_ORDER), { ...statusChange(), total: 1 }));
  });
});

describe('отзывы: привилегированные поля', () => {
  for (const [who, uid] of [['посетитель', null], ['покупатель', CUSTOMER]]) {
    test(`${who}: новый отзыв — только pending и только разрешённые поля`, async () => {
      const db = as(uid);
      const base = { name: 'Аня', rating: 5, text: 'Очень понравился аромат.', lang: 'ru', status: 'pending', createdAt: serverTimestamp() };
      await assertSucceeds(setDoc(doc(db, 'reviews', `ok-${uid || 'anon'}`), base));
      for (const extra of [{ status: 'approved' }, { moderatedAt: serverTimestamp() }, { approvedBy: OWNER }, { isAdmin: true }, { userId: OWNER }, { rating: 6 }, { createdAt: at('2020-01-01T00:00:00Z') }]) {
        await assertFails(setDoc(doc(db, 'reviews', `bad-${Math.random().toString(36).slice(2)}`), { ...base, ...extra }), JSON.stringify(extra));
      }
      await assertFails(updateDoc(doc(db, 'reviews', 'r-pending'), { status: 'approved', moderatedAt: serverTimestamp() }));
      await assertFails(getDoc(doc(db, 'reviews', 'r-pending')));
    });
  }
});
