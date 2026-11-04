// Отзывы в Firestore (коллекция reviews): публичная выборка, статистика и создание отзыва.
// Функции получают подключение { db, dbApi } параметром — reviewsService.js передаёт настоящий Firebase,
// а tests/reviewsStore.test.js — модель Firestore в памяти.
//
// Модерация (этап C): новый отзыв сохраняется со статусом 'pending', посетителям показываются
// и учитываются в рейтинге только отзывы со статусом 'approved'.

export const COLLECTION = 'reviews';
export const REVIEW_STATUS = { pending: 'pending', approved: 'approved', rejected: 'rejected' };

/** Только одобренные отзывы — фильтр каждого публичного запроса */
const approvedOnly = (dbApi) => dbApi.where('status', '==', REVIEW_STATUS.approved);

/** Документ Firestore → обычный объект для интерфейса */
export function fromDoc(doc) {
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
 * Страница одобренных отзывов (новые сверху).
 * Запрос where(status == 'approved') + orderBy(createdAt desc) использует составной индекс
 * reviews: status ↑, createdAt ↓ (firestore.indexes.json).
 * cursor — последний документ предыдущей страницы (для кнопки «Показать ещё»).
 */
export async function fetchApprovedReviews({ db, dbApi }, { cursor = null, pageSize }) {
  const parts = [dbApi.collection(db, COLLECTION), approvedOnly(dbApi), dbApi.orderBy('createdAt', 'desc')];
  if (cursor) parts.push(dbApi.startAfter(cursor));
  parts.push(dbApi.limit(pageSize));
  const snap = await dbApi.getDocs(dbApi.query(...parts));
  return {
    reviews: snap.docs.map(fromDoc),
    cursor: snap.docs[snap.docs.length - 1] || null,
    hasMore: snap.docs.length === pageSize,
  };
}

/** Среднее по списку оценок; пустой список — null */
export function averageRating(ratings) {
  return ratings.length ? ratings.reduce((sum, r) => sum + r, 0) / ratings.length : null;
}

/**
 * Число одобренных отзывов и их средняя оценка.
 * Обычно считает сервер (getAggregateFromServer). average(rating) с фильтром по status требует
 * отдельного составного индекса status + rating; пока его нет, Firestore отвечает failed-precondition —
 * тогда оценки одобренных отзывов читаются и усредняются здесь (запрос с одним фильтром индекса не требует).
 */
export async function fetchApprovedStats({ db, dbApi }) {
  const approved = dbApi.query(dbApi.collection(db, COLLECTION), approvedOnly(dbApi));
  try {
    const snap = await dbApi.getAggregateFromServer(approved, { count: dbApi.count(), average: dbApi.average('rating') });
    const { count, average } = snap.data();
    return { count, average: count ? average : null };
  } catch (err) {
    if (err?.code !== 'failed-precondition') throw err;
    console.warn('[reviews] Нет индекса reviews (status, rating) — средняя оценка считается в браузере.', err);
    const snap = await dbApi.getDocs(approved);
    const ratings = snap.docs.map((d) => d.data().rating).filter((r) => typeof r === 'number');
    return { count: snap.docs.length, average: averageRating(ratings) };
  }
}

/**
 * Новый отзыв — всегда на модерацию (status: 'pending'). Вход не нужен: отзыв может оставить гость.
 * Поля совпадают с isValidReview в firestore.rules. Возвращает { id, status }.
 */
export async function createReview({ db, dbApi }, { name, rating, text }, lang) {
  const ref = await dbApi.addDoc(dbApi.collection(db, COLLECTION), {
    name: name.trim(),
    rating,
    text: text.trim(),
    lang,
    status: REVIEW_STATUS.pending,
    createdAt: dbApi.serverTimestamp(),
  });
  return { id: ref.id, status: REVIEW_STATUS.pending };
}
