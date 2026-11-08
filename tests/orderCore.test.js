// C3.3, этап 2: чистая серверная логика заказа (api/_lib/orderCore.js) — без Firebase и сети.
// Проверка схемы и подмен, расчёт по доверенному каталогу, промокоды, отпечаток запроса, ключи HMAC,
// IP, номер заказа, сообщение Telegram. Запуск: npm test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  INITIAL_PAYMENT_STATUS,
  MAX_BODY_BYTES,
  OrderError,
  TELEGRAM_MAX_LENGTH,
  buildServerOrder,
  catalogFromDocs,
  clientIp,
  createServerOrderId,
  escapeHtml,
  formatOrderMessage,
  hmacKey,
  keys,
  parseOrderRequest,
  priceOrder,
  publicOrderResult,
  requestFingerprint,
} from '../api/_lib/orderCore.js';
import { products } from '../src/data/products.js';
import { toFirestoreProduct } from '../src/utils/products.js';
import { ORDER_LIMITS } from '../src/utils/orderLimits.js';
import { calcDelivery, calcDiscount } from '../src/utils/promo.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const SECRET = 'x'.repeat(40);
const RID = '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const GSID = '9a8b7c6d-5e4f-4321-9abc-def012345678';
const inStock = products.filter((p) => p.availability !== 'outOfStock');
const A = inStock[0];
const B = inStock[1];
const volA = A.volumes[0];

/** Корректный запрос гостя: курьер по Бишкеку, одна позиция */
function valid(over = {}) {
  const subtotal = volA.price;
  const total = subtotal + calcDelivery('courier', subtotal);
  return {
    requestId: RID,
    guestSessionId: GSID,
    items: [{ productId: A.id, volume: volA.ml, quantity: 1 }],
    promoCode: null,
    deliveryMethod: 'courier',
    paymentMethod: 'cashOnDelivery',
    customer: { name: 'Айгерим', lastName: 'Асанова', phone: '700123456', email: 'Aigerim@Mail.com ' },
    shipping: { region: 'bishkek', city: 'bishkek', address: 'ул. Токтогула, 12', comment: '' },
    agree: true,
    expectedTotal: total,
    ...over,
  };
}
const fieldsOf = (fn) => {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof OrderError, String(err));
    assert.equal(err.status, 400);
    return err.details.fields;
  }
  assert.fail('ожидалась ошибка 400');
};

test('parseOrderRequest: корректный запрос нормализуется (телефон E.164, e-mail в нижнем регистре, адрес без пробелов)', () => {
  const r = parseOrderRequest(valid());
  assert.equal(r.customer.phone, '+996700123456');
  assert.equal(r.customer.email, 'aigerim@mail.com');
  assert.deepEqual(r.shipping, { method: 'courier', region: 'bishkek', city: 'bishkek', address: 'ул. Токтогула, 12', comment: '' });
  assert.deepEqual(Object.keys(r).sort(), ['customer', 'deliveryMethod', 'expectedTotal', 'guestSessionId', 'items', 'paymentMethod', 'promoCode', 'requestId', 'shipping']);
  // Самовывоз: адрес не нужен и не сохраняется
  const p = parseOrderRequest(valid({ deliveryMethod: 'pickup', shipping: { comment: ' позвонить ' } }));
  assert.deepEqual(p.shipping, { method: 'pickup', region: null, city: null, address: null, comment: 'позвонить' });
});

test('подмена: лишние поля userId, total, price, paymentStatus, status, createdAt, id — 400', () => {
  for (const extra of [{ userId: 'other-uid' }, { total: 1 }, { paymentStatus: 'paidDemo' }, { status: 'delivered' }, { createdAt: '2020-01-01' }, { id: 'AD-1' }, { subtotal: 1 }, { __proto__x: 1 }]) {
    const f = fieldsOf(() => parseOrderRequest(valid(extra)));
    assert.equal(f[Object.keys(extra)[0]], 'unknown', JSON.stringify(extra));
  }
  // Цена и название в позиции
  const f = fieldsOf(() => parseOrderRequest(valid({ items: [{ productId: A.id, volume: volA.ml, quantity: 1, price: 1 }] })));
  assert.equal(f['items.0'], 'shape');
  // Лишнее поле у покупателя и адреса
  assert.equal(fieldsOf(() => parseOrderRequest(valid({ customer: { ...valid().customer, role: 'admin' } }))).customer, 'shape');
  assert.equal(fieldsOf(() => parseOrderRequest(valid({ shipping: { ...valid().shipping, lat: 1 } }))).shipping, 'shape');
});

test('позиции: 1–20, без дублей; null, массивы и неожиданные типы — 400', () => {
  const line = (i) => ({ productId: `p${i}`, volume: 50, quantity: 1 });
  assert.equal(parseOrderRequest(valid({ items: Array.from({ length: ORDER_LIMITS.maxLines }, (_, i) => line(i)) })).items.length, 20);
  assert.equal(fieldsOf(() => parseOrderRequest(valid({ items: Array.from({ length: 21 }, (_, i) => line(i)) }))).items, 'count');
  assert.equal(fieldsOf(() => parseOrderRequest(valid({ items: [] }))).items, 'count');
  for (const items of [null, 'p1', { 0: line(0) }, 5]) assert.equal(fieldsOf(() => parseOrderRequest(valid({ items }))).items, 'count');
  for (const bad of [null, [], 'x', 5, [line(0)]]) assert.equal(fieldsOf(() => parseOrderRequest(valid({ items: [bad] })))['items.0'], 'shape', JSON.stringify(bad));
  assert.equal(fieldsOf(() => parseOrderRequest(valid({ items: [line(0), line(0)] })))['items.1'], 'duplicate');
});

test('количество 1–10 (целое); объём — целое 1–1000; productId — формат каталога', () => {
  const it = (over) => [{ productId: 'rose-poudree', volume: 50, quantity: 1, ...over }];
  for (const q of [1, 10]) assert.equal(parseOrderRequest(valid({ items: it({ quantity: q }) })).items[0].quantity, q);
  for (const q of [0, 11, -1, 1.5, '2', null, NaN]) assert.equal(fieldsOf(() => parseOrderRequest(valid({ items: it({ quantity: q }) })))['items.0.quantity'], 'range', String(q));
  for (const v of [0, 1001, 50.5, '50', null]) assert.equal(fieldsOf(() => parseOrderRequest(valid({ items: it({ volume: v }) })))['items.0.volume'], 'format', String(v));
  for (const id of ['Rose', 'rose_poudree', '../x', '', 'a'.repeat(61), 5, null, '__proto__']) {
    assert.equal(fieldsOf(() => parseOrderRequest(valid({ items: it({ productId: id }) })))['items.0.productId'], 'format', String(id));
  }
});

test('строки: длины, телефон, e-mail, регион и город, курьер только Бишкек', () => {
  const c = valid().customer;
  assert.equal(fieldsOf(() => parseOrderRequest(valid({ customer: { ...c, name: 'А' } })))['customer.name'], 'length');
  assert.equal(fieldsOf(() => parseOrderRequest(valid({ customer: { ...c, name: 'А'.repeat(ORDER_LIMITS.nameMax + 1) } })))['customer.name'], 'length');
  assert.equal(parseOrderRequest(valid({ customer: { ...c, name: 'А'.repeat(ORDER_LIMITS.nameMax) } })).customer.name.length, ORDER_LIMITS.nameMax);
  for (const phone of ['+996700123456', '0700123456', '70012345', '070012345', 700123456, null]) {
    assert.equal(fieldsOf(() => parseOrderRequest(valid({ customer: { ...c, phone } })))['customer.phone'], 'format', String(phone));
  }
  for (const email of ['нет', 'a@b', `${'a'.repeat(250)}@x.kg`, null]) assert.equal(fieldsOf(() => parseOrderRequest(valid({ customer: { ...c, email } })))['customer.email'], 'format', String(email));
  const s = valid().shipping;
  assert.equal(fieldsOf(() => parseOrderRequest(valid({ shipping: { ...s, region: 'osh', city: 'osh' } })))['shipping.city'], 'courier');
  assert.equal(fieldsOf(() => parseOrderRequest(valid({ deliveryMethod: 'regions', shipping: { ...s, region: 'osh', city: 'karakol' } })))['shipping.city'], 'unknown');
  assert.equal(parseOrderRequest(valid({ deliveryMethod: 'regions', shipping: { ...s, region: 'issykkul', city: 'karakol' } })).shipping.city, 'karakol');
  assert.equal(fieldsOf(() => parseOrderRequest(valid({ shipping: { ...s, address: 'abc' } })))['shipping.address'], 'length');
  assert.equal(fieldsOf(() => parseOrderRequest(valid({ shipping: { ...s, address: 'a'.repeat(ORDER_LIMITS.addressMax + 1) } })))['shipping.address'], 'length');
  assert.equal(fieldsOf(() => parseOrderRequest(valid({ shipping: { ...s, comment: 'a'.repeat(ORDER_LIMITS.commentMax + 1) } })))['shipping.comment'], 'length');
  assert.equal(fieldsOf(() => parseOrderRequest(valid({ shipping: { ...s, comment: ['x'] } })))['shipping.comment'], 'length');
});

test('прочие поля: requestId и guestSessionId — UUID; способы доставки и оплаты из списка; согласие; expectedTotal — целое', () => {
  for (const id of ['', 'abc', 'not-a-uuid-at-all-0000000000000000', 5, null]) assert.equal(fieldsOf(() => parseOrderRequest(valid({ requestId: id }))).requestId, 'uuid');
  assert.equal(fieldsOf(() => parseOrderRequest(valid({ guestSessionId: 'x' }))).guestSessionId, 'uuid');
  assert.equal(parseOrderRequest(valid({ guestSessionId: undefined })).guestSessionId, null);
  for (const m of ['express', '__proto__', 'toString', null]) assert.equal(fieldsOf(() => parseOrderRequest(valid({ deliveryMethod: m }))).deliveryMethod, 'unknown');
  for (const m of ['paidDemo', 'card', null]) assert.equal(fieldsOf(() => parseOrderRequest(valid({ paymentMethod: m }))).paymentMethod, 'unknown');
  for (const a of [false, 'true', 1, undefined]) assert.equal(fieldsOf(() => parseOrderRequest(valid({ agree: a }))).agree, 'required');
  for (const t of [-1, 1.5, '100', null, 1e9]) assert.equal(fieldsOf(() => parseOrderRequest(valid({ expectedTotal: t }))).expectedTotal, 'format', String(t));
  for (const p of ['A B', 'x'.repeat(33), 5, {}]) assert.equal(fieldsOf(() => parseOrderRequest(valid({ promoCode: p }))).promoCode, 'format', JSON.stringify(p));
  assert.equal(parseOrderRequest(valid({ promoCode: ' welcome15 ' })).promoCode, 'WELCOME15');
  for (const body of [null, [], 'x', 5]) assert.throws(() => parseOrderRequest(body), (e) => e.status === 400);
});

test('catalogFromDocs: скрытые, удалённые и повреждённые товары исключаются', () => {
  const doc = (p, over = {}) => ({ id: p.id, exists: true, data: { ...toFirestoreProduct(p), ...over } });
  const catalog = catalogFromDocs([
    doc(A),
    doc(B, { hidden: true }),
    { id: 'gone', exists: false, data: null },
    { id: 'broken', exists: true, data: { name: '' } },
    { id: 'nohidden', exists: true, data: (() => { const d = toFirestoreProduct(A); delete d.hidden; return d; })() },
  ]);
  assert.deepEqual(catalog.map((p) => p.id), [A.id]);
});

test('priceOrder: итог по доверенному каталогу; подмена суммы — 409 total_changed с ценами сервера', () => {
  const req = parseOrderRequest(valid());
  const priced = priceOrder(req, products);
  assert.equal(priced.lines[0].price, volA.price);
  assert.equal(priced.totals.grandTotal, req.expectedTotal);
  // Браузер «заявил» сумму 1 KGS
  assert.throws(() => priceOrder({ ...req, expectedTotal: 1 }, products), (e) => {
    assert.equal(e.status, 409);
    assert.equal(e.code, 'total_changed');
    assert.equal(e.details.totals.total, req.expectedTotal);
    assert.equal(e.details.lines[0].price, volA.price);
    return true;
  });
  // Цена в каталоге изменилась — та же реакция
  const changed = products.map((p) => (p.id === A.id ? { ...p, volumes: p.volumes.map((v) => ({ ...v, price: v.price + 100 })) } : p));
  assert.throws(() => priceOrder(req, changed), (e) => e.code === 'total_changed');
});

test('priceOrder: скрытый/удалённый, нет в наличии, нет объёма — 409 items_unavailable с причинами', () => {
  const out = products.find((p) => p.availability === 'outOfStock');
  const req = parseOrderRequest(
    valid({
      items: [
        { productId: 'deleted-product', volume: 50, quantity: 1 },
        ...(out ? [{ productId: out.id, volume: out.volumes[0].ml, quantity: 1 }] : []),
        { productId: A.id, volume: 999, quantity: 1 },
        { productId: B.id, volume: B.volumes[0].ml, quantity: 2 },
      ],
    }),
  );
  assert.throws(() => priceOrder(req, products), (e) => {
    assert.equal(e.code, 'items_unavailable');
    const reasons = Object.fromEntries(e.details.problems.map((p) => [p.productId, p.reason]));
    assert.equal(reasons['deleted-product'], 'missing');
    if (out) assert.equal(reasons[out.id], 'outOfStock');
    assert.equal(reasons[A.id], 'volumeUnavailable');
    assert.equal(reasons[B.id], undefined);
    return true;
  });
});

test('промокоды: скидка по серверным правилам; неизвестный — promo_invalid; ниже минимума — promo_min_total; WELCOME15 — одноразовый', () => {
  const big = [...A.volumes].sort((x, y) => y.price - x.price)[0];
  const items = [{ productId: A.id, volume: big.ml, quantity: 3 }];
  const subtotal = big.price * 3;
  const expected = (code) => {
    const discount = calcDiscount(subtotal, code);
    return subtotal - discount + calcDelivery('courier', subtotal - discount);
  };
  const ok = priceOrder(parseOrderRequest(valid({ items, promoCode: 'WELCOME15', expectedTotal: expected('WELCOME15') })), products);
  assert.equal(ok.totals.discount, calcDiscount(subtotal, 'WELCOME15'));
  assert.deepEqual(ok.promo, { code: 'WELCOME15', oneTime: true });
  assert.deepEqual(priceOrder(parseOrderRequest(valid({ items, promoCode: 'AROMA10', expectedTotal: expected('AROMA10') })), products).promo, { code: 'AROMA10', oneTime: false });
  assert.throws(() => priceOrder(parseOrderRequest(valid({ items, promoCode: 'FREE100', expectedTotal: 1 })), products), (e) => e.code === 'promo_invalid');
  assert.throws(() => priceOrder(parseOrderRequest(valid({ promoCode: 'TOSTRING' })), products), (e) => e.code === 'promo_invalid');
  const cheap = { productId: A.id, volume: volA.ml, quantity: 1 };
  if (volA.price < 5000) assert.throws(() => priceOrder(parseOrderRequest(valid({ items: [cheap], promoCode: 'DONNA500' })), products), (e) => e.code === 'promo_min_total');
});

test('buildServerOrder: только доверенные поля; статусы и номер — от сервера; ответ покупателю без персональных данных', () => {
  const req = parseOrderRequest(valid({ paymentMethod: 'cardDemo' }));
  const priced = priceOrder(req, products);
  const now = new Date('2026-11-06T10:00:00.000Z');
  const order = buildServerOrder({ orderId: 'AD-261106-ABCDEFGH', now, uid: null, request: req, priced });
  assert.deepEqual(Object.keys(order).sort(), ['createdAt', 'customer', 'customerType', 'delivery', 'discount', 'id', 'items', 'mode', 'notification', 'payment', 'paymentStatus', 'promoCode', 'shipping', 'status', 'subtotal', 'total', 'userId']);
  assert.equal(order.paymentStatus, INITIAL_PAYMENT_STATUS);
  assert.equal(order.payment, 'cardDemo');
  assert.equal(order.status, 'new');
  assert.equal(order.userId, null);
  assert.equal(order.customerType, 'guest');
  assert.equal(order.createdAt, now.toISOString());
  assert.deepEqual(order.notification, { status: 'pending', attempts: 0, leaseUntil: null, sentAt: null, lastError: null });
  assert.deepEqual(Object.keys(order.items[0]).sort(), ['brand', 'id', 'name', 'price', 'quantity', 'volume']);
  const reg = buildServerOrder({ orderId: 'AD-1', now, uid: 'uid-1', request: req, priced });
  assert.equal(reg.userId, 'uid-1');
  assert.equal(reg.customerType, 'registered');
  const pub = publicOrderResult(order);
  assert.doesNotMatch(JSON.stringify(pub), /700123456|aigerim@|Токтогула|Айгерим/);
  assert.equal(pub.paymentStatus, 'awaitingPayment');
});

test('requestFingerprint: не зависит от requestId и порядка ключей; меняется при любом изменении содержимого', () => {
  const r = parseOrderRequest(valid());
  const f = requestFingerprint(r);
  assert.equal(f, requestFingerprint({ ...r, requestId: '00000000-0000-4000-8000-000000000000' }));
  assert.equal(f, requestFingerprint(Object.fromEntries(Object.entries(r).reverse())));
  assert.notEqual(f, requestFingerprint({ ...r, items: [{ ...r.items[0], quantity: 2 }] }));
  assert.notEqual(f, requestFingerprint({ ...r, customer: { ...r.customer, phone: '+996700123457' } }));
  assert.notEqual(f, requestFingerprint({ ...r, expectedTotal: r.expectedTotal + 1 }));
});

test('HMAC-ключи: без открытых данных, зависят от секрета и области; короткий секрет запрещён', () => {
  assert.throws(() => hmacKey('short', 'a'));
  const k1 = keys.idempotency(SECRET, 'u:uid-1', RID);
  assert.notEqual(k1, keys.idempotency(SECRET, 'u:uid-2', RID), 'область — UID');
  assert.notEqual(k1, keys.idempotency(SECRET, `g:${GSID}`, RID));
  assert.notEqual(k1, keys.idempotency('y'.repeat(40), 'u:uid-1', RID), 'зависит от секрета');
  assert.match(k1, /^[0-9a-f]{64}$/);
  const guest = keys.guest(SECRET, GSID);
  assert.match(guest, /^[0-9a-f]{40}$/);
  const promoUser = keys.promo(SECRET, 'WELCOME15', { uid: 'uid-1', phone: '+996700123456', email: 'a@a.kg' });
  const promoGuest = keys.promo(SECRET, 'WELCOME15', { uid: null, phone: '+996700123456', email: 'a@a.kg' });
  assert.equal(promoUser.length, 2);
  assert.equal(promoGuest.length, 2);
  assert.equal(promoUser[1], promoGuest[0], 'телефон — общий ключ для вошедшего и гостя');
  for (const k of [...promoUser, ...promoGuest, guest, keys.rate(SECRET, 'ip', '203.0.113.5')]) assert.doesNotMatch(k, /700123456|a@a|uid-1|203\.0/);
});

test('clientIp: на Vercel — только x-vercel-forwarded-for; вне Vercel заголовки клиента не читаются', () => {
  const headers = { 'x-forwarded-for': '1.1.1.1', 'x-real-ip': '2.2.2.2', 'x-vercel-forwarded-for': '203.0.113.5, 10.0.0.1' };
  assert.equal(clientIp({ headers, socketAddress: '9.9.9.9', onVercel: true }), '203.0.113.5');
  assert.equal(clientIp({ headers: { 'x-forwarded-for': '1.1.1.1' }, socketAddress: '9.9.9.9', onVercel: true }), null, 'X-Forwarded-For не используется');
  assert.equal(clientIp({ headers, socketAddress: '9.9.9.9', onVercel: false }), '9.9.9.9');
  assert.equal(clientIp({ headers, socketAddress: '::ffff:127.0.0.1', onVercel: false }), '127.0.0.1');
  assert.equal(clientIp({ headers: { 'x-vercel-forwarded-for': 'не ip' }, onVercel: true }), null);
  assert.equal(clientIp({ headers: {}, socketAddress: undefined, onVercel: false }), null);
});

test('номер заказа: формат AD-ГГММДД-XXXXXXXX, криптослучайный суффикс', () => {
  const id = createServerOrderId(new Date('2026-11-06T10:00:00Z'));
  assert.match(id, /^AD-261106-[A-HJ-NP-Z2-9]{8}$/);
  const many = new Set(Array.from({ length: 2000 }, () => createServerOrderId(new Date())));
  assert.equal(many.size, 2000);
  assert.equal(createServerOrderId(new Date('2026-01-02T00:00:00Z'), () => Buffer.alloc(8)), 'AD-260102-AAAAAAAA');
});

test('Telegram: экранирование HTML, не больше 20 позиций, не длиннее 4000 символов, разметка не разрезана', () => {
  assert.equal(escapeHtml(`<a href="x">'&`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
  const base = buildServerOrder({
    orderId: 'AD-261106-ABCDEFGH',
    now: new Date('2026-11-06T10:00:00Z'),
    uid: null,
    request: { customer: { name: '<b>Хакер</b>', lastName: '&', phone: '+996700123456', email: 'a@a.kg' }, shipping: { method: 'regions', region: 'osh', city: 'osh', address: 'a'.repeat(300), comment: '<script>'.repeat(40) }, paymentMethod: 'cashOnDelivery' },
    priced: {
      lines: Array.from({ length: 20 }, (_, i) => ({ productId: `p${i}`, name: `<i>Товар ${i}</i>`.repeat(10), brand: 'Б&Р'.repeat(30), volume: 50, price: 1000, quantity: 1, lineTotal: 1000 })),
      totals: { subtotal: 20000, discount: 0, delivery: 0, grandTotal: 20000 },
      promo: null,
    },
  });
  const text = formatOrderMessage(base);
  assert.ok(text.length <= TELEGRAM_MAX_LENGTH, `длина ${text.length}`);
  assert.doesNotMatch(text, /<script>|<i>|<b>Хакер/);
  // Разрешены только теги <b> разметки сообщения; сущности целые
  assert.deepEqual([...new Set(text.match(/<\/?[a-z]+>/g))].sort(), ['</b>', '<b>']);
  assert.doesNotMatch(text, /&[a-z#0-9]*(?![a-z#0-9;])(?<!;)$/m);
  assert.match(text, /…и ещё \d+/, 'длинные позиции убраны целиком');
  assert.match(text, /\(гость\)/);
  assert.doesNotMatch(text, /Оплачен/);
});

test('ограничения API и общие модули: 16 КБ; лимиты — из orderLimits.js; без браузерных API и клиентского Firebase', () => {
  assert.equal(MAX_BODY_BYTES, 16 * 1024);
  const core = read('api/_lib/orderCore.js');
  assert.match(core, /from '\.\.\/\.\.\/src\/utils\/orderLimits\.js'/);
  assert.doesNotMatch(core, /maxLines\s*[:=]\s*20|quantity\s*<=\s*10/, 'значения не продублированы');
  for (const file of ['api/_lib/orderCore.js', 'api/_lib/orderStore.js', 'api/_lib/orderHandler.js', 'api/_lib/firebaseAdmin.js', 'api/order.js']) {
    const code = read(file).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(code, /\b(window|document|localStorage|sessionStorage)\b/, file);
    assert.doesNotMatch(code, /from ['"](react|firebase\/|\.\.\/\.\.\/src\/services)/, file);
    assert.doesNotMatch(code, /from ['"][^'"]+\.jsx['"]/, file);
  }
});

test('Telegram: регион и город — русскими названиями (те же, что в переводах), без технических ключей', async () => {
  const { REGION_LABELS, CITY_LABELS, formatRegionCity } = await import('../api/_lib/orderCore.js');
  const { REGIONS } = await import('../src/data/regions.js');
  const ru = JSON.parse(read('src/locales/ru/translation.json'));
  assert.deepEqual(REGION_LABELS, ru.regions, 'регионы совпадают с переводом');
  assert.deepEqual(CITY_LABELS, ru.cities, 'города совпадают с переводом');
  // Каждая пара из формы получает название, а не ключ
  for (const [region, cities] of Object.entries(REGIONS)) {
    for (const city of cities) assert.doesNotMatch(formatRegionCity(region, city), /[a-z]/, `${region}/${city}`);
  }
  assert.equal(formatRegionCity('issykkul', 'karakol'), 'Иссык-Кульская область, г. Каракол');
  assert.equal(formatRegionCity('bishkek', 'bishkek'), 'г. Бишкек');
  assert.equal(formatRegionCity('chui', 'tokmok'), 'Чуйская область, г. Токмок');
  assert.equal(formatRegionCity('unknown', 'x'), 'unknown, x', 'неизвестный ключ — как есть, ничего не теряется');
  assert.equal(formatRegionCity(null, null), '');

  const order = buildServerOrder({
    orderId: 'AD-261108-ABCDEFGH',
    now: new Date('2026-11-08T10:00:00Z'),
    uid: null,
    request: { customer: { name: 'Айгерим', lastName: 'Т', phone: '+996700123456', email: 'a@a.kg' }, shipping: { method: 'regions', region: 'issykkul', city: 'karakol', address: 'ул. Тестовая, 1', comment: '' }, paymentMethod: 'cashOnDelivery' },
    priced: { lines: [{ productId: 'p', name: 'Т', brand: 'Б', volume: 30, price: 1000, quantity: 1, lineTotal: 1000 }], totals: { subtotal: 1000, discount: 0, delivery: 450, grandTotal: 1450 }, promo: null },
  });
  const text = formatOrderMessage(order);
  assert.match(text, /<b>Адрес:<\/b> Иссык-Кульская область, г\. Каракол, ул\. Тестовая, 1/);
  assert.doesNotMatch(text, /issykkul|karakol/);
  // В сохранённом заказе ключи не меняются — только текст сообщения
  assert.deepEqual([order.shipping.region, order.shipping.city], ['issykkul', 'karakol']);
});
