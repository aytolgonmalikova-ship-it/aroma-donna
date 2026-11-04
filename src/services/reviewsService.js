/**
 * Отзывы покупателей в Firestore (коллекция `reviews`).
 *
 * - Посетителям показываются и учитываются в рейтинге только одобренные отзывы (status: 'approved').
 * - Добавить отзыв может любой посетитель, в том числе без входа; новый отзыв сохраняется
 *   со статусом 'pending' и появится на сайте только после одобрения (модерация, этап C).
 *   Формат и длину полей проверяют правила firestore.rules на сервере Firebase.
 *   Изменять и удалять отзывы из браузера нельзя — только владелец магазина в Firebase Console.
 * - Запросы к Firestore — в reviewsStore.js; здесь подключение, ошибки и ограничение частоты.
 * - Без настроенного Firebase отзывы не загружаются и не сохраняются (ошибка 'not-configured').
 *   Выдуманных «демо-отзывов» нет.
 */
import { getFirebase, isFirebaseConfigured } from './firebase';
import { loadFromStorage, saveToStorage, STORAGE_KEYS } from '../utils/storage';
import { createReview, fetchApprovedReviews, fetchApprovedStats } from './reviewsStore';

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

/**
 * Загружает страницу одобренных отзывов (новые сверху).
 * cursor — последний документ предыдущей страницы (для кнопки «Показать ещё»).
 */
export async function fetchReviews({ cursor = null, pageSize = REVIEWS_PAGE_SIZE } = {}) {
  try {
    return await fetchApprovedReviews(await getFirebase(), { cursor, pageSize });
  } catch (err) {
    throw toReviewsError(err);
  }
}

/** Число одобренных отзывов и их средняя оценка (ожидающие модерации не учитываются) */
export async function fetchReviewStats() {
  try {
    return await fetchApprovedStats(await getFirebase());
  } catch (err) {
    throw toReviewsError(err);
  }
}

/**
 * Отправляет отзыв на модерацию. В публичный список он попадёт только после одобрения,
 * поэтому возвращается лишь { id, status: 'pending' }.
 */
export async function addReview({ name, rating, text }, lang) {
  const last = Number(loadFromStorage(STORAGE_KEYS.lastReviewAt, 0)) || 0;
  if (Date.now() - last < COOLDOWN_MS) throw new ReviewsError('cooldown');
  try {
    const saved = await createReview(await getFirebase(), { name, rating, text }, lang);
    saveToStorage(STORAGE_KEYS.lastReviewAt, Date.now());
    return saved;
  } catch (err) {
    throw toReviewsError(err);
  }
}
