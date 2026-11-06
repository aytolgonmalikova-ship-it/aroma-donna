// Тесты оформления заказа: данные покупателя, DEMO-оплата картой и сообщение в Telegram.
// Запуск: npm test. Настоящий Telegram не вызывается — вместо fetch подставляется заглушка.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCardPayment, validateCheckout } from '../src/utils/validation.js';
import handler from '../api/order.js';

const CUSTOMER = {
  name: 'Айгерим',
  lastName: 'Асанова',
  phone: '700123456', // форма (PhoneField): 9 цифр после +996
  email: 'aigerim@mail.com',
  delivery: 'regions',
  region: 'issykkul',
  city: 'karakol',
  address: 'ул. Токтогула, 12',
  comment: '',
  payment: 'cashOnDelivery',
  agree: true,
};
const CARD = { holder: 'AIGERIM ASANOVA', number: '4111 1111 1111 1111', expiry: '12/30', cvv: '123' };
const NOW = new Date('2026-10-31T12:00:00Z');

test('checkout: корректные данные покупателя проходят проверку', () => {
  assert.deepEqual(validateCheckout(CUSTOMER), {});
});

test('checkout: пустые фамилия, регион и адрес — ошибки', () => {
  const errors = validateCheckout({ ...CUSTOMER, lastName: ' ', region: '', address: '' });
  assert.equal(errors.lastName, 'validation.required');
  assert.equal(errors.region, 'validation.required');
  assert.equal(errors.address, 'validation.required');
});

test('checkout: при самовывозе регион и адрес не нужны', () => {
  assert.deepEqual(validateCheckout({ ...CUSTOMER, delivery: 'pickup', region: '', city: '', address: '' }), {});
});

test('card: корректная демо-карта проходит проверку', () => {
  assert.deepEqual(validateCardPayment(CARD, NOW), {});
});

test('card: пустые поля — ошибки во всех полях', () => {
  const errors = validateCardPayment({ holder: '', number: '', expiry: '', cvv: '' }, NOW);
  assert.deepEqual(Object.keys(errors).sort(), ['cvv', 'expiry', 'holder', 'number']);
});

test('card: неверный номер, месяц, истёкший срок и CVV', () => {
  assert.equal(validateCardPayment({ ...CARD, number: '4111 1111' }, NOW).number, 'validation.cardNumber');
  assert.equal(validateCardPayment({ ...CARD, expiry: '13/30' }, NOW).expiry, 'validation.cardExpiry');
  assert.equal(validateCardPayment({ ...CARD, expiry: '09/26' }, NOW).expiry, 'validation.cardExpired');
  assert.deepEqual(validateCardPayment({ ...CARD, expiry: '10/26' }, NOW), {}); // действует до конца месяца
  assert.equal(validateCardPayment({ ...CARD, cvv: '12' }, NOW).cvv, 'validation.cardCvv');
});

test('api/order (C3.3): готовый заказ из браузера больше не принимается — Telegram не вызывается', async () => {
  // Прежний формат: браузер присылал весь заказ, включая сумму и «Оплачен (DEMO)»
  const legacy = {
    id: 'AD-1',
    createdAt: '2026-10-31',
    items: [{ name: 'Rose <b>', quantity: 2, price: 1 }],
    customer: { name: 'Айгерим', lastName: 'Асанова', phone: '+996700123456', email: 'a@mail.com' },
    shipping: { method: 'regions', region: 'issykkul', city: 'karakol', address: 'ул. Токтогула, 12', comment: '' },
    payment: 'cardDemo',
    paymentStatus: 'paidDemo',
    total: 1,
  };
  let calls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    calls++;
    return { ok: true, json: async () => ({ ok: true }) };
  };
  const saved = { ...process.env };
  process.env.TELEGRAM_BOT_TOKEN = '123:test';
  process.env.TELEGRAM_CHAT_ID = '42';
  const res = { code: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  try {
    await handler({ method: 'POST', headers: {}, body: legacy, socket: {} }, res);
  } finally {
    globalThis.fetch = realFetch;
    process.env = saved;
  }
  assert.notEqual(res.code, 200);
  assert.equal(res.body.ok, false);
  assert.equal(calls, 0, 'в Telegram ничего не отправлено');
  assert.doesNotMatch(JSON.stringify(res.body), /Айгерим|700123456|Токтогула/, 'ответ без персональных данных');
});

test('сообщение в Telegram (C3.3): из серверного заказа — адрес, «ожидает оплаты», без «Оплачен (DEMO)» и данных карты', async () => {
  const { buildServerOrder, formatOrderMessage } = await import('../api/_lib/orderCore.js');
  const order = buildServerOrder({
    orderId: 'AD-261106-ABCDEFGH',
    now: new Date('2026-11-06T10:00:00.000Z'),
    uid: null,
    request: {
      customer: { name: 'Айгерим', lastName: 'Асанова', phone: '+996700123456', email: 'a@mail.com' },
      shipping: { method: 'regions', region: 'issykkul', city: 'karakol', address: 'ул. Токтогула, 12', comment: '' },
      paymentMethod: 'cardDemo',
    },
    priced: { lines: [{ productId: 'rose', name: 'Rose <b>', brand: 'B', volume: 50, price: 5000, quantity: 2, lineTotal: 10000 }], totals: { subtotal: 10000, discount: 0, delivery: 450, grandTotal: 10450 }, promo: null },
  });
  const text = formatOrderMessage(order);
  assert.match(text, /Айгерим Асанова \(гость\)/);
  assert.match(text, /Rose &lt;b&gt; \(B\) 50 мл — 2 шт\. × 5000/);
  assert.match(text, /issykkul, karakol, ул\. Токтогула, 12/);
  assert.match(text, /DEMO-оплата картой \(деньги не списаны\) — ожидает оплаты/);
  assert.doesNotMatch(text, /Оплачен|4111|cvv/i);
  assert.equal(order.paymentStatus, 'awaitingPayment');
});
