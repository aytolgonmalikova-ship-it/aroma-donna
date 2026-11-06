// Тесты проверки корзины по свежему каталогу перед оформлением заказа (подэтап 5в.7):
// изменение цены, скрытие и удаление товара, исчезнувший объём, нет в наличии, резервный каталог,
// заказ гостя и авторизованного покупателя. Запуск: npm test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { products } from '../src/data/products.js';
import { buildCartLines, makeKey } from '../src/utils/cart.js';
import { calcDelivery, calcDiscount } from '../src/utils/promo.js';
import { CHECKOUT_PROBLEMS, buildOrder, checkoutTotals, reviewCheckout, verifyCartLines } from '../src/utils/checkoutReview.js';
import handler from '../api/order.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const [rose, oud, third] = products;
const entry = (product, volume, quantity = 1) => ({ key: makeKey(product.id, volume), id: product.id, volume, quantity });
const vol = (product, i = 0) => product.volumes[i].ml;
const withPrice = (product, ml, price) => ({
  ...product,
  volumes: product.volumes.map((v) => (v.ml === ml ? { ...v, price } : v)),
  price: Math.min(...product.volumes.map((v) => (v.ml === ml ? price : v.price))),
});

const VALUES = {
  name: ' Айгерим ',
  lastName: 'Асанова',
  phone: '700123456', // форма (PhoneField): 9 цифр после +996
  email: 'aigerim@mail.com',
  delivery: 'courier',
  region: '',
  city: '',
  address: 'ул. Токтогула, 12',
  comment: '',
  payment: 'cashOnDelivery',
  agree: true,
};

/**
 * Что видел покупатель (каталог из Redux) и что лежит в корзине; fresh — каталог из Firestore
 * прямо перед оформлением. Возвращает аргументы reviewCheckout, как их собирает CheckoutPage.
 */
function scenario({ seenCatalog, fresh, cart, promoCode = null, deliveryMethod = 'courier', expectedSource = 'firestore' }) {
  const seenLines = buildCartLines(cart, seenCatalog);
  const subtotal = seenLines.reduce((s, l) => s + l.lineTotal, 0);
  const total = subtotal - calcDiscount(subtotal, promoCode);
  return {
    cartItems: cart,
    seenLines,
    seenGrandTotal: total + calcDelivery(deliveryMethod, total),
    fresh: { items: fresh, source: 'firestore', ...(Array.isArray(fresh) ? {} : fresh) },
    expectedSource,
    promoCode,
    deliveryMethod,
  };
}

test('каталог не изменился — ok, суммы совпадают с тем, что видел покупатель', () => {
  const cart = [entry(rose, vol(rose), 2), entry(oud, vol(oud, 1))];
  const args = scenario({ seenCatalog: products, fresh: products, cart });
  const r = reviewCheckout(args);
  assert.equal(r.status, 'ok');
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.priceChanges, []);
  assert.equal(r.totals.grandTotal, args.seenGrandTotal);
  assert.ok(r.lines.every((l) => l.status === 'ok'));
});

test('изменилась цена — confirm: новая цена, сумма пересчитана, после подтверждения — ok', () => {
  const ml = vol(rose);
  const cart = [entry(rose, ml, 2), entry(oud, vol(oud))];
  const newPrice = rose.volumes[0].price + 700;
  const freshCatalog = products.map((p) => (p.id === rose.id ? withPrice(p, ml, newPrice) : p));
  const r = reviewCheckout(scenario({ seenCatalog: products, fresh: freshCatalog, cart }));
  assert.equal(r.status, 'confirm');
  assert.equal(r.priceChanges.length, 1);
  const [change] = r.priceChanges;
  assert.equal(change.oldPrice, rose.volumes[0].price);
  assert.equal(change.price, newPrice);
  assert.equal(change.lineTotal, newPrice * 2);
  assert.equal(r.totals.subtotal, newPrice * 2 + oud.volumes[0].price);
  // Повторное подтверждение: страница уже показывает свежий каталог — проверка проходит
  const again = reviewCheckout(scenario({ seenCatalog: freshCatalog, fresh: freshCatalog, cart }));
  assert.equal(again.status, 'ok');
  assert.equal(again.totals.grandTotal, r.totals.grandTotal);
});

test('цена снизилась — тоже повторное подтверждение (покупатель видит новую сумму)', () => {
  const ml = vol(rose);
  const cart = [entry(rose, ml)];
  const freshCatalog = products.map((p) => (p.id === rose.id ? withPrice(p, ml, rose.volumes[0].price - 500) : p));
  const r = reviewCheckout(scenario({ seenCatalog: products, fresh: freshCatalog, cart }));
  assert.equal(r.status, 'confirm');
  assert.ok(r.totals.grandTotal < reviewCheckout(scenario({ seenCatalog: products, fresh: products, cart })).totals.grandTotal);
});

test('скидка и доставка пересчитываются по новым ценам', () => {
  // Дорогая позиция: бесплатная доставка курьером от 7000 и скидка промокода
  const big = { ...rose, volumes: [{ ml: 100, price: 8000 }], price: 8000 };
  const cart = [entry(big, 100)];
  const cheaper = { ...big, volumes: [{ ml: 100, price: 6000 }], price: 6000 };
  const r = reviewCheckout(scenario({ seenCatalog: [big], fresh: [cheaper], cart, promoCode: 'AROMA10' }));
  assert.equal(r.status, 'confirm');
  const expected = checkoutTotals([{ lineTotal: 6000 }], 'AROMA10', 'courier');
  assert.deepEqual(r.totals, expected);
  assert.equal(r.totals.discount, calcDiscount(6000, 'AROMA10'));
  assert.equal(r.totals.delivery, calcDelivery('courier', 6000 - r.totals.discount));
});

test('товар скрыли — blocked (missing): заказ не оформляется, название — из того, что видел покупатель', () => {
  const cart = [entry(rose, vol(rose)), entry(oud, vol(oud))];
  // Витрина читает только hidden == false: скрытого товара в свежем каталоге нет
  const freshCatalog = products.filter((p) => p.id !== rose.id);
  const r = reviewCheckout(scenario({ seenCatalog: products, fresh: freshCatalog, cart }));
  assert.equal(r.status, 'blocked');
  assert.deepEqual(r.problems.map((l) => [l.id, l.status, l.name]), [[rose.id, 'missing', rose.name]]);
  // В сумме — только доступные позиции
  assert.equal(r.totals.subtotal, oud.volumes[0].price);
});

test('товар удалили — тоже blocked (missing); все товары удалены — каждая позиция в списке проблем', () => {
  const cart = [entry(rose, vol(rose)), entry(oud, vol(oud))];
  const r = reviewCheckout(scenario({ seenCatalog: products, fresh: [third], cart }));
  assert.equal(r.status, 'blocked');
  assert.deepEqual(r.problems.map((l) => l.id), [rose.id, oud.id]);
  assert.equal(r.totals.subtotal, 0);
});

test('объём больше не продаётся — blocked (volumeUnavailable), другой объём не подставляется', () => {
  const ml = vol(rose);
  const cart = [entry(rose, ml)];
  const freshRose = { ...rose, volumes: rose.volumes.filter((v) => v.ml !== ml) };
  const r = reviewCheckout(scenario({ seenCatalog: products, fresh: [freshRose, oud], cart }));
  assert.equal(r.status, 'blocked');
  const [line] = r.problems;
  assert.equal(line.status, 'volumeUnavailable');
  assert.equal(line.volume, ml); // объём прежний
  assert.equal(line.price, null);
  assert.equal(line.lineTotal, 0);
});

test('товар закончился (outOfStock) — blocked по существующей логике наличия', () => {
  const cart = [entry(rose, vol(rose))];
  const r = reviewCheckout(
    scenario({ seenCatalog: products, fresh: [{ ...rose, availability: 'outOfStock' }], cart }),
  );
  assert.equal(r.status, 'blocked');
  assert.equal(r.problems[0].status, 'outOfStock');
  // «Мало осталось» оформлять можно
  const low = reviewCheckout(scenario({ seenCatalog: products, fresh: [{ ...rose, availability: 'lowStock' }], cart }));
  assert.equal(low.status, 'ok');
});

test('проблемы важнее изменения цены: при недоступном товаре подтверждение по новым ценам не предлагается', () => {
  const cart = [entry(rose, vol(rose)), entry(oud, vol(oud))];
  const freshCatalog = [withPrice(oud, vol(oud), oud.volumes[0].price + 100)];
  const r = reviewCheckout(scenario({ seenCatalog: products, fresh: freshCatalog, cart }));
  assert.equal(r.status, 'blocked');
  assert.equal(r.priceChanges.length, 1);
  assert.ok(CHECKOUT_PROBLEMS.includes(r.problems[0].status));
});

test('устаревший Redux: товара не было в старом каталоге, а в свежем он есть — нужно подтверждение', () => {
  const cart = [entry(rose, vol(rose))];
  const r = reviewCheckout(scenario({ seenCatalog: [], fresh: products, cart }));
  assert.equal(r.status, 'confirm');
  assert.equal(r.priceChanges[0].oldPrice, null);
});

test('localStorage: цена и название в заказе — только из свежего каталога', () => {
  const ml = vol(rose);
  const cart = [{ ...entry(rose, ml), price: 1, name: 'Подделка' }]; // лишние поля из localStorage игнорируются
  const renamed = { ...rose, name: 'Rose Poudrée Intense' };
  const r = reviewCheckout(scenario({ seenCatalog: [renamed], fresh: [renamed], cart }));
  assert.equal(r.status, 'ok');
  const order = buildOrder({
    id: 'AD-1',
    createdAt: '2026-11-03T10:00:00.000Z',
    user: null,
    lines: r.lines,
    totals: r.totals,
    promoCode: null,
    values: VALUES,
    paymentStatus: 'awaitingPayment',
  });
  assert.equal(order.items[0].price, rose.volumes[0].price);
  assert.equal(order.items[0].name, 'Rose Poudrée Intense');
});

test('каталог переключился на резервный (демо) — unverified: демо-каталог не используется для заказа', () => {
  const cart = [entry(rose, vol(rose))];
  const r = reviewCheckout(scenario({ seenCatalog: products, fresh: { items: products, source: 'fallback' }, cart }));
  assert.equal(r.status, 'unverified');
  assert.deepEqual(r.lines, []);
  // Демо-режим без Firebase и ещё не импортированный каталог работают как раньше
  for (const source of ['demo', 'fallback']) {
    const ok = reviewCheckout(
      scenario({ seenCatalog: products, fresh: { items: products, source }, cart, expectedSource: source }),
    );
    assert.equal(ok.status, 'ok', source);
  }
});

test('buildOrder: структура заказа прежняя; гость — userId null, покупатель — его uid', () => {
  const cart = [entry(rose, vol(rose), 2)];
  const r = reviewCheckout(scenario({ seenCatalog: products, fresh: products, cart, promoCode: 'AROMA10' }));
  const make = (user, payment = 'cashOnDelivery', paymentStatus = 'awaitingPayment') =>
    buildOrder({
      id: 'AD-2',
      createdAt: '2026-11-03T10:00:00.000Z',
      user,
      lines: r.lines,
      totals: r.totals,
      promoCode: 'AROMA10',
      values: { ...VALUES, payment },
      paymentStatus,
    });
  const guest = make(null);
  const member = make({ uid: 'uid-1', name: 'Айгерим' }, 'cardDemo', 'paidDemo');
  const KEYS = ['createdAt', 'customer', 'delivery', 'discount', 'id', 'items', 'payment', 'paymentStatus', 'promoCode', 'shipping', 'subtotal', 'total', 'userId'];
  assert.deepEqual(Object.keys(guest).sort(), KEYS);
  assert.deepEqual(Object.keys(guest.items[0]).sort(), ['brand', 'id', 'name', 'price', 'quantity', 'volume']);
  assert.equal(guest.userId, null);
  assert.equal(member.userId, 'uid-1');
  assert.equal(member.paymentStatus, 'paidDemo');
  assert.equal(guest.customer.name, 'Айгерим');
  assert.equal(guest.total, r.totals.grandTotal);
  assert.equal(guest.promoCode, r.totals.discount > 0 ? 'AROMA10' : null);
  // Самовывоз: адрес не сохраняется
  const pickup = buildOrder({ ...{ id: 'AD-3', createdAt: '', user: null, lines: r.lines, totals: r.totals, promoCode: null, paymentStatus: 'awaitingPayment' }, values: { ...VALUES, delivery: 'pickup' } });
  assert.deepEqual([pickup.shipping.region, pickup.shipping.city, pickup.shipping.address], [null, null, null]);
});

test('C3.3: заказ из браузера больше не отправляется в Telegram; сообщение строит сервер из своих данных', async () => {
  const r = reviewCheckout(scenario({ seenCatalog: products, fresh: products, cart: [entry(rose, vol(rose))] }));
  const order = buildOrder({
    id: 'AD-4',
    createdAt: '2026-11-03T10:00:00.000Z',
    user: null,
    lines: r.lines,
    totals: r.totals,
    promoCode: null,
    values: VALUES,
    paymentStatus: 'awaitingPayment',
  });
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
    await handler({ method: 'POST', headers: {}, body: { ...order, mode: 'demo', status: 'demo' }, socket: {} }, res);
  } finally {
    globalThis.fetch = realFetch;
    process.env = saved;
  }
  assert.notEqual(res.code, 200);
  assert.equal(calls, 0);
  // Сервер считает по тем же функциям, что и витрина: название и сумма — из каталога
  const { priceOrder, buildServerOrder, formatOrderMessage } = await import('../api/_lib/orderCore.js');
  const request = {
    items: [{ productId: rose.id, volume: vol(rose), quantity: 1 }],
    promoCode: null,
    deliveryMethod: 'courier',
    paymentMethod: 'cashOnDelivery',
    customer: { name: 'Айгерим', lastName: 'Асанова', phone: '+996700123456', email: 'aigerim@mail.com' },
    shipping: { method: 'courier', region: 'bishkek', city: 'bishkek', address: 'ул. Токтогула, 12', comment: '' },
    expectedTotal: r.totals.grandTotal,
  };
  const priced = priceOrder(request, products);
  assert.equal(priced.totals.grandTotal, r.totals.grandTotal, 'сервер и витрина считают одинаково');
  const text = formatOrderMessage(buildServerOrder({ orderId: 'AD-261106-ABCDEFGH', now: new Date('2026-11-06T10:00:00Z'), uid: null, request, priced }));
  assert.ok(text.includes(rose.name));
});

test('verifyCartLines: исходные данные не меняются', () => {
  const cart = [entry(rose, vol(rose))];
  const snapshot = JSON.stringify([cart, products]);
  verifyCartLines(cart, buildCartLines(cart, products), products);
  assert.equal(JSON.stringify([cart, products]), snapshot);
});

// ---------- Страница оформления ----------

test('CheckoutPage: свежий каталог перед окном оплаты и перед сохранением, заказ — из проверенных данных', () => {
  const page = read('src/pages/CheckoutPage.jsx');
  assert.match(page, /fresh = await fetchProductsApi\(0\)/);
  assert.match(page, /reviewCheckout\(\{\s*cartItems: cartEntries,\s*seenLines: items,\s*seenGrandTotal: grandTotal,/);
  // Карта: проверка до окна оплаты, и ещё раз после оплаты, прямо перед сохранением
  const submit = page.slice(page.indexOf('const handleFormSubmit'), page.indexOf('const placeOrder'));
  assert.ok(submit.indexOf('await verifyCart(values)') < submit.indexOf('setPendingOrder(values)'));
  assert.match(page, /const result = checked \|\| \(await verifyCart\(values\)\)/);
  // C3.3: после демо-формы карты заказ оформляется без статуса «оплачен» (оплата при получении)
  assert.match(page, /if \(values\) placeOrder\(values\);/);
  assert.doesNotMatch(page, /paidDemo/);
  // Демо-режим: заказ — из result.lines и result.totals, а не из строк Redux
  const place = page.slice(page.indexOf('const placeOrder'), page.indexOf('const handleRemoveProblems'));
  assert.match(place, /buildOrder\(\{[^}]*lines: result\.lines,\s*totals: result\.totals,/);
  assert.ok(place.indexOf('buildOrder(') < place.indexOf('createDemoOrder(order)'));
  assert.doesNotMatch(place, /items\.map|i\.price/);
  // Режим Firebase: на сервер — только позиции из проверенных данных и сумма, которую видел покупатель
  assert.match(place, /buildOrderRequest\(\{\s*lines: result\.lines,\s*promoCode,\s*deliveryMethod,\s*values,\s*expectedTotal: result\.totals\.grandTotal,/);
  assert.match(place, /submitOrder\(request, \{ requestId: attemptRef\.current\.requestId, signedIn: Boolean\(user\) \}\)/);
  // Прямой записи заказа в Firestore и старого вызова /api/order из страницы нет
  assert.doesNotMatch(page, /createOrder\(|setDoc|addDoc|fetch\('\/api\/order'/);
  // Промокод, очистка корзины и страница успеха — только после подтверждённого ответа сервера
  const ok = place.slice(place.indexOf('await submitOrder('), place.indexOf('} catch (err) {'));
  assert.match(ok, /markPromoCodeUsed\(order\.promoCode\)/);
  assert.match(ok, /navigate\(`\/order-success\/\$\{order\.orderId\}`/);
  assert.ok(ok.indexOf('navigate(') < ok.indexOf('dispatch(clearCart())'));
  const failed = place.slice(place.indexOf('} catch (err) {'));
  assert.doesNotMatch(failed, /clearCart/);
  // Резервный каталог в Redux не попадает; корзина не очищается сама (покупатель решает)
  const verify = page.slice(page.indexOf('const verifyCart'), page.indexOf('const handleFormSubmit'));
  assert.ok(verify.indexOf("'unverified'") < verify.indexOf('catalogRefreshed(fresh)'));
  assert.doesNotMatch(page, /dispatch\(fetchProducts\(/);
  // Недоступные позиции удаляются только по кнопке; повторное подтверждение — новая проверка
  assert.match(page, /review\.problems\.forEach\(\(l\) => dispatch\(removeFromCart\(l\.key\)\)\)/);
  assert.match(page, /handleFormSubmit\(values\);/);
});

test('catalogRefreshed не очищает корзину и избранное (их очищает только fetchProducts.fulfilled)', () => {
  const slice = read('src/features/products/productsSlice.js');
  assert.match(slice, /catalogRefreshed\(state, action\) \{/);
  assert.match(slice, /export const \{ catalogRefreshed \} = productsSlice\.actions/);
  for (const file of ['src/features/cart/cartSlice.js', 'src/features/favorites/favoritesSlice.js']) {
    const src = read(file);
    assert.match(src, /fetchProducts\.fulfilled/, file);
    assert.doesNotMatch(src, /catalogRefreshed/, file);
  }
});

test('сообщение проверки: кнопки удаления, выбора объёма, каталога и подтверждения; фокус на сообщении', () => {
  const notice = read('src/components/cart/CheckoutReviewNotice.jsx');
  assert.match(notice, /role="alert"/);
  assert.match(notice, /tabIndex=\{-1\}/);
  assert.match(notice, /ref\.current\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(notice, /onClick=\{onRemoveProblems\}/);
  assert.match(notice, /to="\/catalog"/);
  assert.match(notice, /to="\/cart"/);
  assert.match(notice, /onClick=\{onConfirm\} disabled=\{submitting\}/);
  const css = read('src/styles/pages.css');
  const block = css.slice(css.indexOf('.checkout-review {'), css.indexOf('.success__card'));
  assert.doesNotMatch(block, /#[0-9a-f]{3,8}\b|rgba?\(/i);
});

test('переводы проверки перед оформлением: одинаковые ключи в ru, ky, en', () => {
  const keys = (obj, prefix = '') =>
    Object.entries(obj).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
  const dicts = Object.fromEntries(['ru', 'ky', 'en'].map((l) => [l, JSON.parse(read(`src/locales/${l}/translation.json`))]));
  const ruKeys = keys(dicts.ru.checkout.review).sort();
  for (const [lang, dict] of Object.entries(dicts)) {
    const block = dict.checkout.review;
    assert.deepEqual(keys(block).sort(), ruKeys, lang);
    CHECKOUT_PROBLEMS.forEach((p) => assert.ok(block.problem[p], `${lang}: ${p}`));
    assert.match(block.problem.volumeUnavailable, /\{\{volume\}\}/, lang);
    assert.match(block.oldPrice, /\{\{price\}\}/, lang);
    assert.match(block.newPrice, /\{\{price\}\}/, lang);
    assert.equal(block.problem.outOfStock, dict.availability.outOfStock, lang);
  }
});
