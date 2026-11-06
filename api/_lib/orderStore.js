// Операции с Firestore для серверного оформления заказа (C3.3, этап 3) — только через Admin SDK.
// Служебные коллекции (orderRequests, orderRateLimits, promoRedemptions) браузеру закрыты общим правилом
// «всё остальное запрещено» в firestore.rules; гостевые заказы guests/{guestKey}/orders читает только
// администратор (правило для всех orders). Admin SDK правила не проверяет — проверки здесь, в коде сервера.

import { OrderError, formatOrderMessage } from './orderCore.js';

export const RATE_WINDOW_MS = 10 * 60 * 1000;
export const RATE_LIMITS = { guest: 5, registered: 10 };
const IDEMPOTENCY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const NOTIFY_LEASE_MS = 60 * 1000;
const TELEGRAM_TIMEOUT_MS = 8000;
const ALREADY_EXISTS = 6; // gRPC-код Firestore

const isAlreadyExists = (err) => err?.code === ALREADY_EXISTS || err?.code === 'already-exists' || /ALREADY_EXISTS/.test(String(err?.message));

/**
 * Счётчик запросов в окне 10 минут — транзакционно (одновременные запросы не превышают лимит).
 * key — HMAC (IP гостя или UID), открытых данных нет; документ — ключ и начало окна.
 * Возвращает { allowed, retryAfterSec }.
 */
export async function consumeRateLimit(db, { key, limit, now }) {
  const windowStart = Math.floor(now / RATE_WINDOW_MS) * RATE_WINDOW_MS;
  const retryAfterSec = Math.max(1, Math.ceil((windowStart + RATE_WINDOW_MS - now) / 1000));
  const ref = db.collection('orderRateLimits').doc(`${key}_${windowStart}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const count = snap.exists ? Number(snap.get('count')) || 0 : 0;
    if (count >= limit) return { allowed: false, retryAfterSec };
    tx.set(ref, { count: count + 1, windowStart, expiresAt: new Date(windowStart + 2 * RATE_WINDOW_MS) });
    return { allowed: true, retryAfterSec };
  });
}

/** Запись идемпотентности: { fingerprint, orderPath, orderId, result } или null */
export async function readIdempotency(db, key) {
  const snap = await db.collection('orderRequests').doc(key).get();
  return snap.exists ? snap.data() : null;
}

/**
 * Атомарно: заказ + запись идемпотентности + отметки одноразового промокода.
 * - Запись идемпотентности уже есть (гонка двух одинаковых запросов) — { existing }.
 * - Промокод уже использован — OrderError(409, 'promo_used').
 * - Номер заказа занят (почти невозможно) — OrderError(500, 'order_id_conflict'), обработчик повторит.
 */
export async function createOrderAtomically(db, { idemKey, fingerprint, scopeType, orderRef, order, result, promoKeys, now }) {
  const idemRef = db.collection('orderRequests').doc(idemKey);
  const promoRefs = promoKeys.map((k) => db.collection('promoRedemptions').doc(k));
  try {
    return await db.runTransaction(async (tx) => {
      const idem = await tx.get(idemRef);
      const promoSnaps = promoRefs.length ? await tx.getAll(...promoRefs) : [];
      const orderSnap = await tx.get(orderRef);
      if (idem.exists) return { existing: idem.data() };
      if (promoSnaps.some((s) => s.exists)) throw new OrderError(409, 'promo_used');
      if (orderSnap.exists) throw new OrderError(500, 'order_id_conflict');
      tx.create(orderRef, order);
      tx.create(idemRef, {
        fingerprint,
        scopeType,
        orderPath: orderRef.path,
        orderId: order.id,
        result,
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + IDEMPOTENCY_TTL_MS),
      });
      for (const ref of promoRefs) {
        tx.create(ref, { code: order.promoCode, orderPath: orderRef.path, createdAt: new Date(now).toISOString() });
      }
      return { created: true };
    });
  } catch (err) {
    if (err instanceof OrderError) throw err;
    // Параллельная транзакция успела создать те же документы
    if (isAlreadyExists(err)) {
      const idem = await idemRef.get();
      if (idem.exists) return { existing: idem.data() };
      throw new OrderError(409, 'promo_used');
    }
    throw err;
  }
}

/**
 * Отправка в Telegram (fetch подменяется в тестах). Не бросает: { ok } или { ok: false, code }.
 * В журнал не попадают ни токен, ни данные покупателя.
 */
export async function sendTelegram(text, { env, fetchImpl = fetch }) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return { ok: false, code: 'not_configured' };
  try {
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
      signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) return { ok: false, code: `telegram_${res.status || 'error'}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, code: err?.name === 'TimeoutError' ? 'telegram_timeout' : 'telegram_network' };
  }
}

/**
 * Уведомление о заказе с «арендой»: отправляет только тот, кто захватил заказ транзакцией
 * (pending/failed, или sending с истёкшей арендой) — два процесса не отправят одно уведомление одновременно.
 * Сбой Telegram не отменяет заказ: статус failed, причина без персональных данных.
 * Остаточный риск: Telegram принял сообщение, а процесс завершился до записи sent — после истечения
 * аренды возможна повторная отправка вручную (в сообщении есть номер заказа, дубль легко распознать).
 * Возвращает 'sent' | 'failed' | 'skipped'.
 */
export async function notifyOrder(db, orderRef, { env, fetchImpl, now = () => Date.now(), leaseMs = NOTIFY_LEASE_MS }) {
  const claimed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) return null;
    const n = snap.get('notification') || {};
    const t = now();
    if (n.status === 'sent') return null;
    if (n.status === 'sending' && typeof n.leaseUntil === 'number' && n.leaseUntil > t) return null;
    tx.update(orderRef, {
      'notification.status': 'sending',
      'notification.leaseUntil': t + leaseMs,
      'notification.attempts': (Number(n.attempts) || 0) + 1,
    });
    return snap.data();
  });
  if (!claimed) return 'skipped';
  const result = await sendTelegram(formatOrderMessage(claimed), { env, fetchImpl });
  const update = result.ok
    ? { 'notification.status': 'sent', 'notification.sentAt': new Date(now()).toISOString(), 'notification.leaseUntil': null, 'notification.lastError': null }
    : { 'notification.status': 'failed', 'notification.leaseUntil': null, 'notification.lastError': result.code };
  await orderRef.update(update);
  if (!result.ok) console.error('[order] уведомление не отправлено:', claimed.id, result.code);
  return result.ok ? 'sent' : 'failed';
}
