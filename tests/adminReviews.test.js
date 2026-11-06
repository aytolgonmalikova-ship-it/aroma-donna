// Тесты списка отзывов в админ-панели (этап E2): счётчики по статусам, фильтры, поиск,
// сортировка по дате и параметры адреса. Запуск: npm test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toAdminReview } from '../src/services/adminReviewsStore.js';
import {
  DEFAULT_REVIEW_FILTERS,
  REVIEW_FILTER_STATUSES,
  REVIEW_RATINGS,
  REVIEW_SORTS,
  applyReviewFilters,
  countReviewsByStatus,
  filterAdminReviews,
  hasActiveReviewFilters,
  matchesReviewQuery,
  parseReviewListParams,
  sortAdminReviews,
  toReviewListParams,
} from '../src/utils/adminReviews.js';

// Отзывы в формате toAdminReview (adminReviewsStore.js)
const r = (id, status, extra = {}) => ({
  id,
  name: 'Айгерим',
  text: 'Очень стойкий аромат, держится весь день.',
  rating: 5,
  status,
  lang: 'ru',
  createdAt: '2026-11-01T10:00:00.000Z',
  moderatedAt: null,
  ...extra,
});

const REVIEWS = [
  r('p1', 'pending', { name: 'Айгерим', text: 'Роза и пион — нежно, но стойко.', rating: 5, createdAt: '2026-11-03T10:00:00.000Z' }),
  r('p2', 'pending', { name: 'Bakyt', text: 'Слишком сладкий для меня.', rating: 2, createdAt: '2026-11-02T09:00:00.000Z' }),
  r('a1', 'approved', { name: 'Нурлан', text: 'Отличный подарок жене, ей понравилось.', rating: 4, createdAt: '2026-10-30T12:00:00.000Z' }),
  r('a2', 'approved', { name: 'Elena', text: 'Шлейф как у ROSE POUDRÉE в бутике.', rating: 5, createdAt: '2026-11-01T08:00:00.000Z' }),
  r('x1', 'rejected', { name: 'Спам', text: 'Купите дешёвые часы по ссылке!!!', rating: 1, createdAt: null }),
];

const ids = (list) => list.map((x) => x.id);
const params = (query) => new URLSearchParams(query);
const frozen = () => {
  const list = structuredClone(REVIEWS);
  list.forEach(Object.freeze);
  return Object.freeze(list);
};

// ---------- Подсчёт ----------

test('countReviewsByStatus: всего и по каждому статусу', () => {
  assert.deepEqual(countReviewsByStatus(REVIEWS), { all: 5, pending: 2, approved: 2, rejected: 1 });
  assert.deepEqual(Object.keys(countReviewsByStatus([])), REVIEW_FILTER_STATUSES);
  assert.deepEqual(countReviewsByStatus([]), { all: 0, pending: 0, approved: 0, rejected: 0 });
});

test('countReviewsByStatus: неизвестный или отсутствующий статус — только в all; не массив — нули', () => {
  const odd = [r('u1', 'published'), r('u2', undefined), r('u3', 'all'), r('u4', 'toString'), null, r('ok', 'approved')];
  assert.deepEqual(countReviewsByStatus(odd), { all: 6, pending: 0, approved: 1, rejected: 0 });
  for (const bad of [null, undefined, 'отзывы', {}]) {
    assert.deepEqual(countReviewsByStatus(bad), { all: 0, pending: 0, approved: 0, rejected: 0 });
  }
});

// ---------- Фильтр по статусу ----------

test('filterAdminReviews: фильтр по статусу', () => {
  assert.deepEqual(ids(filterAdminReviews(REVIEWS, { status: 'pending' })), ['p1', 'p2']);
  assert.deepEqual(ids(filterAdminReviews(REVIEWS, { status: 'approved' })), ['a1', 'a2']);
  assert.deepEqual(ids(filterAdminReviews(REVIEWS, { status: 'rejected' })), ['x1']);
  assert.deepEqual(ids(filterAdminReviews(REVIEWS, { status: 'all' })), ids(REVIEWS));
  // Без фильтров — все отзывы; неизвестный статус ничего не находит
  assert.deepEqual(ids(filterAdminReviews(REVIEWS)), ids(REVIEWS));
  assert.deepEqual(filterAdminReviews(REVIEWS, { status: 'published' }), []);
});

// ---------- Поиск ----------

test('поиск по имени', () => {
  assert.deepEqual(ids(filterAdminReviews(REVIEWS, { q: 'Нурлан' })), ['a1']);
  assert.deepEqual(ids(filterAdminReviews(REVIEWS, { q: 'bak' })), ['p2'], 'часть имени');
});

test('поиск по тексту', () => {
  assert.deepEqual(ids(filterAdminReviews(REVIEWS, { q: 'подарок' })), ['a1']);
  assert.deepEqual(ids(filterAdminReviews(REVIEWS, { q: 'стойк' })), ['p1']);
  assert.deepEqual(filterAdminReviews(REVIEWS, { q: 'ваниль' }), []);
});

test('поиск без учёта регистра и пробелов по краям (кириллица и латиница)', () => {
  assert.deepEqual(ids(filterAdminReviews(REVIEWS, { q: 'АЙГЕРИМ' })), ['p1']);
  assert.deepEqual(ids(filterAdminReviews(REVIEWS, { q: 'elena' })), ['a2']);
  assert.deepEqual(ids(filterAdminReviews(REVIEWS, { q: 'rose poudrée' })), ['a2']);
  assert.deepEqual(ids(filterAdminReviews(REVIEWS, { q: '  РОЗА И ПИОН  ' })), ['p1']);
});

test('поиск: пустой запрос подходит всем; отсутствующие имя и текст не ломают поиск', () => {
  for (const q of ['', '   ', null, undefined]) assert.equal(filterAdminReviews(REVIEWS, { q }).length, 5);
  assert.equal(matchesReviewQuery({ id: 'x' }, 'роза'), false);
  assert.equal(matchesReviewQuery({ id: 'x', name: null, text: undefined }, ''), true);
  assert.equal(matchesReviewQuery(null, 'роза'), false);
});

test('поиск вместе со статусом', () => {
  assert.deepEqual(ids(filterAdminReviews(REVIEWS, { status: 'pending', q: 'сладкий' })), ['p2']);
  assert.deepEqual(filterAdminReviews(REVIEWS, { status: 'approved', q: 'сладкий' }), []);
});

// ---------- Оценка ----------

test('фильтр по оценке 1–5', () => {
  assert.deepEqual(ids(filterAdminReviews(REVIEWS, { rating: 5 })), ['p1', 'a2']);
  assert.deepEqual(ids(filterAdminReviews(REVIEWS, { rating: 4 })), ['a1']);
  assert.deepEqual(filterAdminReviews(REVIEWS, { rating: 3 }), []);
  assert.deepEqual(ids(filterAdminReviews(REVIEWS, { rating: 2 })), ['p2']);
  assert.deepEqual(ids(filterAdminReviews(REVIEWS, { rating: 1 })), ['x1']);
  // null или отсутствие — любая оценка
  assert.equal(filterAdminReviews(REVIEWS, { rating: null }).length, 5);
  // Оценка сравнивается строго: строка '5' не совпадает с числом (из адреса приходит уже число)
  assert.deepEqual(filterAdminReviews(REVIEWS, { rating: '5' }), []);
  // Все три фильтра вместе
  assert.deepEqual(ids(filterAdminReviews(REVIEWS, { status: 'approved', q: 'шлейф', rating: 5 })), ['a2']);
  assert.deepEqual(REVIEW_RATINGS, [5, 4, 3, 2, 1]);
});

// ---------- Сортировка ----------

test('сортировка по дате: сначала новые и сначала старые', () => {
  assert.deepEqual(ids(sortAdminReviews(REVIEWS, 'newest')), ['p1', 'p2', 'a2', 'a1', 'x1']);
  assert.deepEqual(ids(sortAdminReviews(REVIEWS, 'oldest')), ['a1', 'a2', 'p2', 'p1', 'x1']);
  // По умолчанию и при неизвестном значении — сначала новые
  assert.deepEqual(ids(sortAdminReviews(REVIEWS)), ids(sortAdminReviews(REVIEWS, 'newest')));
  assert.deepEqual(ids(sortAdminReviews(REVIEWS, 'rating')), ids(sortAdminReviews(REVIEWS, 'newest')));
  assert.deepEqual(REVIEW_SORTS, ['newest', 'oldest']);
});

test('сортировка: отзывы без даты или с неверной датой — в конце при любом порядке, по id', () => {
  const list = [
    r('c', 'pending', { createdAt: null }),
    r('b', 'pending', { createdAt: '2026-11-02T00:00:00.000Z' }),
    r('a', 'pending', { createdAt: 'не дата' }),
    { id: 'd', status: 'pending' },
    r('e', 'pending', { createdAt: '2026-11-01T00:00:00.000Z' }),
  ];
  assert.deepEqual(ids(sortAdminReviews(list, 'newest')), ['b', 'e', 'a', 'c', 'd']);
  assert.deepEqual(ids(sortAdminReviews(list, 'oldest')), ['e', 'b', 'a', 'c', 'd']);
  // Одинаковая дата — порядок по id, не зависит от исходного
  const same = [r('z', 'pending'), r('m', 'pending'), r('a', 'pending')];
  assert.deepEqual(ids(sortAdminReviews(same, 'newest')), ['a', 'm', 'z']);
  assert.deepEqual(ids(sortAdminReviews([...same].reverse(), 'oldest')), ['a', 'm', 'z']);
  // Не массив — пустой список
  assert.deepEqual(sortAdminReviews(null), []);
});

test('отзыв из хранилища без даты (toAdminReview → createdAt: null) обрабатывается безопасно', () => {
  const noDate = toAdminReview('n1', { name: 'Гость', text: 'Без даты создания.', rating: 3, status: 'pending' });
  assert.equal(noDate.createdAt, null);
  const list = [noDate, ...REVIEWS];
  assert.equal(ids(applyReviewFilters(list, { status: 'pending', sort: 'newest' })).at(-1), 'n1');
  assert.equal(ids(applyReviewFilters(list, { status: 'pending', sort: 'oldest' })).at(-1), 'n1');
  assert.deepEqual(countReviewsByStatus(list), { all: 6, pending: 3, approved: 2, rejected: 1 });
});

test('applyReviewFilters: фильтры, затем сортировка', () => {
  assert.deepEqual(ids(applyReviewFilters(REVIEWS, { status: 'all', rating: 5, sort: 'oldest' })), ['a2', 'p1']);
  assert.deepEqual(ids(applyReviewFilters(REVIEWS, DEFAULT_REVIEW_FILTERS)), ['p1', 'p2']);
});

// ---------- Параметры адреса ----------

test('parseReviewListParams: корректные параметры', () => {
  assert.deepEqual(parseReviewListParams(params('status=approved&q=роза&rating=4&sort=oldest')), {
    status: 'approved',
    q: 'роза',
    rating: 4,
    sort: 'oldest',
  });
  for (const status of REVIEW_FILTER_STATUSES) assert.equal(parseReviewListParams(params(`status=${status}`)).status, status);
  for (const rating of [1, 2, 3, 4, 5]) assert.equal(parseReviewListParams(params(`rating=${rating}`)).rating, rating);
  // Поиск сохраняется как введён (пробелы между словами)
  assert.equal(parseReviewListParams(params('q=роза%20и%20')).q, 'роза и ');
});

test('parseReviewListParams: без параметров — значения по умолчанию (ожидающие, новые сверху)', () => {
  assert.deepEqual(parseReviewListParams(params('')), DEFAULT_REVIEW_FILTERS);
  assert.deepEqual(DEFAULT_REVIEW_FILTERS, { status: 'pending', q: '', rating: null, sort: 'newest' });
});

test('parseReviewListParams: некорректные параметры заменяются значениями по умолчанию', () => {
  const cases = [
    'status=published',
    'status=PENDING',
    'status=',
    'rating=0',
    'rating=6',
    'rating=4.5',
    'rating=-1',
    'rating=abc',
    'rating=05',
    'rating=%204',
    'rating=',
    'sort=rating',
    'sort=NEWEST',
    'sort=',
    'q=',
  ];
  for (const query of cases) assert.deepEqual(parseReviewListParams(params(query)), DEFAULT_REVIEW_FILTERS, query);
  // Одна ошибка не сбрасывает остальные параметры
  assert.deepEqual(parseReviewListParams(params('status=approved&rating=9&sort=oldest&q=роза')), {
    status: 'approved',
    q: 'роза',
    rating: null,
    sort: 'oldest',
  });
  // Не URLSearchParams — значения по умолчанию
  for (const bad of [null, undefined, {}, 'status=approved']) assert.deepEqual(parseReviewListParams(bad), DEFAULT_REVIEW_FILTERS);
});

test('toReviewListParams: значения по умолчанию и неверные значения в адрес не пишутся', () => {
  assert.equal(toReviewListParams(DEFAULT_REVIEW_FILTERS).toString(), '');
  assert.equal(toReviewListParams().toString(), '');
  assert.equal(toReviewListParams({ status: 'published', q: '   ', rating: 7, sort: 'rating' }).toString(), '');
  assert.equal(toReviewListParams({ rating: '5' }).toString(), '', 'оценка — только число 1–5');
  // «Все» — не значение по умолчанию, поэтому пишется явно
  assert.equal(toReviewListParams({ status: 'all' }).toString(), 'status=all');
  assert.equal(
    toReviewListParams({ status: 'rejected', q: 'роза и ', rating: 1, sort: 'oldest' }).get('q'),
    'роза и ',
    'поиск сохраняется как введён',
  );
});

test('параметры адреса: туда и обратно без потерь', () => {
  const variants = [
    DEFAULT_REVIEW_FILTERS,
    { status: 'all', q: '', rating: null, sort: 'newest' },
    { status: 'approved', q: 'Роза пион', rating: 5, sort: 'oldest' },
    { status: 'rejected', q: '', rating: 1, sort: 'newest' },
    { status: 'pending', q: 'a&b=c?#', rating: 3, sort: 'oldest' },
  ];
  for (const filters of variants) {
    const back = parseReviewListParams(params(toReviewListParams(filters).toString()));
    assert.deepEqual(back, filters, JSON.stringify(filters));
  }
});

test('hasActiveReviewFilters: поиск или оценка (статус и сортировка не считаются)', () => {
  assert.equal(hasActiveReviewFilters(DEFAULT_REVIEW_FILTERS), false);
  assert.equal(hasActiveReviewFilters({ status: 'all', sort: 'oldest' }), false);
  assert.equal(hasActiveReviewFilters({ q: '  ' }), false);
  assert.equal(hasActiveReviewFilters({ q: 'роза' }), true);
  assert.equal(hasActiveReviewFilters({ rating: 3 }), true);
  assert.equal(hasActiveReviewFilters(), false);
});

// ---------- Исходный массив ----------

test('исходный массив и отзывы не изменяются (замороженные данные, новые массивы)', () => {
  const list = frozen();
  const before = structuredClone(list);
  const results = [
    filterAdminReviews(list, { status: 'approved', q: 'роза', rating: 5 }),
    filterAdminReviews(list),
    sortAdminReviews(list, 'newest'),
    sortAdminReviews(list, 'oldest'),
    applyReviewFilters(list, { status: 'all', sort: 'oldest' }),
  ];
  countReviewsByStatus(list);
  assert.deepEqual(list, before);
  assert.deepEqual(ids(list), ids(REVIEWS), 'порядок исходного массива прежний');
  for (const res of results) assert.notEqual(res, list, 'возвращается новый массив');
  // Элементы — те же объекты (не копии и не изменённые)
  assert.equal(sortAdminReviews(list, 'oldest')[0], list.find((x) => x.id === 'a1'));
});
