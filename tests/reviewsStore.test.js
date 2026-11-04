// Тесты модерации отзывов (этап C): новый отзыв — 'pending', публично видны и учитываются
// в рейтинге только 'approved'; форма не добавляет отзыв в список сразу. Запуск: npm test.
// Firestore заменён моделью в памяти — как в tests/adminProductsStore.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { averageRating, createReview, fetchApprovedReviews, fetchApprovedStats, REVIEW_STATUS } from '../src/services/reviewsStore.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const SERVER_TIMESTAMP = Symbol('serverTimestamp');
const ts = (iso) => ({ iso, toDate: () => new Date(iso) });

// Два настоящих отзыва после этапа B: те же id и даты, что в базе (имя и текст — заглушки)
const LEGACY_APPROVED = {
  G358K9IFgnj1kOLCek0l: { name: 'Покупатель', rating: 5, text: 'Текст первого отзыва.', lang: 'ru', status: 'approved', createdAt: ts('2026-11-01T07:08:12.982Z') },
  f84rIw02P3seISp4zw2L: { name: 'Покупатель', rating: 5, text: 'Текст второго отзыва.', lang: 'ru', status: 'approved', createdAt: ts('2026-11-01T05:29:24.857Z') },
};
const OTHERS = {
  pending1: { name: 'Гость', rating: 1, text: 'Ждёт модерации, оценка 1.', lang: 'ru', status: 'pending', createdAt: ts('2026-11-04T10:00:00.000Z') },
  rejected1: { name: 'Спам', rating: 1, text: 'Отклонённый отзыв, оценка 1.', lang: 'en', status: 'rejected', createdAt: ts('2026-11-04T11:00:00.000Z') },
  // Документ без status (до миграции) публично не показывается — как и в Firestore
  noStatus: { name: 'Старый', rating: 2, text: 'Документ без поля status.', lang: 'ru', createdAt: ts('2026-11-02T09:00:00.000Z') },
  approved3: { name: 'Айгерим', rating: 3, text: 'Одобренный отзыв с оценкой 3.', lang: 'ky', status: 'approved', createdAt: ts('2026-11-03T12:00:00.000Z') },
};

/** Модель Firestore: where ==, orderBy, startAfter, limit, getDocs, getAggregateFromServer, addDoc */
function fakeFirebase(seed = {}, { ratingIndex = true } = {}) {
  // Копия документов: исходные данные тестов не меняются (Timestamp пересоздаётся — в нём функция)
  const docs = new Map(Object.entries(seed).map(([id, d]) => [id, { ...d, createdAt: d.createdAt && ts(d.createdAt.iso) }]));
  const log = { queries: [], aggregates: [], added: [] };
  let nextId = 1;
  const snapshot = (id) => ({ id, data: () => ({ ...docs.get(id) }) });
  const run = (q) => {
    let ids = [...docs.keys()].filter((id) => q.filters.every((f) => docs.get(id)[f.field] === f.value));
    if (q.order) {
      const dir = q.order.dir === 'desc' ? -1 : 1;
      ids.sort((a, b) => dir * docs.get(a)[q.order.field].iso.localeCompare(docs.get(b)[q.order.field].iso));
    }
    if (q.after) ids = ids.slice(ids.indexOf(q.after.id) + 1);
    if (q.max != null) ids = ids.slice(0, q.max);
    return ids;
  };
  const dbApi = {
    collection: (db, name) => ({ name, filters: [], order: null, after: null, max: null }),
    where: (field, op, value) => ({ kind: 'where', field, op, value }),
    orderBy: (field, dir = 'asc') => ({ kind: 'orderBy', field, dir }),
    startAfter: (doc) => ({ kind: 'startAfter', doc }),
    limit: (n) => ({ kind: 'limit', n }),
    query(col, ...parts) {
      const q = { ...col, filters: [...col.filters] };
      for (const p of parts) {
        if (p.kind === 'where') {
          assert.equal(p.op, '==');
          q.filters.push(p);
        } else if (p.kind === 'orderBy') q.order = p;
        else if (p.kind === 'startAfter') q.after = p.doc;
        else if (p.kind === 'limit') q.max = p.n;
      }
      return q;
    },
    async getDocs(q) {
      assert.equal(q.name, 'reviews');
      log.queries.push(q);
      return { docs: run(q).map(snapshot) };
    },
    count: () => ({ kind: 'count' }),
    average: (field) => ({ kind: 'average', field }),
    async getAggregateFromServer(q, spec) {
      log.aggregates.push({ q, spec });
      // Как в Firestore: average по rating с фильтром по status требует индекса (status, rating)
      if (!ratingIndex && q.filters.length && Object.values(spec).some((s) => s.kind === 'average')) {
        throw Object.assign(new Error('The query requires an index.'), { code: 'failed-precondition' });
      }
      const ratings = run(q).map((id) => docs.get(id).rating);
      return { data: () => ({ count: ratings.length, average: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null }) };
    },
    serverTimestamp: () => SERVER_TIMESTAMP,
    async addDoc(col, data) {
      assert.equal(col.name, 'reviews');
      const id = `new${nextId++}`;
      log.added.push({ id, data });
      docs.set(id, { ...data, createdAt: ts('2026-11-05T00:00:00.000Z') });
      return { id };
    },
  };
  // auth нет специально: отзыв должен работать без входа
  return { db: {}, dbApi, docs, log };
}

const ALL = { ...LEGACY_APPROVED, ...OTHERS };
const ids = (page) => page.reviews.map((r) => r.id);

// ---------- 1, 9. Новый отзыв ----------

test('createReview: новый отзыв сохраняется со статусом pending и ровно нужными полями', async () => {
  const fb = fakeFirebase();
  const saved = await createReview(fb, { name: '  Гость  ', rating: 4, text: '  Хороший аромат, советую.  ' }, 'ky');
  assert.deepEqual(saved, { id: 'new1', status: 'pending' });
  assert.equal(fb.log.added.length, 1);
  assert.deepEqual(fb.log.added[0].data, {
    name: 'Гость',
    rating: 4,
    text: 'Хороший аромат, советую.',
    lang: 'ky',
    status: REVIEW_STATUS.pending,
    createdAt: SERVER_TIMESTAMP,
  });
});

test('createReview: работает для гостя — без uid, auth и других полей пользователя', async () => {
  const fb = fakeFirebase(); // в модели нет auth: обращение к нему упало бы
  await createReview(fb, { name: 'Гость', rating: 5, text: 'Отзыв без регистрации.' }, 'ru');
  const keys = Object.keys(fb.log.added[0].data);
  assert.deepEqual(keys.sort(), ['createdAt', 'lang', 'name', 'rating', 'status', 'text']);
  const store = read('src/services/reviewsStore.js');
  assert.doesNotMatch(store, /auth|uid|currentUser/);
});

test('createReview: поля нового отзыва разрешены правилом isValidReview, status — pending', () => {
  const rules = read('firestore.rules');
  const block = rules.slice(rules.indexOf('function isValidReview'), rules.indexOf('// Товары каталога'));
  const allowed = [...block.slice(block.indexOf('hasOnly(['), block.indexOf(']')).matchAll(/'([^']+)'/g)].map((m) => m[1]);
  for (const key of ['name', 'rating', 'text', 'lang', 'status', 'createdAt']) assert.ok(allowed.includes(key), key);
  assert.match(block, /review\.status == 'pending'/);
});

// ---------- 2, 3, 8. Публичная выборка ----------

test('fetchApprovedReviews: только approved, новые сверху; запрос — where(status == approved) + orderBy(createdAt desc)', async () => {
  const fb = fakeFirebase(ALL);
  const page = await fetchApprovedReviews(fb, { pageSize: 9 });
  assert.deepEqual(ids(page), ['approved3', 'G358K9IFgnj1kOLCek0l', 'f84rIw02P3seISp4zw2L']);
  const [q] = fb.log.queries;
  assert.deepEqual(q.filters.map(({ field, op, value }) => [field, op, value]), [['status', '==', 'approved']]);
  // Тот же порядок полей, что в составном индексе firestore.indexes.json
  assert.deepEqual([q.order.field, q.order.dir], ['createdAt', 'desc']);
  const index = JSON.parse(read('firestore.indexes.json')).indexes.find(
    (i) => i.collectionGroup === 'reviews' && i.fields.some((f) => f.fieldPath === 'createdAt'),
  );
  assert.deepEqual(index.fields, [{ fieldPath: 'status', order: 'ASCENDING' }, { fieldPath: 'createdAt', order: 'DESCENDING' }]);
});

test('fetchApprovedReviews: pending, rejected и документы без status публично не возвращаются', async () => {
  const fb = fakeFirebase(ALL);
  const shown = ids(await fetchApprovedReviews(fb, { pageSize: 50 }));
  for (const hidden of ['pending1', 'rejected1', 'noStatus']) assert.ok(!shown.includes(hidden), hidden);
  // Только pending и rejected — пустой список
  const onlyHidden = fakeFirebase({ pending1: OTHERS.pending1, rejected1: OTHERS.rejected1 });
  assert.deepEqual(ids(await fetchApprovedReviews(onlyHidden, { pageSize: 9 })), []);
});

test('fetchApprovedReviews: два существующих одобренных отзыва отображаются с данными и датой', async () => {
  const fb = fakeFirebase(LEGACY_APPROVED);
  const page = await fetchApprovedReviews(fb, { pageSize: 9 });
  assert.deepEqual(page.reviews, [
    { id: 'G358K9IFgnj1kOLCek0l', name: 'Покупатель', rating: 5, text: 'Текст первого отзыва.', createdAt: '2026-11-01T07:08:12.982Z' },
    { id: 'f84rIw02P3seISp4zw2L', name: 'Покупатель', rating: 5, text: 'Текст второго отзыва.', createdAt: '2026-11-01T05:29:24.857Z' },
  ]);
  assert.equal(page.hasMore, false);
  // Блок на главной: 3 последних — те же два
  assert.deepEqual(ids(await fetchApprovedReviews(fb, { pageSize: 3 })), Object.keys(LEGACY_APPROVED));
});

test('fetchApprovedReviews: «Показать ещё» — курсор продолжает выборку только по approved', async () => {
  const fb = fakeFirebase(ALL);
  const first = await fetchApprovedReviews(fb, { pageSize: 2 });
  assert.deepEqual(ids(first), ['approved3', 'G358K9IFgnj1kOLCek0l']);
  assert.equal(first.hasMore, true);
  const second = await fetchApprovedReviews(fb, { cursor: first.cursor, pageSize: 2 });
  assert.deepEqual(ids(second), ['f84rIw02P3seISp4zw2L']);
  assert.equal(second.hasMore, false);
  assert.ok(fb.log.queries.every((q) => q.filters.length === 1 && q.filters[0].value === 'approved'));
});

// ---------- 4, 5. Статистика ----------

test('fetchApprovedStats: число и средняя оценка — только по approved (pending, rejected, без status не влияют)', async () => {
  const fb = fakeFirebase(ALL);
  // approved: 5, 5, 3 → 13/3; pending 1, rejected 1 и без status 2 не учитываются
  assert.deepEqual(await fetchApprovedStats(fb), { count: 3, average: 13 / 3 });
  const [{ q, spec }] = fb.log.aggregates;
  assert.deepEqual(q.filters.map((f) => [f.field, f.value]), [['status', 'approved']]);
  assert.deepEqual(Object.values(spec).map((s) => s.kind).sort(), ['average', 'count']);
});

test('fetchApprovedStats: два существующих отзыва — 2 отзыва, 5.0; без одобренных — 0 и null', async () => {
  assert.deepEqual(await fetchApprovedStats(fakeFirebase({ ...LEGACY_APPROVED, pending1: OTHERS.pending1 })), { count: 2, average: 5 });
  assert.deepEqual(await fetchApprovedStats(fakeFirebase({ pending1: OTHERS.pending1, rejected1: OTHERS.rejected1 })), { count: 0, average: null });
});

test('fetchApprovedStats: нет индекса (status, rating) — тот же результат по approved, посчитанный в браузере', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const fb = fakeFirebase(ALL, { ratingIndex: false });
  assert.deepEqual(await fetchApprovedStats(fb), { count: 3, average: 13 / 3 });
  // Резервный путь читает тоже только approved
  assert.deepEqual(fb.log.queries.at(-1).filters.map((f) => [f.field, f.value]), [['status', 'approved']]);
  assert.deepEqual(await fetchApprovedStats(fakeFirebase({ pending1: OTHERS.pending1 }, { ratingIndex: false })), { count: 0, average: null });
  assert.equal(console.warn.mock.callCount(), 2);
});

test('fetchApprovedStats: другие ошибки Firestore не маскируются резервным расчётом', async () => {
  const fb = fakeFirebase(ALL);
  fb.dbApi.getAggregateFromServer = async () => {
    throw Object.assign(new Error('denied'), { code: 'permission-denied' });
  };
  await assert.rejects(fetchApprovedStats(fb), { code: 'permission-denied' });
  assert.equal(fb.log.queries.length, 0);
});

test('averageRating: среднее; пустой список — null', () => {
  assert.equal(averageRating([5, 5, 3]), 13 / 3);
  assert.equal(averageRating([]), null);
});

test('после отправки pending-отзыва публичный список и рейтинг не меняются', async () => {
  const fb = fakeFirebase(LEGACY_APPROVED);
  const before = { page: await fetchApprovedReviews(fb, { pageSize: 9 }), stats: await fetchApprovedStats(fb) };
  await createReview(fb, { name: 'Гость', rating: 1, text: 'Новый отзыв с оценкой 1.' }, 'ru');
  assert.equal(fb.docs.size, 3);
  assert.deepEqual(ids(await fetchApprovedReviews(fb, { pageSize: 9 })), ids(before.page));
  assert.deepEqual(await fetchApprovedStats(fb), before.stats);
});

// ---------- 6, 7, 9. Форма и страница ----------

test('форма: после отправки — сообщение о модерации на трёх языках, а не «опубликован»', () => {
  const form = read('src/components/reviews/ReviewForm.jsx');
  assert.match(form, /t\('reviews\.thanks'\)/);
  assert.match(form, /message: 'reviews\.sentToast'/);
  const expected = {
    ru: 'Спасибо! Ваш отзыв отправлен на модерацию и появится после одобрения.',
    ky: 'Рахмат! Пикириңиз модерацияга жөнөтүлдү жана жактырылгандан кийин жарыяланат.',
    en: 'Thank you! Your review has been sent for moderation and will appear once approved.',
  };
  for (const [lang, thanks] of Object.entries(expected)) {
    const { reviews } = JSON.parse(read(`src/locales/${lang}/translation.json`));
    assert.equal(reviews.thanks, thanks, lang);
    for (const key of ['sentToast', 'submit', 'sending', 'publicNote']) {
      assert.ok(reviews[key], `${lang}: ${key}`);
      assert.doesNotMatch(reviews[key], /опубликован|жарыяланды|published|Publish/, `${lang}: ${key}`);
    }
  }
});

test('форма: новый отзыв не добавляется в публичный список и не меняет рейтинг', () => {
  const form = read('src/components/reviews/ReviewForm.jsx');
  const page = read('src/pages/ReviewsPage.jsx');
  const hook = read('src/hooks/useReviews.js');
  assert.doesNotMatch(form, /onCreated/);
  assert.match(page, /<ReviewForm \/>/);
  assert.doesNotMatch(page + hook, /addLocal/);
  // Хук меняет список только данными из Firestore (первая страница и «Показать ещё»)
  assert.equal(hook.match(/setReviews\(/g).length, 2);
  assert.equal(hook.match(/setStats\(/g).length, 1);
});

test('форма: остаётся гостевой, проверки и защита от повторной отправки на месте', () => {
  const form = read('src/components/reviews/ReviewForm.jsx');
  const service = read('src/services/reviewsService.js');
  // Нет требования входа
  assert.doesNotMatch(form, /useSelector|selectUser|auth|login/i);
  // Проверка полей перед отправкой и повторный клик во время отправки
  assert.match(form, /const found = validateReview\(values\);/);
  assert.match(form, /if \(status === 'sending'\) return;/);
  assert.match(form, /disabled=\{sending\}/);
  // Ограничение частоты и понятные ошибки Firestore — в сервисе
  assert.match(service, /throw new ReviewsError\('cooldown'\)/);
  assert.match(service, /'permission-denied'\) return new ReviewsError\('permission'/);
  assert.match(service, /createReview\(await getFirebase\(\)/);
});

test('все места: fetchReviews и fetchReviewStats идут через выборку только approved', () => {
  const service = read('src/services/reviewsService.js');
  assert.match(service, /fetchApprovedReviews\(await getFirebase\(\), \{ cursor, pageSize \}\)/);
  assert.match(service, /fetchApprovedStats\(await getFirebase\(\)\)/);
  // В сервисе не осталось прямых запросов к Firestore в обход reviewsStore.js
  assert.doesNotMatch(service, /dbApi\./);
  // Пользователи: страница /reviews и блок на главной (через useReviews), карточка на дашборде
  assert.match(read('src/hooks/useReviews.js'), /fetchReviews\(\{ pageSize \}\)/);
  assert.match(read('src/components/home/ReviewsSection.jsx'), /useReviews\(\{ pageSize: 3, withStats: false \}\)/);
  assert.match(read('src/pages/admin/AdminDashboardPage.jsx'), /fetchReviewStats\(\)/);
});
