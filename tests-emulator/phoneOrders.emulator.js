// Телефон в заказах (Блок 2) на Firebase Emulator с настоящими firestore.rules:
// новый заказ создаёт только сервер (номер в формате E.164, C3.3); старые заказы с другими
// форматами читаются администратором без изменений — новый вид номера только на экране (displayPhone).
//
// Запуск: npm run test:rules. Проект demo-aroma-donna существует только в эмуляторе.
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collectionGroup, doc, getDoc, getDocs, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { buildOrder } from '../src/utils/checkoutReview.js';
import { displayPhone } from '../src/utils/phone.js';
import { parseOrderRequest } from '../api/_lib/orderCore.js';

const PROJECT_ID = 'demo-aroma-donna';
const ADMIN_UID = 'admin-uid';
const CUSTOMER_UID = 'customer-uid';
const at = (iso) => Timestamp.fromDate(new Date(iso));

// Старые заказы: номера в том виде, в каком их вводили до Блока 2, и номер другой страны
const LEGACY = {
  'old-spaces': '+996 700 123 456',
  'old-local': '0700 123 456',
  'old-brackets': '+996 (700) 12-34-56',
  'old-no-plus': '996700123456',
  'old-foreign': '+7 912 345-67-89',
  'old-nine': '700123456',
};

let env;

const legacyOrder = (id, phone) => ({
  id,
  userId: CUSTOMER_UID,
  total: 1000,
  items: [{ id: 'p1', quantity: 1 }],
  status: 'new',
  createdAt: at('2026-10-01T00:00:00Z'),
  customer: { name: 'Старый', lastName: 'Заказ', phone, email: 'c@example.com' },
});

before(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
  });
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'FIRESTORE_EMULATOR_HOST не задан — запускайте через npm run test:rules');
  assert.ok(PROJECT_ID.startsWith('demo-'));
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'admins', ADMIN_UID), { role: 'admin' });
    await setDoc(doc(db, 'users', CUSTOMER_UID), { name: 'Покупатель', email: 'c@example.com', createdAt: at('2026-10-01T00:00:00Z') });
    for (const [id, phone] of Object.entries(LEGACY)) await setDoc(doc(db, 'users', CUSTOMER_UID, 'orders', id), legacyOrder(id, phone));
  });
});

after(async () => {
  await env?.cleanup();
});

test('новый заказ: из браузера в Firestore не записывается (C3.3); телефон сохраняет сервер как +996700123456', async () => {
  const db = env.authenticatedContext(CUSTOMER_UID).firestore();
  const order = buildOrder({
    id: 'AD-NEW',
    createdAt: '2026-11-06T10:00:00.000Z',
    user: { uid: CUSTOMER_UID },
    lines: [{ product: { id: 'p1', name: 'Rose', brand: 'B' }, volume: 50, price: 1000, quantity: 1 }],
    totals: { subtotal: 1000, discount: 0, delivery: 0, grandTotal: 1000 },
    promoCode: null,
    values: {
      name: 'Айгерим', lastName: 'Асанова', phone: '700123456', email: 'a@mail.com',
      delivery: 'pickup', region: '', city: '', address: '', comment: '', payment: 'cashOnDelivery',
    },
    paymentStatus: 'awaitingPayment',
  });
  // Прежняя прямая запись из браузера теперь запрещена правилами
  await assertFails(setDoc(doc(db, 'users', CUSTOMER_UID, 'orders', 'AD-NEW'), { ...order, mode: 'firebase', status: 'new' }));
  assert.equal((await getDoc(doc(env.authenticatedContext(ADMIN_UID).firestore(), 'users', CUSTOMER_UID, 'orders', 'AD-NEW'))).exists(), false);
  // Формат хранения телефона — на сервере (api/_lib/orderCore.js; заказ целиком — tests-emulator/orderApi.emulator.js)
  const parsed = parseOrderRequest({
    requestId: crypto.randomUUID(),
    items: [{ productId: 'p1', volume: 50, quantity: 1 }],
    promoCode: null,
    deliveryMethod: 'pickup',
    paymentMethod: 'cashOnDelivery',
    customer: { name: 'Айгерим', lastName: 'Асанова', phone: '700123456', email: 'a@mail.com' },
    shipping: { comment: '' },
    agree: true,
    expectedTotal: 1000,
  });
  assert.deepEqual(parsed.customer, { name: 'Айгерим', lastName: 'Асанова', phone: '+996700123456', email: 'a@mail.com' });
  assert.deepEqual(displayPhone(parsed.customer.phone), { text: '+996 700 123 456', href: 'tel:+996700123456' });
});

test('старые заказы: администратор читает номера без изменений; вид на экране — только displayPhone', async () => {
  const adminDb = env.authenticatedContext(ADMIN_UID).firestore();
  const snap = await getDocs(collectionGroup(adminDb, 'orders'));
  const phones = Object.fromEntries(snap.docs.map((d) => [d.id, d.data().customer.phone]));
  assert.deepEqual(phones, LEGACY, 'в базе всё как было');
  const shown = Object.fromEntries(Object.entries(phones).map(([id, p]) => [id, displayPhone(p).text]));
  assert.deepEqual(shown, {
    'old-spaces': '+996 700 123 456',
    'old-local': '+996 700 123 456',
    'old-brackets': '+996 700 123 456',
    'old-no-plus': '+996 700 123 456',
    'old-foreign': '+7 912 345-67-89',
    'old-nine': '700123456',
  });
});

test('смена статуса старого заказа администратором не трогает номер', async () => {
  const adminDb = env.authenticatedContext(ADMIN_UID).firestore();
  const ref = doc(adminDb, 'users', CUSTOMER_UID, 'orders', 'old-local');
  await assertSucceeds(updateDoc(ref, { status: 'confirmed', statusUpdatedAt: serverTimestamp() }));
  const data = (await getDoc(ref)).data();
  assert.equal(data.status, 'confirmed');
  assert.equal(data.customer.phone, '0700 123 456');
});
