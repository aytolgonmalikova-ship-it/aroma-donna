// Тесты оформления заказа: данные покупателя, DEMO-оплата картой и сообщение в Telegram.
// Запуск: npm test. Настоящий Telegram не вызывается — вместо fetch подставляется заглушка.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCardPayment, validateCheckout } from '../src/utils/validation.js';
import handler from '../api/order.js';

const CUSTOMER = {
  name: 'Айгерим',
  lastName: 'Асанова',
  phone: '+996 700 123 456',
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

test('api/order: в Telegram уходит статус оплаты и адрес, без данных карты', async () => {
  const order = {
    id: 'AD-1',
    createdAt: '2026-10-31',
    items: [{ name: 'Rose <b>', quantity: 2, price: 5000 }],
    customer: { name: 'Айгерим', lastName: 'Асанова', phone: '+996700123456', email: 'a@mail.com' },
    shipping: { method: 'regions', region: 'issykkul', city: 'karakol', address: 'ул. Токтогула, 12', comment: '' },
    payment: 'cardDemo',
    paymentStatus: 'paidDemo',
    total: 10450,
  };
  let sent;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    sent = JSON.parse(init.body);
    return { ok: true, json: async () => ({ ok: true }) };
  };
  process.env.TELEGRAM_BOT_TOKEN = '123:test';
  process.env.TELEGRAM_CHAT_ID = '42';
  const res = { code: 0, setHeader() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  try {
    await handler({ method: 'POST', body: order }, res);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(res.code, 200);
  assert.match(sent.text, /Айгерим Асанова/);
  assert.match(sent.text, /Оплачен \(DEMO\)/);
  assert.match(sent.text, /Rose &lt;b&gt; — 2 шт\./);
  assert.match(sent.text, /issykkul, karakol, ул\. Токтогула, 12/);
  assert.doesNotMatch(sent.text, /4111|cvv/i);
});
