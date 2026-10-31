/**
 * Отзывы покупателей в Firestore (коллекция `reviews`).
 *
 * - Читать отзывы может любой посетитель.
 * - Добавить отзыв может любой посетитель; формат и длину полей проверяют правила
 *   firestore.rules на сервере Firebase. Изменять и удалять отзывы из браузера нельзя —
 *   только владелец магазина в Firebase Console.
 * - Без настроенного Firebase отзывы не загружаются и не сохраняются (ошибка 'not-configured').
 *   Выдуманных «демо-отзывов» нет.
 */
import { getFirebase, isFirebaseConfigured } from './firebase';
import { loadFromStorage, saveToStorage, STORAGE_KEYS } from '../utils/storage';

export const REVIEWS_PAGE_SIZE = 9;
// Не чаще одного отзыва в минуту из одного браузера (основная защита — правила Firestore)
const COOLDOWN_MS = 60 * 1000;

export const isReviewsAvailable = isFirebaseConfigured;

/** Ошибка с понятным кодом для интерфейса: not-configured, permission, network, cooldown, failed */
export class ReviewsError extends Error {
  constructor(code, cause) {
    super(code);
    this.code = code;
    this.cause = cause;
  }
}

function toReviewsError(err) {
  if (err instanceof ReviewsError) return err;
  if (err?.message === 'firebase-not-configured') return new ReviewsError('not-configured', err);
  // Коды ошибок Firestore: https://firebase.google.com/docs/reference/js/firestore_.firestoreerrorcode
  if (err?.code === 'permission-denied') return new ReviewsError('permission', err);
  if (err?.code === 'unavailable' || err?.code === 'deadline-exceeded') return new ReviewsError('network', err);
  if (err?.code === 'failed-precondition') return new ReviewsError('failed', err); // например, нет индекса
  return new ReviewsError('failed', err);
}

/** Документ Firestore → обычный объект для интерфейса */
function fromDoc(doc) {
  const data = doc.data();
  return {
    id: doc.id,
    name: data.name,
    rating: data.rating,
    text: data.text,
    // serverTimestamp() ещё может быть не записан — тогда берём текущее время
    createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : new Date().toISOString(),
  };
}

/**
 * Загружает страницу отзывов (новые сверху).
 * cursor — последний документ предыдущей страницы (для кнопки «Показать ещё»).
 */
export async function fetchReviews({ cursor = null, pageSize = REVIEWS_PAGE_SIZE } = {}) {
  try {
    const { db, dbApi } = await getFirebase();
    const parts = [dbApi.collection(db, 'reviews'), dbApi.orderBy('createdAt', 'desc')];
    if (cursor) parts.push(dbApi.startAfter(cursor));
    parts.push(dbApi.limit(pageSize));
    const snap = await dbApi.getDocs(dbApi.query(...parts));
    return {
      reviews: snap.docs.map(fromDoc),
      cursor: snap.docs[snap.docs.length - 1] || null,
      hasMore: snap.docs.length === pageSize,
    };
  } catch (err) {
    throw toReviewsError(err);
  }
}

/** Средняя оценка и число отзывов — считает сервер Firestore по всей коллекции */
export async function fetchReviewStats() {
  try {
    const { db, dbApi } = await getFirebase();
    const snap = await dbApi.getAggregateFromServer(dbApi.collection(db, 'reviews'), {
      count: dbApi.count(),
      average: dbApi.average('rating'),
    });
    const { count, average } = snap.data();
    return { count, average: count ? average : null };
  } catch (err) {
    throw toReviewsError(err);
  }
}

/** Сохраняет отзыв. Возвращает сохранённый отзыв для мгновенного показа в списке. */
export async function addReview({ name, rating, text }, lang) {
  const last = Number(loadFromStorage(STORAGE_KEYS.lastReviewAt, 0)) || 0;
  if (Date.now() - last < COOLDOWN_MS) throw new ReviewsError('cooldown');
  try {
    const { db, dbApi } = await getFirebase();
    const review = { name: name.trim(), rating, text: text.trim() };
    const ref = await dbApi.addDoc(dbApi.collection(db, 'reviews'), {
      ...review,
      lang,
      createdAt: dbApi.serverTimestamp(),
    });
    saveToStorage(STORAGE_KEYS.lastReviewAt, Date.now());
    return { id: ref.id, ...review, createdAt: new Date().toISOString() };
  } catch (err) {
    throw toReviewsError(err);
  }
}
