// Ручная повторная отправка уведомления о заказе в Telegram: POST /api/order-notify (C3.3, этап 5).
// Только администратор (owner или admin): сервер сам проверяет ID-токен и документ admins/{uid}
// (Admin SDK), что заказ существует и уведомление действительно не отправлено. Отправка — с той же
// «арендой», что при оформлении (orderStore.notifyOrder): два администратора не отправят одно
// уведомление одновременно. Токен Telegram в ответы и журналы не попадает. Автоматических повторов нет.

import { getAdmin } from './firebaseAdmin.js';
import { notifyOrder } from './orderStore.js';

const MAX_BODY_BYTES = 1024;
const UID = /^[A-Za-z0-9_-]{1,128}$/;
const GUEST_KEY = /^[0-9a-f]{40}$/;
const ORDER_ID = /^[A-Z0-9-]{4,40}$/;

const reply = (status, body) => ({ status, body, headers: { 'Cache-Control': 'no-store' } });
const fail = (status, error) => reply(status, { ok: false, error });

function parseBody(body, headers) {
  const declared = Number(headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  let data = body;
  if (typeof data === 'string' || Buffer.isBuffer(data)) {
    if (Buffer.byteLength(data) > MAX_BODY_BYTES) return null;
    try {
      data = JSON.parse(String(data));
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const keys = Object.keys(data);
  if (keys.length !== 3 || !['kind', 'ownerId', 'orderId'].every((k) => keys.includes(k))) return null;
  const { kind, ownerId, orderId } = data;
  if (kind === 'user' && typeof ownerId === 'string' && UID.test(ownerId) && typeof orderId === 'string' && ORDER_ID.test(orderId)) return data;
  if (kind === 'guest' && typeof ownerId === 'string' && GUEST_KEY.test(ownerId) && typeof orderId === 'string' && ORDER_ID.test(orderId)) return data;
  return null;
}

/** Обработка запроса. deps (для тестов): { admin, fetchImpl, now }. Возвращает { status, body, headers }. */
export async function handleNotify({ method, headers = {}, body, env = process.env, deps = {} }) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  try {
    if (method !== 'POST') return fail(405, 'method_not_allowed');
    const admin = deps.admin || getAdmin(env);
    if (admin.error) {
      console.error('[order-notify] сервер не настроен:', admin.error);
      return fail(503, 'not_configured');
    }
    // Администратор: проверенный токен и документ admins/{uid} — роль только с сервера
    const match = typeof lower.authorization === 'string' ? lower.authorization.match(/^Bearer ([A-Za-z0-9._-]{20,4096})$/) : null;
    if (!match) return fail(401, 'auth_invalid');
    let uid;
    try {
      uid = (await admin.auth.verifyIdToken(match[1], true)).uid;
    } catch {
      return fail(401, 'auth_invalid');
    }
    if (!(await admin.db.collection('admins').doc(uid).get()).exists) return fail(403, 'not_admin');

    const target = parseBody(body, lower);
    if (!target) return fail(400, 'invalid_request');
    const ref = admin.db.collection(target.kind === 'guest' ? 'guests' : 'users').doc(target.ownerId).collection('orders').doc(target.orderId);
    const snap = await ref.get();
    if (!snap.exists) return fail(404, 'not_found');
    const n = snap.get('notification');
    const now = deps.now || (() => Date.now());
    if (!n || typeof n !== 'object') return fail(409, 'not_needed'); // старые заказы без уведомлений
    if (n.status === 'sent') return fail(409, 'already_sent');
    if (n.status === 'sending' && typeof n.leaseUntil === 'number' && n.leaseUntil > now()) return fail(409, 'in_progress');
    if (n.status !== 'failed' && n.status !== 'sending') return fail(409, 'not_needed');

    const result = await notifyOrder(admin.db, ref, { env, fetchImpl: deps.fetchImpl, now });
    console.info('[order-notify] повторная отправка:', snap.id, result);
    return reply(200, { ok: true, notification: result === 'skipped' ? 'in_progress' : result });
  } catch (err) {
    console.error('[order-notify] непредвиденная ошибка:', err?.name, err?.code);
    return fail(500, 'server_error');
  }
}
