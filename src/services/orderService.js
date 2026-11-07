/**
 * Оформление и получение заказов.
 *
 * - Режим Firebase (C3.3): заказ создаёт ТОЛЬКО сервер — POST /api/order (серверная функция).
 *   Браузер отправляет «намерение» заказа; цены, итог, номер, дату и статусы определяет сервер.
 *   Вошедший покупатель — с ID-токеном Firebase (Authorization: Bearer), гость — с одноразовым
 *   токеном App Check (X-Firebase-AppCheck) и UUID гостевой сессии. Прямой записи заказа в Firestore нет.
 * - Демо-режим (без Firebase): заказ сохраняется только в localStorage этого браузера, как раньше.
 *
 * Читать свои заказы может только их владелец — это проверяют правила firestore.rules.
 * Оплата не проводится: способы оплаты — только при получении. Деньги не списываются.
 */
import { getFirebase } from './firebase';
import { AUTH_MODE } from './authService';
import { getGuestAppCheckToken } from './appCheck';
import { loadFromStorage, saveToStorage, STORAGE_KEYS } from '../utils/storage';
import { appCheckFailureInfo, toRecentOrder } from '../utils/orderRequest';

/** Ошибка оформления: code — код ответа сервера (или network), без внутренних подробностей */
export class OrderSubmitError extends Error {
  constructor(code, { status = 0, details = null, retryAfter = null } = {}) {
    super(code);
    this.code = code;
    this.status = status;
    this.details = details;
    this.retryAfter = retryAfter;
  }
}

const GUEST_SESSION_KEY = 'aroma_guest_session';
const RECENT_ORDERS_LIMIT = 10;

const uuid = () => crypto.randomUUID();

/**
 * UUID гостевой сессии: один на вкладку браузера (sessionStorage) — повторная отправка того же заказа
 * идёт с прежним идентификатором; после закрытия вкладки он не хранится.
 */
export function getGuestSessionId() {
  try {
    const saved = sessionStorage.getItem(GUEST_SESSION_KEY);
    if (saved && /^[0-9a-f-]{36}$/i.test(saved)) return saved;
    const id = uuid();
    sessionStorage.setItem(GUEST_SESSION_KEY, id);
    return id;
  } catch {
    return uuid();
  }
}

async function postOrder(body, headers) {
  let res;
  try {
    res = await fetch('/api/order', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  } catch {
    throw new OrderSubmitError('network');
  }
  const data = await res.json().catch(() => null);
  if (res.ok && data?.ok && data.order) return data;
  const { ok: _ok, error, ...details } = data || {};
  // Диагностика: статус и код ответа сервера (без тела запроса и токенов)
  console.warn('[order] /api/order:', res.status, typeof error === 'string' ? error : 'no-code');
  throw new OrderSubmitError(typeof error === 'string' ? error : res.status >= 500 ? 'network' : 'invalid_request', {
    status: res.status,
    details,
    retryAfter: Number(res.headers.get('Retry-After')) || details.retryAfter || null,
  });
}

/**
 * Отправить заказ на сервер. request — тело без requestId (utils/orderRequest.js),
 * requestId — UUID этой попытки (тот же при повторе после сбоя сети).
 * Возвращает ответ сервера { order, idempotent }. Бросает OrderSubmitError.
 */
export async function submitOrder(request, { requestId, signedIn }) {
  if (signedIn) {
    const { auth } = await getFirebase();
    const current = auth.currentUser;
    // Сессия потеряна — не оформляем как гостя: покупатель должен войти снова
    if (!current) throw new OrderSubmitError('auth_required', { status: 401 });
    const send = async (forceRefresh) => postOrder({ ...request, requestId }, { Authorization: `Bearer ${await current.getIdToken(forceRefresh)}` });
    try {
      return await send(false);
    } catch (err) {
      // Токен успел истечь — один раз обновляем и повторяем тот же запрос (тот же requestId)
      if (err.code === 'auth_expired') return send(true);
      throw err;
    }
  }
  let appCheckToken;
  try {
    appCheckToken = await getGuestAppCheckToken();
  } catch (err) {
    // Диагностика: код ошибки App Check и HTTP-статус обмена, без токенов
    console.warn('[order] App Check: токен не получен', appCheckFailureInfo(err));
    throw new OrderSubmitError('app_check_unavailable');
  }
  return postOrder({ ...request, requestId, guestSessionId: getGuestSessionId() }, { 'X-Firebase-AppCheck': appCheckToken });
}

/** Сводка последних заказов этого браузера — только безопасные поля ответа сервера (без персональных данных) */
export function saveRecentOrder(result) {
  const summary = toRecentOrder(result);
  const all = loadFromStorage(STORAGE_KEYS.recentOrders, []).filter((o) => o?.orderId !== summary.orderId);
  saveToStorage(STORAGE_KEYS.recentOrders, [summary, ...all].slice(0, RECENT_ORDERS_LIMIT));
}

export function findRecentOrder(orderId) {
  return loadFromStorage(STORAGE_KEYS.recentOrders, []).find((o) => o?.orderId === orderId) || null;
}

/** Демо-режим (без Firebase): заказ только в localStorage этого браузера */
export async function createDemoOrder(order) {
  if (AUTH_MODE === 'firebase') throw new Error('demo-only');
  await new Promise((r) => setTimeout(r, 500));
  const saved = { ...order, mode: 'demo', status: 'demo' };
  const all = loadFromStorage(STORAGE_KEYS.demoOrders, []);
  saveToStorage(STORAGE_KEYS.demoOrders, [saved, ...all].slice(0, 50));
  return saved;
}

export async function getOrders(user) {
  if (!user) return [];
  if (AUTH_MODE === 'firebase') {
    const { db, dbApi } = await getFirebase();
    const q = dbApi.query(
      dbApi.collection(db, 'users', user.uid, 'orders'),
      dbApi.orderBy('createdAt', 'desc'),
    );
    const snap = await dbApi.getDocs(q);
    return snap.docs.map((d) => d.data());
  }
  return loadFromStorage(STORAGE_KEYS.demoOrders, []).filter((o) => o.userId === user.uid);
}

/** Поиск демо-заказа по номеру (для страницы успешного оформления после обновления) */
export function findLocalOrder(orderId) {
  return loadFromStorage(STORAGE_KEYS.demoOrders, []).find((o) => o.id === orderId) || null;
}
