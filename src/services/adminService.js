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
import { orderDocPath, orderOwnerFromPath } from '../utils/adminOrders';
import { prepareCatalogImport } from '../utils/products';
import { AdminError, toAdminError } from './adminErrors';
import * as productsStore from './adminProductsStore';
import * as adminReviewsStore from './adminReviewsStore';
import * as adminsStore from './adminAdminsStore';

// Ошибка с кодом для интерфейса (коды — в adminErrors.js)
export { AdminError };

export const isAdminAvailable = isFirebaseConfigured;

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

// ---------- Заказы (этап 3; гостевые — C3.3, этап 5) ----------
// Заказы покупателей лежат в users/{uid}/orders/{orderId}, гостевые — в guests/{guestKey}/orders/{orderId}
// (guestKey — HMAC гостевой сессии, а не UID). Админ читает их все одним запросом collectionGroup('orders')
// с сортировкой и лимитом — правило `match /{path=**}/orders/{orderId}` разрешает это только при isAdmin().
// Обычному пользователю и гостю такой запрос вернёт permission-denied.

const ORDERS_LIMIT = 500;

/**
 * Документ Firestore → объект заказа для админки. Тип и владелец — только из пути документа:
 * users/{uid} — покупатель (userId), guests/{guestKey} — гость (isGuest, guestKey; userId: null).
 */
export function toAdminOrder(snap) {
  const data = snap.data();
  const owner = orderOwnerFromPath(snap.ref.path);
  const isGuest = owner?.kind === 'guest';
  return {
    ...data,
    id: snap.id,
    isGuest,
    guestKey: isGuest ? owner.ownerId : null,
    userId: isGuest ? null : owner?.ownerId || data.userId || null,
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

/** Один заказ: { kind: 'user' | 'guest', ownerId, orderId }; null — не найден */
export async function fetchOrder({ kind, ownerId, orderId }) {
  try {
    const { db, dbApi } = await getFirebase();
    const snap = await dbApi.getDoc(dbApi.doc(db, ...orderDocPath({ kind, ownerId, orderId })));
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
 * Изменение статуса заказа { kind, ownerId, orderId }. Записываются только status и statusUpdatedAt —
 * правила firestore.rules отклонят любое другое поле, неизвестный статус и запрос не от админа.
 * Гостевые заказы — то же правило (match /guests/{guestKey}/orders, этап 6 плана C3.3). Если в Firebase
 * опубликованы старые правила без него — ошибка guest-status-rules, документ не меняется.
 */
export async function updateOrderStatus({ kind, ownerId, orderId }, status) {
  if (!isOrderStatus(status)) throw new AdminError('failed');
  try {
    const { db, dbApi } = await getFirebase();
    await dbApi.updateDoc(dbApi.doc(db, ...orderDocPath({ kind, ownerId, orderId })), {
      status,
      statusUpdatedAt: dbApi.serverTimestamp(),
    });
  } catch (err) {
    if (kind === 'guest' && err?.code === 'permission-denied') throw new AdminError('guest-status-rules');
    throw toAdminError(err);
  }
}

/**
 * Повторная отправка уведомления о заказе в Telegram — только по явному действию администратора.
 * Сервер (api/order-notify.js) проверяет ID-токен и роль (admins/{uid}), что заказ есть и уведомление
 * действительно не отправлено, и отправляет с «арендой» (два администратора не отправят одновременно).
 * Возвращает новый статус: 'sent' | 'failed' | 'in_progress'.
 */
export async function resendOrderNotification({ kind, ownerId, orderId }) {
  const { auth } = await getFirebase();
  const current = auth.currentUser;
  if (!current) throw new AdminError('not-signed-in');
  let res;
  try {
    res = await fetch('/api/order-notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await current.getIdToken()}` },
      body: JSON.stringify({ kind, ownerId, orderId }),
    });
  } catch {
    throw new AdminError('network');
  }
  const data = await res.json().catch(() => ({}));
  if (res.ok && data.ok) return data.notification;
  const known = ['already_sent', 'in_progress', 'not_needed', 'not_found', 'not_admin', 'auth_invalid', 'not_configured'];
  throw new AdminError(known.includes(data.error) ? `notify-${data.error}` : 'failed');
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

// ---------- Управление товарами (этап 5б) ----------
// Логика и транзакции — в adminProductsStore.js (проверяется тестами на модели Firestore),
// здесь — подключение Firebase и единые коды ошибок. Скрытие и удаление — этап 5в (ниже).

/** Вызвать функцию adminProductsStore с подключённым Firebase */
async function withFirebase(fn, ...args) {
  try {
    return await fn(await getFirebase(), ...args);
  } catch (err) {
    throw toAdminError(err);
  }
}

/** Все товары, включая скрытые: { products, invalidIds } */
export const fetchAllProducts = () => withFirebase(productsStore.fetchAllProducts);

/** Товар для формы: { product, damaged, updatedAt }; нет товара — 'not-found' */
export const fetchProductForEdit = (id) => withFirebase(productsStore.fetchProductForEdit, id);

/** Создание: занятый id — 'id-taken', ничего не перезаписывается */
export const createProduct = (data) => withFirebase(productsStore.createProduct, data);

/** Изменение: id и hidden сохраняются; изменён после открытия формы — 'conflict'; удалён — 'not-found' */
export const updateProduct = (id, data, loadedUpdatedAt) =>
  withFirebase(productsStore.updateProduct, id, data, loadedUpdatedAt);

// ---------- Скрытие и удаление товаров (этап 5в) ----------

/**
 * Скрыть (true) или вернуть на витрину (false): меняются только hidden и updatedAt.
 * Ошибки: not-found, conflict, damaged, last-visible (последний видимый товар скрыть нельзя).
 */
export const setProductHidden = (id, hidden, loadedUpdatedAt) =>
  withFirebase(productsStore.setProductHidden, id, hidden, loadedUpdatedAt);

/** Окончательное удаление только скрытого товара. Ошибки: not-found, conflict, not-hidden, last-visible */
export const deleteProduct = (id, loadedUpdatedAt) => withFirebase(productsStore.deleteProduct, id, loadedUpdatedAt);

// ---------- Модерация отзывов (этап E) ----------
// Логика и транзакции — в adminReviewsStore.js (проверяется тестами на модели Firestore).
// Правила firestore.rules (этап D): администратор читает отзывы всех статусов, меняет только
// status и moderatedAt и навсегда удаляет только отклонённые. Публичные запросы — в reviewsService.js.

/** Все отзывы любого статуса, новые сверху: { reviews, invalidIds, limited } */
export const fetchAllReviews = (options) => withFirebase(adminReviewsStore.fetchAllReviews, options);

/**
 * Новый статус отзыва (pending, approved, rejected): записываются только status и moderatedAt.
 * loadedStatus — статус при загрузке списка. Ошибки: not-found, conflict (статус изменили в другом окне), invalid.
 * Статус уже такой — ничего не записывается: { changed: false }.
 */
export const setReviewStatus = (id, status, loadedStatus) =>
  withFirebase(adminReviewsStore.setReviewStatus, id, status, loadedStatus);

/** Окончательное удаление только отклонённого отзыва. Ошибки: not-found, not-rejected */
export const deleteReview = (id) => withFirebase(adminReviewsStore.deleteReview, id);

// ---------- Администраторы и передача роли владельца (этап A4) ----------
// Логика и транзакции — в adminAdminsStore.js (проверяется на Firebase Emulator с настоящими правилами).
// UID вошедшего пользователя берётся только из Firebase Auth: интерфейс не может действовать
// от имени другого пользователя. Окончательное решение — правила firestore.rules (этапы A3, A3.1).

/** Вызвать функцию adminAdminsStore от имени вошедшего пользователя */
async function withActor(fn, ...args) {
  try {
    const fb = await getFirebase();
    const actorUid = fb.auth.currentUser?.uid;
    if (!actorUid) throw new AdminError('not-signed-in');
    return await fn(fb, actorUid, ...args);
  } catch (err) {
    throw toAdminError(err);
  }
}

/** Моя роль в управлении: { access: 'owner' | 'pending' | 'none', config } (none — не ошибка) */
export const fetchOwnerStatus = () => withActor(adminsStore.fetchOwnerStatus);

/** Все администраторы — только владельцу: { admins, config }; остальным — 'not-owner' */
export const fetchAdmins = () => withActor(adminsStore.fetchAdmins);

/** Назначить администратором зарегистрированного пользователя по UID. Ошибки: user-not-found, already-admin, self… */
export const grantAdmin = (uid, options) => withActor(adminsStore.grantAdmin, uid, options);

/** Отозвать доступ одного администратора. Ошибки: self, owner-protected, pending-owner, not-admin, not-owner */
export const revokeAdmin = (uid) => withActor(adminsStore.revokeAdmin, uid);

/** Предложить роль владельца администратору. Ошибки: offer-exists, candidate-not-admin, self, not-owner */
export const offerOwnerTransfer = (uid) => withActor(adminsStore.offerOwnerTransfer, uid);

/** Отменить предложение (владелец). expectedPendingUid — кандидат на экране; изменился — 'offer-stale' */
export const cancelOwnerTransfer = (expectedPendingUid) => withActor(adminsStore.cancelOwnerTransfer, expectedPendingUid);

/** Отклонить предложение (кандидат, своим входом). Предложения нет — 'no-offer' */
export const declineOwnerTransfer = () => withActor(adminsStore.declineOwnerTransfer);

/** Принять роль владельца (кандидат, своим входом). expectedOwnerUid — владелец на экране; изменился — 'offer-stale' */
export const acceptOwnerTransfer = (expectedOwnerUid) => withActor(adminsStore.acceptOwnerTransfer, expectedOwnerUid);
