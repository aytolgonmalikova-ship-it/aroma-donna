// Серверная бизнес-логика заказа (C3.3, этап 2). Чистые функции: без Firebase, без браузерных API,
// только встроенные модули Node. Их вызывает api/_lib/orderHandler.js; тесты — tests/orderCore.test.js.
//
// Главное правило: браузер присылает только «намерение» (позиции, промокод, способы доставки и оплаты,
// данные покупателя). Цены, суммы, номер, дату, статусы заказа и оплаты сервер определяет сам.
// Расчёт — те же общие функции, что показывают сумму покупателю (src/utils/checkoutReview.js, promo.js),
// поэтому сервер и витрина не расходятся.

import { createHash, createHmac, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { checkoutTotals, verifyCartLines } from '../../src/utils/checkoutReview.js';
import { DELIVERY_METHODS } from '../../src/utils/promo.js';
import { PROMO_CODES } from '../../src/data/promoCodes.js';
import { isKnownRegionCity } from '../../src/data/regions.js';
import { ORDER_LIMITS, isValidOrderLineCount, isValidOrderQuantity, isWithinLength } from '../../src/utils/orderLimits.js';
import { ID_PATTERN, LIMITS as PRODUCT_LIMITS, toCatalogProduct } from '../../src/utils/products.js';
import { isEmail } from '../../src/utils/validation.js';
import { isKgLocal, toStoredPhone } from '../../src/utils/phone.js';

/** Максимальный размер тела запроса, байт */
export const MAX_BODY_BYTES = 16 * 1024;
export const PAYMENT_METHODS = ['cashOnDelivery', 'cardDemo'];
/** Статус оплаты нового заказа: оплата только при получении, браузер его не задаёт */
export const INITIAL_PAYMENT_STATUS = 'awaitingPayment';
export const INITIAL_ORDER_STATUS = 'new';
/** Курьер возит только по Бишкеку (как в форме: регион и город заблокированы) */
const COURIER_REGION = 'bishkek';
const COURIER_CITY = 'bishkek';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOP_KEYS = ['requestId', 'guestSessionId', 'items', 'promoCode', 'deliveryMethod', 'paymentMethod', 'customer', 'shipping', 'agree', 'expectedTotal'];
const ITEM_KEYS = ['productId', 'volume', 'quantity'];
const CUSTOMER_KEYS = ['name', 'lastName', 'phone', 'email'];
const SHIPPING_KEYS = ['region', 'city', 'address', 'comment'];
const MAX_EXPECTED_TOTAL = 100_000_000;

/** Ошибка, которую обработчик превращает в HTTP-ответ: status, код и безопасные подробности */
export class OrderError extends Error {
  constructor(status, code, details = undefined) {
    super(code);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const onlyKeys = (obj, allowed) => Object.keys(obj).every((k) => allowed.includes(k));
const clean = (s) => s.trim();

/**
 * Строгая проверка запроса заказа. Возвращает нормализованный запрос (только разрешённые поля)
 * или бросает OrderError(400, 'invalid_request', { fields }). Любое лишнее поле — ошибка
 * (в том числе userId, total, paymentStatus, status: браузер их не задаёт).
 */
export function parseOrderRequest(body) {
  const fields = {};
  const fail = (field, reason) => {
    fields[field] = reason;
  };
  if (!isPlainObject(body)) throw new OrderError(400, 'invalid_request', { fields: { body: 'object' } });
  for (const key of Object.keys(body)) if (!TOP_KEYS.includes(key)) fail(key, 'unknown');

  if (typeof body.requestId !== 'string' || !UUID.test(body.requestId)) fail('requestId', 'uuid');
  if (body.guestSessionId !== undefined && (typeof body.guestSessionId !== 'string' || !UUID.test(body.guestSessionId))) {
    fail('guestSessionId', 'uuid');
  }

  // Позиции
  const items = [];
  if (!Array.isArray(body.items) || !isValidOrderLineCount(body.items.length)) {
    fail('items', 'count');
  } else {
    const seen = new Set();
    body.items.forEach((item, i) => {
      const f = `items.${i}`;
      if (!isPlainObject(item) || !onlyKeys(item, ITEM_KEYS)) return fail(f, 'shape');
      const { productId, volume, quantity } = item;
      if (typeof productId !== 'string' || productId.length > PRODUCT_LIMITS.id || !ID_PATTERN.test(productId)) return fail(`${f}.productId`, 'format');
      if (!Number.isInteger(volume) || volume < 1 || volume > 1000) return fail(`${f}.volume`, 'format');
      if (!isValidOrderQuantity(quantity)) return fail(`${f}.quantity`, 'range');
      const key = `${productId}__${volume}`;
      if (seen.has(key)) return fail(f, 'duplicate');
      seen.add(key);
      items.push({ productId, volume, quantity });
    });
  }

  // Промокод: пусто/null — без промокода; иначе строка из известных кодов (проверка — в priceOrder)
  let promoCode = null;
  if (body.promoCode !== undefined && body.promoCode !== null && body.promoCode !== '') {
    if (typeof body.promoCode !== 'string' || body.promoCode.length > ORDER_LIMITS.promoCodeMax || !/^[A-Za-z0-9]+$/.test(body.promoCode.trim())) {
      fail('promoCode', 'format');
    } else promoCode = body.promoCode.trim().toUpperCase();
  }

  const deliveryMethod = body.deliveryMethod;
  if (typeof deliveryMethod !== 'string' || !Object.hasOwn(DELIVERY_METHODS, deliveryMethod)) fail('deliveryMethod', 'unknown');
  const paymentMethod = body.paymentMethod;
  if (!PAYMENT_METHODS.includes(paymentMethod)) fail('paymentMethod', 'unknown');
  if (body.agree !== true) fail('agree', 'required');
  if (!Number.isInteger(body.expectedTotal) || body.expectedTotal < 0 || body.expectedTotal > MAX_EXPECTED_TOTAL) fail('expectedTotal', 'format');

  // Покупатель
  const customer = {};
  if (!isPlainObject(body.customer) || !onlyKeys(body.customer, CUSTOMER_KEYS)) {
    fail('customer', 'shape');
  } else {
    const c = body.customer;
    if (!isWithinLength(c.name, ORDER_LIMITS.nameMax, ORDER_LIMITS.nameMin)) fail('customer.name', 'length');
    else customer.name = clean(c.name);
    if (!isWithinLength(c.lastName, ORDER_LIMITS.lastNameMax, ORDER_LIMITS.lastNameMin)) fail('customer.lastName', 'length');
    else customer.lastName = clean(c.lastName);
    // Телефон — 9 цифр после +996, как в форме (PhoneField); сохраняется в E.164
    if (typeof c.phone !== 'string' || !isKgLocal(c.phone)) fail('customer.phone', 'format');
    else customer.phone = toStoredPhone(c.phone);
    if (typeof c.email !== 'string' || !isWithinLength(c.email, ORDER_LIMITS.emailMax, 3) || !isEmail(c.email)) fail('customer.email', 'format');
    else customer.email = clean(c.email).toLowerCase();
  }

  // Доставка: самовывоз — без адреса; курьер — только Бишкек; регионы — известная пара регион–город
  const shipping = { method: deliveryMethod, region: null, city: null, address: null, comment: '' };
  if (!isPlainObject(body.shipping) || !onlyKeys(body.shipping, SHIPPING_KEYS)) {
    fail('shipping', 'shape');
  } else {
    const s = body.shipping;
    if (s.comment !== undefined && s.comment !== null && !isWithinLength(s.comment, ORDER_LIMITS.commentMax)) fail('shipping.comment', 'length');
    else shipping.comment = typeof s.comment === 'string' ? clean(s.comment) : '';
    if (deliveryMethod === 'courier' || deliveryMethod === 'regions') {
      if (!isKnownRegionCity(s.region, s.city)) fail('shipping.city', 'unknown');
      else if (deliveryMethod === 'courier' && (s.region !== COURIER_REGION || s.city !== COURIER_CITY)) fail('shipping.city', 'courier');
      else {
        shipping.region = s.region;
        shipping.city = s.city;
      }
      if (!isWithinLength(s.address, ORDER_LIMITS.addressMax, ORDER_LIMITS.addressMin)) fail('shipping.address', 'length');
      else shipping.address = clean(s.address);
    }
  }

  if (Object.keys(fields).length) throw new OrderError(400, 'invalid_request', { fields });
  return {
    requestId: body.requestId.toLowerCase(),
    guestSessionId: body.guestSessionId ? body.guestSessionId.toLowerCase() : null,
    items,
    promoCode,
    deliveryMethod,
    paymentMethod,
    customer,
    shipping,
    expectedTotal: body.expectedTotal,
  };
}

/**
 * Каталог для расчёта: документы products → товары витрины. Скрытые, повреждённые и отсутствующие
 * товары в каталог не попадают (для расчёта это «товара нет»). docs — [{ id, exists, data }].
 */
export function catalogFromDocs(docs) {
  const catalog = [];
  for (const doc of docs) {
    if (!doc?.exists) continue;
    const product = toCatalogProduct(doc.id, doc.data);
    if (product && product.hidden === false) catalog.push(product);
  }
  return catalog;
}

/**
 * Расчёт заказа по доверенному каталогу. Возвращает { lines, totals, promo }
 * или бросает OrderError(409, …) — покупатель увидит, что изменилось:
 * - items_unavailable — товар скрыт или удалён (missing), нет в наличии, нет такого объёма;
 * - promo_invalid / promo_min_total — промокод неизвестен или сумма меньше минимальной;
 * - total_changed — итог сервера не совпал с expectedTotal (цены изменились или подмена суммы).
 */
export function priceOrder(request, catalog) {
  const cartItems = request.items.map((i) => ({ key: `${i.productId}__${i.volume}`, id: i.productId, volume: i.volume, quantity: i.quantity }));
  // seenLines пустой: «старых» цен браузера сервер не учитывает — сравнивается только итог
  const lines = verifyCartLines(cartItems, [], catalog);
  const problems = lines.filter((l) => ['missing', 'outOfStock', 'volumeUnavailable'].includes(l.status));
  if (problems.length) {
    throw new OrderError(409, 'items_unavailable', {
      problems: problems.map((l) => ({ productId: l.id, volume: l.volume, reason: l.status })),
    });
  }
  let promo = null;
  if (request.promoCode) {
    const def = Object.hasOwn(PROMO_CODES, request.promoCode) ? PROMO_CODES[request.promoCode] : null;
    if (!def) throw new OrderError(409, 'promo_invalid');
    const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);
    if (subtotal < def.minTotal) throw new OrderError(409, 'promo_min_total', { minTotal: def.minTotal });
    promo = { code: request.promoCode, oneTime: def.oneTime === true };
  }
  const totals = checkoutTotals(lines, promo?.code || null, request.deliveryMethod);
  const priced = lines.map((l) => ({
    productId: l.product.id,
    name: l.product.name,
    brand: l.product.brand,
    volume: l.volume,
    price: l.price,
    quantity: l.quantity,
    lineTotal: l.lineTotal,
  }));
  if (totals.grandTotal !== request.expectedTotal) {
    throw new OrderError(409, 'total_changed', { lines: priced, totals: publicTotals(totals) });
  }
  return { lines: priced, totals, promo };
}

const publicTotals = (t) => ({ subtotal: t.subtotal, discount: t.discount, delivery: t.delivery, total: t.grandTotal });

/** Номер заказа: AD-ГГММДД-XXXXXXXX (8 символов криптослучайно; 32^8 ≈ 10^12 вариантов в день) */
const ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function createServerOrderId(now = new Date(), random = randomBytes) {
  const d = now;
  const date = `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  const bytes = random(8);
  const suffix = [...bytes].map((b) => ID_ALPHABET[b % ID_ALPHABET.length]).join('');
  return `AD-${date}-${suffix}`;
}

/**
 * Заказ для сохранения — только доверенные поля. Структура совместима с прежними заказами
 * (кабинет и админка читают те же поля); createdAt — ISO-строка серверного времени, как раньше,
 * чтобы сортировки старых и новых заказов не смешивали типы.
 */
export function buildServerOrder({ orderId, now, uid, request, priced }) {
  return {
    id: orderId,
    createdAt: now.toISOString(),
    userId: uid || null,
    customerType: uid ? 'registered' : 'guest',
    items: priced.lines.map((l) => ({ id: l.productId, name: l.name, brand: l.brand, volume: l.volume, price: l.price, quantity: l.quantity })),
    subtotal: priced.totals.subtotal,
    discount: priced.totals.discount,
    promoCode: priced.totals.discount > 0 ? priced.promo?.code || null : null,
    delivery: priced.totals.delivery,
    total: priced.totals.grandTotal,
    customer: { ...request.customer },
    shipping: { ...request.shipping },
    payment: request.paymentMethod,
    paymentStatus: INITIAL_PAYMENT_STATUS,
    status: INITIAL_ORDER_STATUS,
    mode: 'firebase',
    notification: { status: 'pending', attempts: 0, leaseUntil: null, sentAt: null, lastError: null },
  };
}

/** Ответ покупателю: без телефона, e-mail, адреса и служебных полей */
export function publicOrderResult(order) {
  return {
    orderId: order.id,
    createdAt: order.createdAt,
    customerType: order.customerType,
    items: order.items.map(({ id, name, brand, volume, price, quantity }) => ({ productId: id, name, brand, volume, price, quantity })),
    subtotal: order.subtotal,
    discount: order.discount,
    promoCode: order.promoCode,
    delivery: order.delivery,
    total: order.total,
    deliveryMethod: order.shipping.method,
    paymentMethod: order.payment,
    paymentStatus: order.paymentStatus,
  };
}

/**
 * Отпечаток содержимого запроса (без requestId): повтор с тем же requestId принимается,
 * только если содержимое совпадает. JSON с упорядоченными ключами — стабилен.
 */
export function requestFingerprint(request) {
  const { requestId: _omit, ...content } = request;
  return createHash('sha256').update(stableStringify(content)).digest('hex');
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** HMAC-SHA256 (hex) по частям ключа: секрет сервера — открытые данные в ключах не хранятся */
export function hmacKey(secret, ...parts) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('hmac-secret');
  return createHmac('sha256', secret).update(parts.map((p) => String(p)).join('\u001f')).digest('hex');
}

/** Ключи хранения: идемпотентность, гость, промокод, ограничение частоты */
export const keys = {
  /** Область идемпотентности — проверенный UID или гостевая сессия */
  idempotency: (secret, scope, requestId) => hmacKey(secret, 'idem', scope, requestId),
  guest: (secret, guestSessionId) => hmacKey(secret, 'guest', guestSessionId).slice(0, 40),
  /** Одноразовый промокод: вошедший — UID и телефон; гость — телефон и e-mail (открытые данные не хранятся) */
  promo: (secret, code, { uid, phone, email }) =>
    (uid ? [['uid', uid], ['phone', phone]] : [['phone', phone], ['email', email]]).map(([kind, value]) => hmacKey(secret, 'promo', code, kind, value)),
  rate: (secret, kind, value) => hmacKey(secret, 'rate', kind, value),
};

/**
 * IP клиента для ограничения частоты. На Vercel — только x-vercel-forwarded-for: платформа перезаписывает
 * его и не пропускает внешние значения (защита от подмены). Вне Vercel (локально, тесты) — только адрес
 * соединения, заголовки клиента не читаются. Возвращает IP или null.
 */
export function clientIp({ headers = {}, socketAddress, onVercel }) {
  let value = null;
  if (onVercel) {
    const header = headers['x-vercel-forwarded-for'];
    value = typeof header === 'string' ? header.split(',')[0].trim() : null;
  } else {
    value = typeof socketAddress === 'string' ? socketAddress.replace(/^::ffff:/, '') : null;
  }
  return value && isIP(value) ? value : null;
}

// ---------- Telegram ----------

export const TELEGRAM_MAX_LENGTH = 4000; // лимит Telegram — 4096
export const TELEGRAM_MAX_LINES = 20;
const FIELD_MAX = 200;
const PAYMENT_LABELS = { cashOnDelivery: 'Наличными при получении', cardDemo: 'DEMO-оплата картой (деньги не списаны)' };
const DELIVERY_LABELS = { courier: 'Курьер по Бишкеку', pickup: 'Самовывоз', regions: 'Доставка по регионам' };
// Названия для сообщения — те же, что regions.* и cities.* в src/locales/ru/translation.json (сверяет tests/orderCore.test.js)
export const REGION_LABELS = {
  bishkek: 'г. Бишкек',
  chui: 'Чуйская область',
  osh: 'Ошская область',
  jalalabad: 'Джалал-Абадская область',
  issykkul: 'Иссык-Кульская область',
  naryn: 'Нарынская область',
  talas: 'Таласская область',
  batken: 'Баткенская область',
};
export const CITY_LABELS = {
  bishkek: 'Бишкек',
  tokmok: 'Токмок',
  osh: 'Ош',
  jalalabad: 'Джалал-Абад',
  karakol: 'Каракол',
  cholponata: 'Чолпон-Ата',
  naryn: 'Нарын',
  talas: 'Талас',
  batken: 'Баткен',
};

/** «Иссык-Кульская область, г. Каракол»; Бишкек — один раз («г. Бишкек»); неизвестный ключ — как есть */
export function formatRegionCity(region, city) {
  const regionLabel = region ? REGION_LABELS[region] || region : null;
  const cityLabel = city ? (CITY_LABELS[city] ? `г. ${CITY_LABELS[city]}` : city) : null;
  return [regionLabel, cityLabel !== regionLabel ? cityLabel : null].filter(Boolean).join(', ');
}

export const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
const cut = (value, max = FIELD_MAX) => {
  const s = String(value ?? '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};
const field = (value, max) => escapeHtml(cut(value, max));

/**
 * Сообщение в Telegram только из сохранённого сервером заказа; HTML экранирован, длина ограничена.
 * Если текст длиннее TELEGRAM_MAX_LENGTH, убираются целые строки товаров («…и ещё N») —
 * текст не режется посередине тега или HTML-сущности, иначе Telegram отклонил бы сообщение.
 */
export function formatOrderMessage(order) {
  const s = order.shipping;
  const build = (shownCount) => {
    const shown = order.items.slice(0, shownCount);
    const items = shown.map((i) => `• ${field(i.name, 100)} (${field(i.brand, 60)}) ${i.volume} мл — ${i.quantity} шт. × ${i.price}`);
    if (order.items.length > shown.length) items.push(`…и ещё ${order.items.length - shown.length}`);
    return [
      '<b>🛍 Новый заказ — AROMA DONNA</b>',
      '',
      `<b>Номер:</b> ${field(order.id)}`,
      `<b>Дата:</b> ${field(order.createdAt)}`,
      `<b>Покупатель:</b> ${field([order.customer.name, order.customer.lastName].join(' '))}${order.customerType === 'guest' ? ' (гость)' : ''}`,
      `<b>Телефон:</b> ${field(order.customer.phone)}`,
      `<b>Email:</b> ${field(order.customer.email)}`,
      '',
      '<b>Товары:</b>',
      ...items,
      '',
      `<b>Сумма товаров:</b> ${order.subtotal}`,
      order.discount ? `<b>Скидка${order.promoCode ? ` (${field(order.promoCode, 32)})` : ''}:</b> −${order.discount}` : null,
      `<b>Доставка:</b> ${field(DELIVERY_LABELS[s.method] || s.method)}, ${order.delivery}`,
      `<b>Итого:</b> ${order.total}`,
      `<b>Оплата:</b> ${field(PAYMENT_LABELS[order.payment] || order.payment)} — ожидает оплаты`,
      s.address ? `<b>Адрес:</b> ${field([formatRegionCity(s.region, s.city), s.address].filter(Boolean).join(', '), 400)}` : null,
      s.comment ? `<b>Комментарий:</b> ${field(s.comment, 300)}` : null,
    ]
      .filter((l) => l !== null)
      .join('\n');
  };
  for (let shown = Math.min(order.items.length, TELEGRAM_MAX_LINES); shown >= 0; shown--) {
    const text = build(shown);
    if (text.length <= TELEGRAM_MAX_LENGTH) return text;
  }
  // Недостижимо при ограничениях полей; на всякий случай — без товаров и без комментария
  return build(0).replace(/\n<b>Комментарий:<\/b>[^\n]*$/, '');
}
