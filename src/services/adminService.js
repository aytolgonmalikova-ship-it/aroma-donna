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
import { buildCustomers } from '../utils/customers';
import { prepareCatalogImport } from '../utils/products';

export const isAdminAvailable = isFirebaseConfigured;

/** Ошибка с кодом для интерфейса: not-configured, network, denied, failed, not-empty, invalid */
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

// ---------- Покупатели (этап 4) ----------
// Профили лежат в users/{uid} (поля name, email, createdAt). Правило
// `allow read: if isOwner(userId) || isAdmin()` даёт админу только чтение.
// Статистика (число заказов, сумма, последний заказ) считается из заказов в браузере —
// см. src/utils/customers.js.

const CUSTOMERS_LIMIT = 1000;

/** Документ users/{uid} → профиль покупателя (дата регистрации — ISO-строка) */
function toCustomerProfile(snap) {
  const data = snap.data();
  return {
    uid: snap.id,
    name: typeof data.name === 'string' ? data.name : '',
    email: typeof data.email === 'string' ? data.email : '',
    createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : null,
  };
}

/** Все покупатели: профили + статистика по их заказам */
export async function fetchAllCustomers() {
  try {
    const { db, dbApi } = await getFirebase();
    const [usersSnap, orders] = await Promise.all([
      dbApi.getDocs(dbApi.query(dbApi.collection(db, 'users'), dbApi.limit(CUSTOMERS_LIMIT))),
      fetchAllOrders(),
    ]);
    return buildCustomers(usersSnap.docs.map(toCustomerProfile), orders);
  } catch (err) {
    throw toAdminError(err);
  }
}

/** Один покупатель с его заказами; null — нет ни профиля, ни заказов */
export async function fetchCustomer(uid) {
  try {
    const { db, dbApi } = await getFirebase();
    const [profileSnap, ordersSnap] = await Promise.all([
      dbApi.getDoc(dbApi.doc(db, 'users', uid)),
      // Заказы одного покупателя: сортировка в браузере, отдельный индекс не нужен
      dbApi.getDocs(dbApi.collection(db, 'users', uid, 'orders')),
    ]);
    const profiles = profileSnap.exists() ? [toCustomerProfile(profileSnap)] : [];
    return buildCustomers(profiles, ordersSnap.docs.map(toAdminOrder))[0] || null;
  } catch (err) {
    throw toAdminError(err);
  }
}

/** Количество зарегистрированных покупателей (профилей users) — агрегатный запрос */
export async function fetchCustomersCount() {
  try {
    const { db, dbApi } = await getFirebase();
    const snap = await dbApi.getCountFromServer(dbApi.collection(db, 'users'));
    return snap.data().count;
  } catch (err) {
    throw toAdminError(err);
  }
}

// ---------- Товары (этап 5а) ----------
// Каталог лежит в products/{id}. Правила firestore.rules: посетитель читает только видимые
// товары, администратор — все, запись — только администратор и только в строгом формате.

/** Количество всех товаров в Firestore, включая скрытые (запрос без фильтра разрешён только админу) */
export async function fetchProductsCount() {
  try {
    const { db, dbApi } = await getFirebase();
    const snap = await dbApi.getCountFromServer(dbApi.collection(db, 'products'));
    return snap.data().count;
  } catch (err) {
    throw toAdminError(err);
  }
}

/**
 * Первичный импорт демо-каталога в пустую коллекцию products.
 * Документы получают прежние id товаров, поэтому ссылки, корзины и избранное продолжают работать.
 *
 * Защита от дубликатов и перезаписи:
 * 1) до записи проверяем, что в коллекции нет ни одного документа (любого id) — иначе 'not-empty';
 * 2) запись — одна транзакция: она заново читает все 24 документа и прерывается,
 *    если хоть один уже существует (например, импорт запустили одновременно в двух вкладках).
 * Транзакция записывает либо весь каталог, либо ничего.
 */
export async function importDemoCatalog(products) {
  let docs;
  try {
    docs = prepareCatalogImport(products);
  } catch (err) {
    throw new AdminError('invalid', err);
  }
  try {
    const { db, dbApi } = await getFirebase();
    const collection = dbApi.collection(db, 'products');
    const existing = await dbApi.getDocs(dbApi.query(collection, dbApi.limit(1)));
    if (!existing.empty) throw new AdminError('not-empty');

    await dbApi.runTransaction(db, async (tx) => {
      const refs = docs.map((d) => dbApi.doc(collection, d.id));
      const snaps = await Promise.all(refs.map((ref) => tx.get(ref)));
      if (snaps.some((snap) => snap.exists())) throw new AdminError('not-empty');
      refs.forEach((ref, i) => tx.set(ref, { ...docs[i], updatedAt: dbApi.serverTimestamp() }));
    });
    return docs.length;
  } catch (err) {
    throw toAdminError(err);
  }
}
