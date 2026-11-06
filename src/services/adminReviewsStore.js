// Отзывы в Firestore для админ-панели (этап E): все отзывы любого статуса, смена статуса
// (модерация) и окончательное удаление отклонённых.
// Функции получают подключение { db, dbApi } параметром — adminService.js передаст настоящий Firebase,
// а tests/adminReviewsStore.test.js — модель Firestore в памяти.
//
// Правила firestore.rules (этап D): читать отзывы всех статусов может только администратор,
// он же меняет только поля status и moderatedAt (moderatedAt == request.time)
// и удаляет только отклонённые отзывы (status == 'rejected').
// Публичные запросы витрины — в reviewsStore.js, этот модуль их не меняет.

import { AdminError, toAdminError } from './adminErrors.js';
import { COLLECTION, REVIEW_STATUS } from './reviewsStore.js';

/** Сколько отзывов загружается в админ-панель за один раз (новые сверху) */
export const ADMIN_REVIEWS_LIMIT = 500;

const STATUSES = Object.values(REVIEW_STATUS);

export const isReviewStatus = (status) => STATUSES.includes(status);

// id документа Firestore: непустая строка без «/» (иначе doc() указал бы на другой путь)
const isReviewId = (id) => typeof id === 'string' && id.length > 0 && id.length <= 1500 && !id.includes('/');

/** Timestamp Firestore → ISO-строка (сериализуемо для состояния React); иначе null */
const toIso = (v) => (v?.toDate ? v.toDate().toISOString() : null);

/**
 * Документ reviews/{id} → отзыв для админ-панели; null — документ повреждён.
 * Повреждённым считается документ, который нельзя честно показать или промодерировать:
 * имя или текст не строка, оценка не целое 1–5, статус не из списка.
 * Даты без Timestamp не ломают отзыв — показываются как null.
 * Текст не изменяется и не обрезается: выводить его нужно как обычный текст (без HTML).
 */
export function toAdminReview(id, data) {
  if (!data || typeof data !== 'object') return null;
  const { name, text, rating, status } = data;
  if (typeof name !== 'string' || name.trim() === '') return null;
  if (typeof text !== 'string') return null;
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return null;
  if (!isReviewStatus(status)) return null;
  return {
    id,
    name,
    text,
    rating,
    status,
    lang: typeof data.lang === 'string' ? data.lang : null,
    createdAt: toIso(data.createdAt),
    moderatedAt: toIso(data.moderatedAt),
  };
}

const byCreatedAtDesc = (a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''));

/**
 * Все отзывы любого статуса, новые сверху, не больше limit (запрос без фильтра разрешён только администратору).
 * Возвращает { reviews, invalidIds, limited }: повреждённые документы не ломают список, их id — отдельно;
 * limited — загружено ровно limit документов, возможно, есть более старые.
 * Сортировка orderBy(createdAt) использует одиночный индекс; если Firestore ответит failed-precondition,
 * отзывы читаются без сортировки и сортируются в браузере (как у заказов).
 */
export async function fetchAllReviews({ db, dbApi }, { limit = ADMIN_REVIEWS_LIMIT } = {}) {
  try {
    const collection = dbApi.collection(db, COLLECTION);
    let snap;
    try {
      snap = await dbApi.getDocs(dbApi.query(collection, dbApi.orderBy('createdAt', 'desc'), dbApi.limit(limit)));
    } catch (err) {
      if (err?.code !== 'failed-precondition') throw err;
      console.warn('[admin] Нет индекса reviews.createdAt — сортировка отзывов в браузере');
      snap = await dbApi.getDocs(dbApi.query(collection, dbApi.limit(limit)));
    }
    const reviews = [];
    const invalidIds = [];
    snap.docs.forEach((d) => {
      const review = toAdminReview(d.id, d.data());
      if (review) reviews.push(review);
      else invalidIds.push(d.id);
    });
    return { reviews: reviews.sort(byCreatedAtDesc), invalidIds, limited: snap.docs.length === limit };
  } catch (err) {
    throw toAdminError(err);
  }
}

/**
 * Модерация: новый статус отзыва. Транзакция:
 * 1) нет документа → not-found;
 * 2) статус уже такой, как нужно → ничего не записывается ({ changed: false }),
 *    даже если его только что поставил другой администратор: результат тот же;
 * 3) статус отличается от загруженного (loadedStatus) → conflict: отзыв промодерировал
 *    другой администратор или вкладка, чужое решение не затирается;
 * 4) записываются только status и moderatedAt = serverTimestamp() — имя, оценка, текст, язык
 *    и дата создания не меняются (то же требует isValidReviewModeration в firestore.rules).
 * Возвращает { id, status, changed }.
 */
export async function setReviewStatus({ db, dbApi }, id, status, loadedStatus) {
  try {
    if (!isReviewId(id)) throw new AdminError('not-found');
    if (!isReviewStatus(status) || !isReviewStatus(loadedStatus)) throw new AdminError('invalid');

    const ref = dbApi.doc(db, COLLECTION, id);
    return await dbApi.runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new AdminError('not-found');
      const current = snap.data()?.status;
      if (current === status) return { id, status, changed: false };
      if (current !== loadedStatus) throw new AdminError('conflict');
      tx.update(ref, { status, moderatedAt: dbApi.serverTimestamp() });
      return { id, status, changed: true };
    });
  } catch (err) {
    throw toAdminError(err);
  }
}

/**
 * Окончательное удаление отзыва. Удалить можно только отклонённый («сначала отклонить, потом удалить»),
 * как требует правило delete в firestore.rules. Транзакция: нет документа → not-found;
 * статус не rejected (в том числе его вернули в ожидание или одобрили в другой вкладке) → not-rejected;
 * иначе tx.delete. Возвращает id удалённого отзыва.
 */
export async function deleteReview({ db, dbApi }, id) {
  try {
    if (!isReviewId(id)) throw new AdminError('not-found');
    const ref = dbApi.doc(db, COLLECTION, id);
    await dbApi.runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new AdminError('not-found');
      if (snap.data()?.status !== REVIEW_STATUS.rejected) throw new AdminError('not-rejected');
      tx.delete(ref);
    });
    return id;
  } catch (err) {
    throw toAdminError(err);
  }
}
