// Серверное оформление заказа: POST /api/order (C3.3, этап 3). Не зависит от Vercel:
// api/order.js передаёт сюда запрос, тесты вызывают handleOrder напрямую (с эмуляторами Firebase).
//
// Порядок: размер → метод → конфигурация → схема → покупатель (ID-токен или App Check гостя) →
// идемпотентность → ограничение частоты → каталог и расчёт → атомарная запись (заказ, ключ повтора,
// промокод) → уведомление в Telegram → ответ без персональных данных.

import {
  MAX_BODY_BYTES,
  OrderError,
  buildServerOrder,
  catalogFromDocs,
  clientIp,
  createServerOrderId,
  keys,
  parseOrderRequest,
  priceOrder,
  publicOrderResult,
  requestFingerprint,
} from './orderCore.js';
import { getAdmin } from './firebaseAdmin.js';
import { RATE_LIMITS, consumeRateLimit, createOrderAtomically, notifyOrder, readIdempotency } from './orderStore.js';

const reply = (status, body, headers = {}) => ({ status, body, headers: { 'Cache-Control': 'no-store', ...headers } });
const fail = (status, error, extra = {}, headers = {}) => reply(status, { ok: false, error, ...extra }, headers);

/** Тело запроса → объект; размер проверяется до разбора. Бросает OrderError(413 | 400). */
function readBody(body, headers) {
  const declared = Number(headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new OrderError(413, 'too_large');
  if (typeof body === 'string' || Buffer.isBuffer(body)) {
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) throw new OrderError(413, 'too_large');
    try {
      return JSON.parse(String(body));
    } catch {
      throw new OrderError(400, 'bad_json');
    }
  }
  if (body !== null && typeof body === 'object') {
    if (Buffer.byteLength(JSON.stringify(body)) > MAX_BODY_BYTES) throw new OrderError(413, 'too_large');
    return body;
  }
  throw new OrderError(400, 'bad_json');
}

/** Вошедший покупатель: UID только из проверенного токена; неверный токен — 401, не гостевой режим */
async function verifyCustomer(admin, headers) {
  const header = headers.authorization;
  if (header === undefined) return null;
  const match = typeof header === 'string' ? header.match(/^Bearer ([A-Za-z0-9._-]{20,4096})$/) : null;
  if (!match) throw new OrderError(401, 'auth_invalid');
  try {
    const decoded = await admin.auth.verifyIdToken(match[1], true);
    return decoded.uid;
  } catch (err) {
    const code = err?.code || err?.errorInfo?.code;
    if (code === 'auth/id-token-expired') throw new OrderError(401, 'auth_expired');
    if (code === 'auth/id-token-revoked' || code === 'auth/user-disabled') throw new OrderError(401, 'auth_revoked');
    throw new OrderError(401, 'auth_invalid');
  }
}

/** Гость: обязательный токен App Check; без него или при ошибке — 403, обхода нет */
async function verifyGuest(admin, headers) {
  const token = headers['x-firebase-appcheck'];
  if (typeof token !== 'string' || token.length < 10 || token.length > 4096) throw new OrderError(403, 'app_check_required');
  try {
    await admin.verifyAppCheck(token);
  } catch {
    throw new OrderError(403, 'app_check_failed');
  }
}

/**
 * Обработка запроса. deps (для тестов): { admin, fetchImpl, now, random }.
 * Возвращает { status, body, headers }.
 */
export async function handleOrder({ method, headers = {}, body, socketAddress, env = process.env, deps = {} }) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const now = deps.now || (() => Date.now());
  try {
    if (method !== 'POST') return fail(405, 'method_not_allowed', {});
    const raw = readBody(body, lower);

    const admin = deps.admin || getAdmin(env);
    const secret = env.ORDER_HMAC_SECRET;
    if (admin.error || typeof secret !== 'string' || secret.length < 32) {
      console.error('[order] сервер не настроен:', admin.error || 'hmac-secret');
      return fail(503, 'not_configured');
    }

    const request = parseOrderRequest(raw);

    // Покупатель
    const uid = await verifyCustomer(admin, lower);
    if (!uid) {
      if (!request.guestSessionId) throw new OrderError(400, 'invalid_request', { fields: { guestSessionId: 'required' } });
      await verifyGuest(admin, lower);
    }
    const scope = uid ? `u:${uid}` : `g:${request.guestSessionId}`;
    const idemKey = keys.idempotency(secret, scope, request.requestId);
    const fingerprint = requestFingerprint(uid ? { ...request, guestSessionId: null } : request);

    // Повтор той же попытки — тот же результат, без нового заказа и без нового уведомления
    const previous = await readIdempotency(admin.db, idemKey);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new OrderError(409, 'request_conflict');
      return reply(200, { ok: true, idempotent: true, order: previous.result });
    }

    // Ограничение частоты: гость — по IP (HMAC), вошедший — по UID
    const ip = uid ? null : clientIp({ headers: lower, socketAddress, onVercel: Boolean(env.VERCEL) });
    const rate = await consumeRateLimit(admin.db, {
      key: uid ? keys.rate(secret, 'uid', uid) : keys.rate(secret, 'ip', ip || 'unknown'),
      limit: uid ? RATE_LIMITS.registered : RATE_LIMITS.guest,
      now: now(),
    });
    if (!rate.allowed) return fail(429, 'rate_limited', { retryAfter: rate.retryAfterSec }, { 'Retry-After': String(rate.retryAfterSec) });

    // Каталог: только нужные товары; скрытые, удалённые и повреждённые для расчёта отсутствуют
    const ids = [...new Set(request.items.map((i) => i.productId))];
    const snaps = await admin.db.getAll(...ids.map((id) => admin.db.collection('products').doc(id)));
    const catalog = catalogFromDocs(snaps.map((s) => ({ id: s.id, exists: s.exists, data: s.exists ? s.data() : null })));
    const priced = priceOrder(request, catalog);

    // Одноразовый промокод: ключи HMAC (вошедший — UID и телефон; гость — телефон и e-mail)
    const promoKeys = priced.promo?.oneTime
      ? keys.promo(secret, priced.promo.code, { uid, phone: request.customer.phone, email: request.customer.email })
      : [];

    // Заказ: номер, дата, статусы и суммы — от сервера
    let created = null;
    let order = null;
    let orderRef = null;
    for (let attempt = 0; attempt < 3 && !created; attempt++) {
      const at = new Date(now());
      const orderId = createServerOrderId(at, deps.random);
      order = buildServerOrder({ orderId, now: at, uid, request, priced });
      orderRef = uid
        ? admin.db.collection('users').doc(uid).collection('orders').doc(orderId)
        : admin.db.collection('guests').doc(keys.guest(secret, request.guestSessionId)).collection('orders').doc(orderId);
      try {
        created = await createOrderAtomically(admin.db, {
          idemKey,
          fingerprint,
          scopeType: uid ? 'registered' : 'guest',
          orderRef,
          order,
          result: publicOrderResult(order),
          promoKeys,
          now: at.getTime(),
        });
      } catch (err) {
        if (err instanceof OrderError && err.code === 'order_id_conflict') continue;
        throw err;
      }
    }
    if (!created) throw new OrderError(500, 'order_id_conflict');
    if (created.existing) {
      // Параллельный одинаковый запрос успел раньше
      if (created.existing.fingerprint !== fingerprint) throw new OrderError(409, 'request_conflict');
      return reply(200, { ok: true, idempotent: true, order: created.existing.result });
    }

    // Уведомление: сбой не отменяет сохранённый заказ
    let notification = 'failed';
    try {
      notification = await notifyOrder(admin.db, orderRef, { env, fetchImpl: deps.fetchImpl, now });
    } catch (err) {
      console.error('[order] ошибка уведомления:', order.id, err?.code || err?.name);
    }
    return reply(201, { ok: true, order: publicOrderResult(order), notification: notification === 'sent' ? 'sent' : 'pending' });
  } catch (err) {
    if (err instanceof OrderError) {
      const extra = err.details ? { ...err.details } : {};
      return fail(err.status, err.code, extra);
    }
    console.error('[order] непредвиденная ошибка:', err?.name, err?.code);
    return fail(500, 'server_error');
  }
}
