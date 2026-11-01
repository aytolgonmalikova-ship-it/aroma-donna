/**
 * Административная часть магазина.
 *
 * Администратор — пользователь Firebase Authentication, для которого существует
 * документ admins/{uid}. Документ создаётся только вручную в Firebase Console
 * (или в будущем серверным API с Firebase Admin SDK) — из браузера его записать нельзя.
 *
 * Проверка здесь нужна только интерфейсу (показать или скрыть админ-панель).
 * Настоящая защита данных — функция isAdmin() в правилах firestore.rules.
 *
 * В демо-режиме (без Firebase) админ-панель недоступна: проверить роль на сервере нельзя.
 */
import { getFirebase, isFirebaseConfigured } from './firebase';
import { isOrderStatus } from '../utils/orderStatus';

export const isAdminAvailable = isFirebaseConfigured;

/** Ошибка с кодом для интерфейса: not-configured, network, denied, failed */
export class AdminError extends Error {
  constructor(code, cause) {
    super(code);
    this.code = code;
    this.cause = cause;
  }
}

function toAdminError(err) {
  if (err instanceof AdminError) return err;
  if (err?.message === 'firebase-not-configured') return new AdminError('not-configured', err);
  if (err?.code === 'unavailable' || err?.code === 'deadline-exceeded') return new AdminError('network', err);
  if (err?.code === 'permission-denied') return new AdminError('denied', err);
  return new AdminError('failed', err);
}

/**
 * Есть ли у пользователя роль администратора.
 * Правила разрешают прочитать только свой документ admins/{uid}, поэтому
 * для обычного покупателя ответ просто «документа нет» → false.
 */
export async function checkIsAdmin(uid) {
  if (!uid) return false;
  try {
    const { db, dbApi } = await getFirebase();
    const snap = await dbApi.getDoc(dbApi.doc(db, 'admins', uid));
    return snap.exists();
  } catch (err) {
    // permission-denied — например, сессия устарела: считаем, что прав нет
    if (err?.code === 'permission-denied') return false;
    throw toAdminError(err);
  }
}

// ---------- Заказы (этап 3) ----------
// Заказы покупателей лежат в users/{uid}/orders/{orderId}. Админ читает их все одним
// запросом collectionGroup('orders') — правило `match /{path=**}/orders/{orderId}`
// разрешает это только при isAdmin(). Обычному пользователю такой запрос вернёт permission-denied.

const ORDERS_LIMIT = 500;

/** Документ Firestore → объект заказа для админки (uid владельца берём из пути документа) */
function toAdminOrder(snap) {
  const data = snap.data();
  return {
    ...data,
    id: snap.id,
    userId: snap.ref.parent.parent?.id || data.userId || null,
    statusUpdatedAt: data.statusUpdatedAt?.toDate ? data.statusUpdatedAt.toDate().toISOString() : null,
  };
}

/** Все заказы, новые сверху */
export async function fetchAllOrders() {
  try {
    const { db, dbApi } = await getFirebase();
    const group = dbApi.collectionGroup(db, 'orders');
    let snap;
    try {
      snap = await dbApi.getDocs(dbApi.query(group, dbApi.orderBy('createdAt', 'desc'), dbApi.limit(ORDERS_LIMIT)));
    } catch (err) {
      // Нет индекса collectionGroup для createdAt (firestore.indexes.json ещё не развёрнут) —
      // читаем без сортировки и сортируем в браузере
      if (err?.code !== 'failed-precondition') throw err;
      console.warn('[admin] Нет индекса orders.createdAt (collection group) — сортировка в браузере');
      snap = await dbApi.getDocs(group);
    }
    return snap.docs
      .map(toAdminOrder)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  } catch (err) {
    throw toAdminError(err);
  }
}

/** Один заказ по пути users/{userId}/orders/{orderId}; null — не найден */
export async function fetchOrder(userId, orderId) {
  try {
    const { db, dbApi } = await getFirebase();
    const snap = await dbApi.getDoc(dbApi.doc(db, 'users', userId, 'orders', orderId));
    return snap.exists() ? toAdminOrder(snap) : null;
  } catch (err) {
    throw toAdminError(err);
  }
}

/** Количество заказов (агрегатный запрос: документы не скачиваются) */
export async function fetchOrdersCount() {
  try {
    const { db, dbApi } = await getFirebase();
    const snap = await dbApi.getCountFromServer(dbApi.collectionGroup(db, 'orders'));
    return snap.data().count;
  } catch (err) {
    throw toAdminError(err);
  }
}

/**
 * Изменение статуса заказа. Записываются только status и statusUpdatedAt —
 * правила firestore.rules отклонят любое другое поле, неизвестный статус и запрос не от админа.
 */
export async function updateOrderStatus(userId, orderId, status) {
  if (!isOrderStatus(status)) throw new AdminError('failed');
  try {
    const { db, dbApi } = await getFirebase();
    await dbApi.updateDoc(dbApi.doc(db, 'users', userId, 'orders', orderId), {
      status,
      statusUpdatedAt: dbApi.serverTimestamp(),
    });
  } catch (err) {
    throw toAdminError(err);
  }
}
