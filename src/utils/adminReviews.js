// Список отзывов в админ-панели (этап E2): счётчики по статусам, фильтр по статусу и оценке,
// поиск, сортировка по дате и параметры адреса (?status=&q=&rating=&sort=).
// Отзывы уже загружены (fetchAllReviews в adminReviewsStore.js), поэтому всё считается в браузере —
// новые индексы Firestore не нужны. Отзыв — в формате toAdminReview:
// { id, name, text, rating, status, lang, createdAt, moderatedAt } (даты — ISO-строки или null).
// Чистые функции — проверяются в tests/adminReviews.test.js.

import { REVIEW_STATUS } from '../services/reviewsStore.js';

// Фильтр статуса: all — все отзывы, остальные — статусы модерации
export const REVIEW_FILTER_STATUSES = ['all', ...Object.values(REVIEW_STATUS)];

// Сортировка по дате создания (первая — по умолчанию): сначала новые, сначала старые
export const REVIEW_SORTS = ['newest', 'oldest'];

// Оценки для фильтра; null — любая
export const REVIEW_RATINGS = [5, 4, 3, 2, 1];

// По умолчанию — ожидающие модерации: с ними администратор работает чаще всего
export const DEFAULT_REVIEW_FILTERS = {
  status: REVIEW_STATUS.pending,
  q: '',
  rating: null,
  sort: REVIEW_SORTS[0],
};

const asList = (reviews) => (Array.isArray(reviews) ? reviews : []);

/** Дата (ISO-строка) → миллисекунды; нет даты или она неверная — null */
const toMs = (value) => {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
};

/** Число отзывов: всего (all) и по каждому статусу; отзыв с неизвестным статусом учитывается только в all */
export function countReviewsByStatus(reviews) {
  const counts = Object.fromEntries(REVIEW_FILTER_STATUSES.map((s) => [s, 0]));
  asList(reviews).forEach((r) => {
    counts.all += 1;
    if (r?.status !== 'all' && Object.hasOwn(counts, r?.status ?? '')) counts[r.status] += 1;
  });
  return counts;
}

/** Подходит ли отзыв под фильтр статуса ('all' — любой) */
export const matchesReviewStatus = (review, status) => status === 'all' || review?.status === status;

/** Поиск по имени и тексту — без учёта регистра и пробелов по краям; пустой запрос подходит всем */
export function matchesReviewQuery(review, query) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return true;
  return [review?.name, review?.text].some((v) => String(v ?? '').toLowerCase().includes(q));
}

/** Подходит ли отзыв под фильтр оценки (null — любая) */
export const matchesReviewRating = (review, rating) => rating == null || review?.rating === rating;

/**
 * Фильтры: status — статус модерации или 'all', q — поиск по имени и тексту, rating — оценка 1–5 или null.
 * Отсутствующие фильтры не ограничивают выборку. Возвращает новый массив, исходный не меняется.
 */
export function filterAdminReviews(reviews, filters = {}) {
  const { status = 'all', q = '', rating = null } = filters;
  return asList(reviews).filter(
    (r) => matchesReviewStatus(r, status) && matchesReviewQuery(r, q) && matchesReviewRating(r, rating),
  );
}

/**
 * Сортировка по дате создания (новый массив, исходный не меняется).
 * newest — сначала новые, oldest — сначала старые; неизвестное значение — как newest.
 * Отзывы без даты (или с неверной датой) — всегда в конце; при равенстве — по id, чтобы порядок не прыгал.
 */
export function sortAdminReviews(reviews, sort = DEFAULT_REVIEW_FILTERS.sort) {
  const direction = sort === 'oldest' ? 1 : -1;
  const byId = (a, b) => String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
  return [...asList(reviews)].sort((a, b) => {
    const ma = toMs(a?.createdAt);
    const mb = toMs(b?.createdAt);
    if (ma === null || mb === null) return (ma === null) - (mb === null) || byId(a, b);
    return (ma - mb) * direction || byId(a, b);
  });
}

/** Фильтры и сортировка вместе — то, что показывает список */
export const applyReviewFilters = (reviews, filters = {}) =>
  sortAdminReviews(filterAdminReviews(reviews, filters), filters.sort);

/** Оценка из адреса: только целое 1–5, записанное цифрой ('3'); иначе null */
const parseRating = (value) => (/^[1-5]$/.test(String(value ?? '')) ? Number(value) : null);

/**
 * Параметры адреса (?status=&q=&rating=&sort=) → фильтры.
 * Неизвестные значения заменяются значениями по умолчанию — ссылка с ошибкой не ломает список.
 */
export function parseReviewListParams(params) {
  const get = (key) => (typeof params?.get === 'function' ? params.get(key) : null);
  const pick = (key, list) => {
    const v = get(key);
    return list.includes(v) ? v : DEFAULT_REVIEW_FILTERS[key];
  };
  return {
    status: pick('status', REVIEW_FILTER_STATUSES),
    q: get('q') || '',
    rating: parseRating(get('rating')),
    sort: pick('sort', REVIEW_SORTS),
  };
}

/**
 * Фильтры → параметры адреса (значения по умолчанию не пишутся).
 * Поиск сохраняется как введён (иначе пробел между словами пропадал бы при вводе);
 * запрос из одних пробелов в адрес не пишется. Неверные значения тоже не пишутся.
 */
export function toReviewListParams(filters = {}) {
  const params = new URLSearchParams();
  const { status, q, rating, sort } = filters;
  if (REVIEW_FILTER_STATUSES.includes(status) && status !== DEFAULT_REVIEW_FILTERS.status) params.set('status', status);
  if (String(q ?? '').trim()) params.set('q', q);
  if (REVIEW_RATINGS.includes(rating)) params.set('rating', String(rating));
  if (REVIEW_SORTS.includes(sort) && sort !== DEFAULT_REVIEW_FILTERS.sort) params.set('sort', sort);
  return params;
}

/** Активны ли поиск или фильтр оценки — для кнопки «Сбросить» (статус и сортировка не считаются) */
export const hasActiveReviewFilters = (filters = {}) =>
  String(filters.q ?? '').trim() !== '' || REVIEW_RATINGS.includes(filters.rating);

// ---------- Действия модерации и окно удаления (этап E4) ----------

// Действие кнопки → новый статус отзыва
export const REVIEW_ACTION_STATUS = {
  approve: REVIEW_STATUS.approved,
  reject: REVIEW_STATUS.rejected,
  pending: REVIEW_STATUS.pending,
};

/**
 * Какие кнопки показать для отзыва: только переходы в другой статус.
 * Удалить навсегда можно только отклонённый отзыв (так же требует правило delete в firestore.rules).
 */
export function reviewActions(status) {
  switch (status) {
    case REVIEW_STATUS.pending:
      return ['approve', 'reject'];
    case REVIEW_STATUS.approved:
      return ['reject', 'pending'];
    case REVIEW_STATUS.rejected:
      return ['approve', 'pending', 'delete'];
    default:
      return [];
  }
}

/** После каких ошибок список нужно перечитать: отзыв изменили или удалили в другом окне */
export const shouldReloadAfterError = (code) => ['conflict', 'not-found', 'not-rejected'].includes(code);

// Длинный отзыв сворачивается до 4 строк (см. .admin-review__text.is-collapsed в admin.css)
export const LONG_REVIEW_CHARS = 280;
export const LONG_REVIEW_LINES = 4;

/** Нужна ли кнопка «Показать полностью» */
export function isLongReview(text) {
  const s = String(text ?? '');
  return s.length > LONG_REVIEW_CHARS || s.split('\n').length > LONG_REVIEW_LINES;
}

/**
 * Строка списка после успешной смены статуса — сразу, до повторной загрузки.
 * Возвращает новый объект данных; исходный не меняется. Нет такого отзыва — данные без изменений.
 */
export function applyReviewStatus(data, id, status, moderatedAt) {
  if (!data?.reviews?.some((r) => r.id === id)) return data;
  return {
    ...data,
    reviews: data.reviews.map((r) => (r.id === id ? { ...r, status, moderatedAt: moderatedAt ?? r.moderatedAt } : r)),
  };
}

/** Убрать удалённый отзыв из списка (и из повреждённых, если он был там) */
export function removeReview(data, id) {
  if (!data) return data;
  return {
    ...data,
    reviews: asList(data.reviews).filter((r) => r.id !== id),
    invalidIds: asList(data.invalidIds).filter((x) => x !== id),
  };
}

export const REVIEW_BACKUP_FORMAT = 'aroma-donna-review-backup';

/**
 * JSON-копия отзыва перед окончательным удалением: все поля документа (даты — ISO-строками).
 * По ней отзыв можно восстановить вручную в Firebase Console.
 */
export function buildReviewBackup(review, exportedAt = new Date()) {
  const { id = null, ...document } = review ?? {};
  return {
    format: REVIEW_BACKUP_FORMAT,
    version: 1,
    collection: 'reviews',
    id,
    exportedAt: exportedAt.toISOString(),
    document: structuredClone(document),
  };
}

/** Имя файла копии: review-<id>-<ГГГГ-ММ-ДД>.json */
export const reviewBackupFileName = (id, date = new Date()) => `review-${id}-${date.toISOString().slice(0, 10)}.json`;
