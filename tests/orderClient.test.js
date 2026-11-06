// C3.3, этапы 4–5: клиентская часть оформления через /api/order и гостевые заказы в админке.
// Чистые функции (запрос, повтор, ответы 409, сообщения, сводка без персональных данных, поиск и сортировка
// заказов админки) и статические проверки кода: прямого создания заказа в Firestore из браузера нет.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildOrderRequest, checkoutErrorMessage, nextAttempt, requestContentKey, reviewFromServer, toRecentOrder, RECENT_ORDER_FIELDS } from '../src/utils/orderRequest.js';
import { parseOrderRequest, publicOrderResult } from '../api/_lib/orderCore.js';
import { adminOrderLink, canResendNotification, filterOrdersByDate, orderDocPath, orderOwnerFromPath, searchOrders, sortOrders } from '../src/utils/adminOrders.js';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const dict = (lang) => JSON.parse(read(`src/locales/${lang}/translation.json`));
const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

const values = {
  name: 'Айгерим',
  lastName: 'Асанова',
  phone: '700123456',
  email: 'aigerim@example.com',
  region: 'bishkek',
  city: 'bishkek',
  address: 'ул. Киевская, 1',
  comment: '',
  payment: 'cardDemo',
  agree: true,
  delivery: 'courier',
  cardNumber: '4111111111111111', // посторонние поля формы на сервер не уходят
};
const lines = [{ id: 'p-rose', volume: 50, quantity: 2, price: 1000, product: { name: 'Rose' }, volumeAvailable: true }];

// ---------- Этап 4: запрос к /api/order ----------

test('buildOrderRequest: только поля схемы сервера; parseOrderRequest принимает запрос (гость и вошедший)', () => {
  const request = buildOrderRequest({ lines, promoCode: '', deliveryMethod: 'courier', values, expectedTotal: 2000 });
  assert.deepEqual(Object.keys(request).sort(), ['agree', 'customer', 'deliveryMethod', 'expectedTotal', 'items', 'paymentMethod', 'promoCode', 'shipping'].sort());
  assert.deepEqual(request.items, [{ productId: 'p-rose', volume: 50, quantity: 2 }]);
  assert.deepEqual(Object.keys(request.customer), ['name', 'lastName', 'phone', 'email']);
  assert.deepEqual(Object.keys(request.shipping), ['region', 'city', 'address', 'comment']);
  assert.equal(request.promoCode, null);
  // Запрещённые поля: UID, цены, итоги, статусы, номер, дата, данные карты
  const json = JSON.stringify(request);
  for (const banned of ['userId', 'uid', 'price', 'subtotal', 'discount', '"total"', 'status', 'paymentStatus', 'createdAt', '"id"', 'cardNumber', '4111']) {
    assert.ok(!json.includes(banned), banned);
  }
  const requestId = crypto.randomUUID();
  const guest = parseOrderRequest({ ...request, requestId, guestSessionId: crypto.randomUUID() });
  assert.equal(guest.customer.phone, '+996700123456');
  assert.equal(guest.paymentMethod, 'cardDemo');
  const user = parseOrderRequest({ ...request, requestId });
  assert.equal(user.guestSessionId, null);
  // Согласие — только true
  assert.throws(() => parseOrderRequest({ ...buildOrderRequest({ lines, deliveryMethod: 'pickup', values: { ...values, agree: 'yes' }, expectedTotal: 2000 }), requestId }), /invalid_request/);
});

test('requestId: тот же при повторе того же заказа, новый — если изменилось содержимое', () => {
  let n = 0;
  const newId = () => `id-${++n}`;
  const a = buildOrderRequest({ lines, deliveryMethod: 'courier', values, expectedTotal: 2000 });
  const first = nextAttempt(null, a, newId);
  assert.equal(first.requestId, 'id-1');
  assert.equal(nextAttempt(first, buildOrderRequest({ lines, deliveryMethod: 'courier', values, expectedTotal: 2000 }), newId).requestId, 'id-1');
  // Другой адрес, количество, сумма — новый запрос
  assert.equal(nextAttempt(first, buildOrderRequest({ lines, deliveryMethod: 'courier', values: { ...values, address: 'ул. Токтогула, 2' }, expectedTotal: 2000 }), newId).requestId, 'id-2');
  assert.equal(nextAttempt(first, buildOrderRequest({ lines: [{ ...lines[0], quantity: 3 }], deliveryMethod: 'courier', values, expectedTotal: 3000 }), newId).requestId, 'id-3');
  assert.equal(nextAttempt(first, buildOrderRequest({ lines, deliveryMethod: 'courier', values, expectedTotal: 1900 }), newId).requestId, 'id-4');
  assert.equal(requestContentKey(a), JSON.stringify(a));
});

test('ответ total_changed: окно подтверждения с ценами и суммой сервера', () => {
  const err = {
    code: 'total_changed',
    details: {
      lines: [{ productId: 'p-rose', volume: 50, quantity: 2, name: 'Rose', price: 1200, lineTotal: 2400 }],
      totals: { subtotal: 2400, discount: 0, delivery: 0, total: 2400 },
    },
  };
  const review = reviewFromServer(err, lines);
  assert.equal(review.status, 'confirm');
  assert.equal(review.source, 'server');
  assert.deepEqual(review.priceChanges.map((l) => [l.oldPrice, l.price, l.status]), [[1000, 1200, 'priceChanged']]);
  assert.deepEqual(review.totals, { subtotal: 2400, discount: 0, delivery: 0, grandTotal: 2400 });
  // Цены те же, изменилась только сумма (доставка) — показываются все позиции
  const same = reviewFromServer({ code: 'total_changed', details: { lines: [{ ...err.details.lines[0], price: 1000, lineTotal: 2000 }], totals: { subtotal: 2000, discount: 0, delivery: 200, total: 2200 } } }, lines);
  assert.equal(same.priceChanges.length, 1);
  assert.equal(same.totals.grandTotal, 2200);
});

test('ответ items_unavailable: список недоступных позиций с причиной; другие ошибки — не окно проверки', () => {
  const review = reviewFromServer({ code: 'items_unavailable', details: { problems: [{ productId: 'p-rose', volume: 50, reason: 'outOfStock' }, { productId: 'p-gone', volume: 30, reason: 'removed' }] } }, lines);
  assert.equal(review.status, 'blocked');
  assert.deepEqual(review.problems.map((p) => [p.key, p.name, p.status, p.quantity]), [['p-rose__50', 'Rose', 'outOfStock', 2], ['p-gone__30', 'p-gone', 'removed', 1]]);
  for (const code of ['promo_invalid', 'rate_limited', 'network', 'auth_expired']) assert.equal(reviewFromServer({ code, details: {} }, lines), null, code);
});

test('сообщения об ошибках: понятный текст на трёх языках, без внутренних подробностей сервера', () => {
  const cases = [
    [{ code: 'promo_invalid' }, 'checkout.errors.promoInvalid'],
    [{ code: 'promo_min_total', details: { minTotal: 3000 } }, 'checkout.errors.promoMinTotal', { min: 3000 }],
    [{ code: 'promo_used' }, 'checkout.errors.promoUsed'],
    [{ code: 'auth_expired' }, 'checkout.errors.sessionExpired'],
    [{ code: 'auth_revoked' }, 'checkout.errors.sessionExpired'],
    [{ code: 'auth_invalid' }, 'checkout.errors.sessionExpired'],
    [{ code: 'auth_required' }, 'checkout.errors.sessionExpired'],
    [{ code: 'app_check_required' }, 'checkout.errors.verification'],
    [{ code: 'app_check_failed' }, 'checkout.errors.verification'],
    [{ code: 'app_check_unavailable' }, 'checkout.errors.verification'],
    [{ code: 'rate_limited', retryAfter: 125 }, 'checkout.errors.rateLimited', { minutes: 3 }],
    [{ code: 'rate_limited' }, 'checkout.errors.rateLimited', { minutes: 1 }],
    [{ code: 'not_configured' }, 'checkout.errors.unavailable'],
    [{ code: 'too_large' }, 'checkout.errors.invalid'],
    [{ code: 'invalid_request' }, 'checkout.errors.invalid'],
    [{ code: 'request_conflict' }, 'checkout.errors.conflict'],
    [{ code: 'server_error' }, 'checkout.errors.network'],
    [{ code: 'network' }, 'checkout.errors.network'],
    [new Error('Firestore internal: stack'), 'checkout.errors.network'],
  ];
  for (const [err, key, params] of cases) {
    const m = checkoutErrorMessage(err);
    assert.equal(m.key, key, err.code);
    if (params) assert.deepEqual(m.params, params);
  }
  for (const lang of ['ru', 'ky', 'en']) {
    const d = dict(lang);
    for (const [, key] of cases) {
      const text = get(d, key);
      assert.equal(typeof text, 'string', `${lang}: ${key}`);
      assert.doesNotMatch(text, /error|stack|firestore|500|403/i, `${lang}: ${key}`);
    }
    assert.match(get(d, 'checkout.errors.promoMinTotal'), /\{\{min\}\}/);
    assert.match(get(d, 'checkout.errors.rateLimited'), /\{\{minutes\}\}/);
  }
});

test('сводка заказа в браузере — только ответ сервера, без телефона, e-mail, имени и адреса', () => {
  const order = {
    id: 'AD-20261106-ABCD',
    createdAt: '2026-11-06T08:00:00.000Z',
    userId: null,
    customerType: 'guest',
    items: [{ id: 'p-rose', name: 'Rose', brand: 'B', volume: 50, price: 1000, quantity: 2 }],
    subtotal: 2000,
    discount: 0,
    promoCode: null,
    delivery: 0,
    total: 2000,
    customer: { name: 'Айгерим', lastName: 'Асанова', phone: '+996700123456', email: 'aigerim@example.com' },
    shipping: { method: 'courier', region: 'bishkek', city: 'bishkek', address: 'ул. Киевская, 1', comment: '' },
    payment: 'cardDemo',
    paymentStatus: 'awaitingPayment',
  };
  const pub = publicOrderResult(order);
  const recent = toRecentOrder({ ...pub, customer: order.customer, shipping: order.shipping, phone: 'x' });
  assert.deepEqual(Object.keys(recent).sort(), [...RECENT_ORDER_FIELDS].sort());
  const json = JSON.stringify(recent);
  for (const pii of ['Айгерим', 'Асанова', '700123456', 'aigerim', 'Киевская']) assert.ok(!json.includes(pii), pii);
  assert.equal(recent.orderId, 'AD-20261106-ABCD');
  assert.equal(recent.paymentStatus, 'awaitingPayment');
});

test('cardDemo — честно: онлайн-оплаты нет, оплата при получении; страница результата не обещает списание', () => {
  for (const lang of ['ru', 'ky', 'en']) {
    const d = dict(lang);
    for (const key of ['success.cardDemoNote', 'success.serverText', 'payment.demoMode', 'payment.successText']) assert.equal(typeof get(d, key), 'string', `${lang}: ${key}`);
  }
  const ru = dict('ru');
  assert.match(ru.success.cardDemoNote, /не проводится/);
  assert.match(ru.success.cardDemoNote, /при получении/);
  assert.doesNotMatch(ru.payment.successTitle, /оплат[аи] прошла/i);
  assert.match(ru.payment.successText, /не списана/);
  assert.match(dict('en').success.cardDemoNote, /pay on delivery/i);
  const page = read('src/pages/OrderSuccessPage.jsx');
  assert.match(page, /order\.server && order\.payment === 'cardDemo' && <small className="success__note">\{t\('success\.cardDemoNote'\)\}<\/small>/);
  // Страница результата заказ не отправляет — только читает state, сводку или демо-заказ
  assert.doesNotMatch(page, /submitOrder|fetch\(|createDemoOrder/);
  assert.match(page, /location\.state\?\.order \|\| findRecentOrder\(orderId\) \|\| findLocalOrder\(orderId\)/);
});

test('клиент не создаёт заказы в Firestore: нет записи в orders, оформление — только через /api/order', () => {
  const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
  for (const file of walk(join(ROOT, 'src')).filter((f) => /\.(js|jsx)$/.test(f))) {
    const code = readFileSync(file, 'utf8');
    // setDoc/addDoc рядом с 'orders' — запись заказа из браузера
    assert.doesNotMatch(code, /(setDoc|addDoc)\([^;]*['"]orders['"]/, file);
    assert.doesNotMatch(code, /export (async )?function createOrder\b/, file);
  }
  const service = read('src/services/orderService.js');
  assert.doesNotMatch(service, /setDoc|addDoc|writeBatch|runTransaction/);
  assert.match(service, /fetch\('\/api\/order', \{ method: 'POST'/);
  // Вошедший — Bearer ID-токен, UID в теле нет; гость — App Check и UUID сессии, без обхода
  assert.match(service, /Authorization: `Bearer \$\{await current\.getIdToken\(forceRefresh\)\}`/);
  assert.match(service, /if \(!current\) throw new OrderSubmitError\('auth_required'/);
  assert.match(service, /'X-Firebase-AppCheck': appCheckToken/);
  assert.match(service, /throw new OrderSubmitError\('app_check_unavailable'\)/);
  const submit = service.slice(service.indexOf('export async function submitOrder'), service.indexOf('export function saveRecentOrder'));
  assert.doesNotMatch(submit, /uid|userId/);
  // UUID гостевой сессии — в sessionStorage (не в localStorage), персональных данных там нет
  assert.match(service, /sessionStorage\.setItem\(GUEST_SESSION_KEY, id\)/);
  assert.match(service, /const summary = toRecentOrder\(result\)/);
  // App Check без ключа сайта — ошибка, а не отправка без проверки
  const appCheck = read('src/services/appCheck.js');
  assert.match(appCheck, /if \(!siteKey\) throw new AppCheckUnavailableError\('no-site-key'\)/);
  assert.match(appCheck, /getLimitedUseToken/);
});

test('App Check: провайдер reCAPTCHA Enterprise (Fraud Defense), без автообновления; только одноразовые токены и consume на сервере', () => {
  const appCheck = read('src/services/appCheck.js');
  // Одна инициализация — с провайдером Enterprise и выключенным автообновлением
  assert.equal(appCheck.match(/initializeAppCheck\(/g).length, 1);
  assert.match(appCheck, /api\.initializeAppCheck\(app, \{ provider: new api\.ReCaptchaEnterpriseProvider\(siteKey\), isTokenAutoRefreshEnabled: false \}\)/);
  // Ключ — только из VITE_RECAPTCHA_SITE_KEY (в коде ключей нет)
  assert.match(appCheck, /const siteKey = env\.VITE_RECAPTCHA_SITE_KEY;/);
  assert.doesNotMatch(appCheck, /6L[A-Za-z0-9_-]{30,}/);
  // Токен для заказа — одноразовый: getLimitedUseToken, обычный getToken не используется
  assert.match(appCheck, /await api\.getLimitedUseToken\(instance\)/);
  assert.doesNotMatch(appCheck, /api\.getToken\(/);
  // Устаревший классический провайдер reCAPTCHA v3 нигде в клиентском коде не используется
  const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
  for (const file of walk(join(ROOT, 'src')).filter((f) => /\.(js|jsx)$/.test(f))) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /ReCaptchaV3Provider/, file);
  }
  // Установленный Firebase SDK содержит провайдер Enterprise и одноразовые токены
  const types = read('node_modules/@firebase/app-check/dist/app-check-public.d.ts');
  assert.match(types, /export declare class ReCaptchaEnterpriseProvider/);
  assert.match(types, /export declare function getLimitedUseToken/);
  // Сервер: одноразовый токен проверяется с consume: true, повтор отклоняется
  const admin = read('api/_lib/firebaseAdmin.js');
  assert.match(admin, /appCheck\.verifyToken\(token, \{ consume: true \}\)/);
  assert.match(admin, /if \(result\.alreadyConsumed\)/);
});

// ---------- Этап 5: гостевые заказы в админке ----------

test('тип заказа — только по пути документа; guestKey не считается UID', () => {
  assert.deepEqual(orderOwnerFromPath('users/u1/orders/AD-1'), { kind: 'user', ownerId: 'u1' });
  const key = 'a'.repeat(40);
  assert.deepEqual(orderOwnerFromPath(`guests/${key}/orders/AD-2`), { kind: 'guest', ownerId: key });
  for (const bad of ['orders/AD-1', 'users/u1/orders', 'users/u1/reviews/r1', 'other/x/orders/1', 'users/u1/orders/1/extra', '']) assert.equal(orderOwnerFromPath(bad), null, bad);
  assert.deepEqual(orderDocPath({ kind: 'guest', ownerId: key, orderId: 'AD-2' }), ['guests', key, 'orders', 'AD-2']);
  assert.deepEqual(orderDocPath({ kind: 'user', ownerId: 'u1', orderId: 'AD-1' }), ['users', 'u1', 'orders', 'AD-1']);
  assert.equal(adminOrderLink({ isGuest: true, guestKey: key, id: 'AD-2', userId: null }), `/admin/orders/guest/${key}/AD-2`);
  assert.equal(adminOrderLink({ isGuest: false, userId: 'u1', id: 'AD-1' }), '/admin/orders/u1/AD-1');
});

test('toAdminOrder: гостевой заказ — isGuest и guestKey, userId: null (даже если в данных есть userId)', () => {
  // adminService импортирует Firebase (браузерный модуль) — проверяем саму функцию из исходника
  const svc = read('src/services/adminService.js');
  const start = svc.indexOf('export function toAdminOrder(snap)');
  const body = svc.slice(start, svc.indexOf('\n}\n', start) + 2).replace('export function', 'return function');
  const toAdminOrder = new Function('orderOwnerFromPath', body)(orderOwnerFromPath);
  const key = 'b'.repeat(40);
  const snap = (path, data) => ({ id: path.split('/').pop(), ref: { path }, data: () => data });
  const guest = toAdminOrder(snap(`guests/${key}/orders/AD-G`, { id: 'AD-G', userId: 'forged-uid', total: 10 }));
  assert.equal(guest.isGuest, true);
  assert.equal(guest.guestKey, key);
  assert.equal(guest.userId, null);
  const user = toAdminOrder(snap('users/u1/orders/AD-U', { id: 'AD-U', userId: 'u1', total: 20 }));
  assert.deepEqual([user.isGuest, user.guestKey, user.userId], [false, null, 'u1']);
});

const ORDERS = [
  { id: 'AD-1', total: 3000, createdAt: '2026-11-01T10:00:00.000Z', customer: { name: 'Айгерим', lastName: 'Асанова', phone: '+996700123456' }, isGuest: true },
  { id: 'AD-2', total: 1500, createdAt: '2026-11-03T10:00:00.000Z', customer: { name: 'Бакыт', lastName: 'Осмонов', phone: '+996555000111' }, isGuest: false },
  { id: 'OLD-1', total: 9000, createdAt: '2026-10-20T10:00:00.000Z', customer: { name: 'Старый', lastName: 'Заказ', phone: '0700 999 888' }, isGuest: false },
];

test('поиск заказов: номер, имя, фамилия, телефон (+996, 0…, без пробелов)', () => {
  const ids = (q) => searchOrders(ORDERS, q).map((o) => o.id);
  assert.deepEqual(ids(''), ['AD-1', 'AD-2', 'OLD-1']);
  assert.deepEqual(ids('ad-2'), ['AD-2']);
  assert.deepEqual(ids('айгерим'), ['AD-1']);
  assert.deepEqual(ids('Осмонов'), ['AD-2']);
  assert.deepEqual(ids('0700 123'), ['AD-1']);
  assert.deepEqual(ids('+996 555'), ['AD-2']);
  assert.deepEqual(ids('999888'), ['OLD-1']);
  assert.deepEqual(ids('12'), [], 'короткие цифры — не поиск по телефону');
});

test('фильтр по дате (включительно) и сортировка; исходный список не меняется', () => {
  assert.deepEqual(filterOrdersByDate(ORDERS, '2026-11-01', '2026-11-02').map((o) => o.id), ['AD-1']);
  assert.deepEqual(filterOrdersByDate(ORDERS, '2026-11-01', '').map((o) => o.id), ['AD-1', 'AD-2']);
  assert.deepEqual(filterOrdersByDate(ORDERS, '', '2026-10-31').map((o) => o.id), ['OLD-1']);
  assert.equal(filterOrdersByDate(ORDERS, 'bad', ''), ORDERS);
  const snapshot = JSON.stringify(ORDERS);
  assert.deepEqual(sortOrders(ORDERS, 'newest').map((o) => o.id), ['AD-2', 'AD-1', 'OLD-1']);
  assert.deepEqual(sortOrders(ORDERS, 'oldest').map((o) => o.id), ['OLD-1', 'AD-1', 'AD-2']);
  assert.deepEqual(sortOrders(ORDERS, 'totalDesc').map((o) => o.id), ['OLD-1', 'AD-1', 'AD-2']);
  assert.deepEqual(sortOrders(ORDERS, 'totalAsc').map((o) => o.id), ['AD-2', 'AD-1', 'OLD-1']);
  assert.deepEqual(sortOrders(ORDERS, 'unknown').map((o) => o.id), ['AD-2', 'AD-1', 'OLD-1']);
  assert.equal(JSON.stringify(ORDERS), snapshot);
});

test('повторная отправка в Telegram: только failed или sending с истёкшей арендой; sent и старые заказы — нет', () => {
  const now = 1_000_000;
  assert.equal(canResendNotification({ status: 'failed' }, now), true);
  assert.equal(canResendNotification({ status: 'sending', leaseUntil: now - 1 }, now), true);
  assert.equal(canResendNotification({ status: 'sending', leaseUntil: now + 1000 }, now), false);
  assert.equal(canResendNotification({ status: 'sent' }, now), false);
  assert.equal(canResendNotification({ status: 'pending' }, now), false);
  assert.equal(canResendNotification(undefined, now), false);
  assert.equal(canResendNotification(null, now), false);
});

test('админка: список ограничен, гостевой статус — понятная ошибка правил, повтор — защищённый endpoint с ID-токеном', () => {
  const svc = read('src/services/adminService.js');
  assert.match(svc, /const ORDERS_LIMIT = 500;/);
  assert.match(svc, /dbApi\.limit\(ORDERS_LIMIT\)/);
  assert.match(svc, /if \(kind === 'guest' && err\?\.code === 'permission-denied'\) throw new AdminError\('guest-status-rules'\)/);
  assert.match(svc, /fetch\('\/api\/order-notify'/);
  assert.match(svc, /Authorization: `Bearer \$\{/);
  // Изменяется только статус: системные поля (userId, guestKey, цены) не отправляются
  const update = svc.slice(svc.indexOf('export async function updateOrderStatus'), svc.indexOf('export async function resendOrderNotification'));
  assert.doesNotMatch(update, /userId|guestKey|total|price|subtotal|notification/);
  const page = read('src/pages/admin/AdminOrderPage.jsx');
  assert.match(page, /canResendNotification\(notification\) && !confirmResend/);
  assert.match(read('src/pages/admin/AdminApp.jsx'), /path="orders\/guest\/:guestKey\/:orderId"/);
  for (const lang of ['ru', 'ky', 'en']) {
    const o = dict(lang).admin.orders;
    for (const key of ['guest', 'searchLabel', 'found', 'emptySearch', 'notify.title', 'notify.resend', 'notify.confirm', 'notify.statuses.failed', 'notify.result.sent', 'errors.guest-status-rules', 'errors.notify-already_sent']) {
      assert.equal(typeof get(o, key), 'string', `${lang}: ${key}`);
    }
  }
});

test('endpoint повторной отправки: только POST, ID-токен, admins/{uid}, строгое тело; токен Telegram не возвращается', () => {
  const src = read('api/_lib/notifyHandler.js');
  assert.match(src, /verifyIdToken\(match\[1\], true\)/);
  assert.match(src, /collection\('admins'\)\.doc\(uid\)\.get\(\)\)\.exists\) return fail\(403, 'not_admin'\)/);
  assert.match(src, /if \(n\.status === 'sent'\) return fail\(409, 'already_sent'\)/);
  assert.match(src, /notifyOrder\(admin\.db, ref,/);
  assert.doesNotMatch(src, /TELEGRAM_BOT_TOKEN|setInterval|setTimeout/);
  assert.match(read('api/order-notify.js'), /handleNotify\(/);
});
