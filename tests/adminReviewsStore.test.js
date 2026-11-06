// Тесты хранилища модерации отзывов (этап E1): загрузка отзывов всех статусов, смена статуса
// и удаление отклонённых на модели Firestore в памяти (транзакции, serverTimestamp, ошибки).
// Запуск: npm test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AdminError } from '../src/services/adminErrors.js';
import { REVIEW_STATUS } from '../src/services/reviewsStore.js';
import {
  ADMIN_REVIEWS_LIMIT,
  deleteReview,
  fetchAllReviews,
  isReviewStatus,
  setReviewStatus,
  toAdminReview,
} from '../src/services/adminReviewsStore.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// ---------- Модель Firestore ----------

class FakeTimestamp {
  constructor(ms) {
    this.ms = ms;
  }
  toMillis() {
    return this.ms;
  }
  toDate() {
    return new Date(this.ms);
  }
}

const SERVER_TIMESTAMP = Symbol('serverTimestamp');
// Копия данных документа: обычные объекты копируются, Timestamp остаётся тем же объектом
const clone = (v) =>
  v && v.constructor === Object ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)])) : v;

/**
 * Коллекция reviews в памяти. failNext — ошибка (например { code: 'permission-denied' }),
 * которую выбросит следующая операция. Транзакция записывает данные, только если функция
 * завершилась без ошибки — как в Firestore. log.updates — данные каждого tx.update.
 */
function fakeFirebase(initial = {}) {
  const docs = new Map(Object.entries(initial).map(([id, data]) => [id, clone(data)]));
  const stats = { reads: 0, transactions: 0, writes: 0 };
  const log = { queries: [], updates: [] };
  let clock = Date.parse('2026-11-04T00:00:00Z');
  const fb = { docs, stats, log, failNext: null, failOrderBy: null };

  const maybeFail = () => {
    if (fb.failNext) {
      const err = Object.assign(new Error(fb.failNext.code), fb.failNext);
      fb.failNext = null;
      throw err;
    }
  };
  const snapshot = (id) => ({ id, exists: () => docs.has(id), data: () => clone(docs.get(id)) });

  fb.db = { name: 'fake-db' };
  fb.dbApi = {
    collection: (db, name) => {
      assert.equal(name, 'reviews');
      return { name, parts: [] };
    },
    orderBy: (field, dir) => ({ orderBy: field, dir }),
    limit: (n) => ({ limit: n }),
    query: (col, ...parts) => ({ ...col, parts: [...col.parts, ...parts] }),
    doc: (db, name, id) => {
      assert.equal(name, 'reviews');
      return { name, id };
    },
    serverTimestamp: () => SERVER_TIMESTAMP,
    async getDocs(q) {
      maybeFail();
      log.queries.push(q.parts);
      const order = q.parts.find((p) => p.orderBy);
      if (order && fb.failOrderBy) {
        const err = Object.assign(new Error(fb.failOrderBy), { code: fb.failOrderBy });
        fb.failOrderBy = null;
        throw err;
      }
      let ids = [...docs.keys()];
      if (order) {
        // Как в Firestore: документ без поля сортировки в выдачу не попадает
        assert.equal(order.dir, 'desc');
        ids = ids
          .filter((id) => docs.get(id)[order.orderBy] !== undefined)
          .sort((a, b) => (docs.get(b)[order.orderBy]?.ms ?? 0) - (docs.get(a)[order.orderBy]?.ms ?? 0));
      }
      const lim = q.parts.find((p) => p.limit);
      if (lim) ids = ids.slice(0, lim.limit);
      stats.reads += ids.length;
      return { empty: ids.length === 0, docs: ids.map(snapshot) };
    },
    async runTransaction(db, fn) {
      maybeFail();
      stats.transactions += 1;
      const writes = [];
      let wrote = false;
      const tx = {
        get: async (ref) => {
          // Как в Firestore: все чтения транзакции — до первой записи
          assert.equal(wrote, false, 'чтение после записи в транзакции');
          stats.reads += 1;
          return snapshot(ref.id);
        },
        update: (ref, data) => {
          wrote = true;
          writes.push(['update', ref.id, data]);
        },
        delete: (ref) => {
          wrote = true;
          writes.push(['delete', ref.id]);
        },
      };
      const result = await fn(tx); // ошибка внутри — ничего не записывается
      clock += 1000;
      writes.forEach(([kind, id, data]) => {
        stats.writes += 1;
        if (kind === 'delete') {
          docs.delete(id);
          return;
        }
        // update несуществующего документа в Firestore — ошибка not-found
        assert.ok(docs.has(id), `update несуществующего ${id}`);
        log.updates.push({ id, data });
        const patch = clone(data);
        Object.keys(patch).forEach((k) => {
          if (patch[k] === SERVER_TIMESTAMP) patch[k] = new FakeTimestamp(clock);
        });
        docs.set(id, { ...docs.get(id), ...patch });
      });
      return result;
    },
  };
  return fb;
}

const at = (iso) => new FakeTimestamp(Date.parse(iso));
const review = (status, extra = {}) => ({
  name: 'Айгерим',
  rating: 5,
  text: 'Очень стойкий аромат, держится весь день.',
  lang: 'ru',
  status,
  createdAt: at('2026-11-01T10:00:00Z'),
  ...extra,
});

/** Отзывы трёх статусов и два повреждённых документа */
const seed = () =>
  fakeFirebase({
    p1: review('pending', { createdAt: at('2026-11-03T10:00:00Z') }),
    a1: review('approved', { createdAt: at('2026-11-02T10:00:00Z'), moderatedAt: at('2026-11-02T12:00:00Z') }),
    r1: review('rejected', { createdAt: at('2026-11-01T10:00:00Z'), moderatedAt: at('2026-11-01T12:00:00Z') }),
    badRating: review('pending', { rating: 'пять', createdAt: at('2026-10-31T10:00:00Z') }),
    badStatus: review('published', { createdAt: at('2026-10-30T10:00:00Z') }),
  });

async function rejectsWith(promise, code) {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof AdminError, `ожидалась AdminError, получено ${err}`);
    assert.equal(err.code, code);
    return true;
  });
}

// ---------- fetchAllReviews ----------

test('fetchAllReviews: отзывы всех статусов, новые сверху, с датами модерации', async () => {
  const fb = seed();
  const { reviews, invalidIds, limited } = await fetchAllReviews(fb);
  assert.deepEqual(reviews.map((r) => [r.id, r.status]), [
    ['p1', 'pending'],
    ['a1', 'approved'],
    ['r1', 'rejected'],
  ]);
  assert.deepEqual(reviews[1], {
    id: 'a1',
    name: 'Айгерим',
    text: 'Очень стойкий аромат, держится весь день.',
    rating: 5,
    status: 'approved',
    lang: 'ru',
    createdAt: '2026-11-02T10:00:00.000Z',
    moderatedAt: '2026-11-02T12:00:00.000Z',
  });
  assert.equal(reviews[0].moderatedAt, null, 'ожидающий отзыв ещё не модерировали');
  assert.deepEqual(invalidIds, ['badRating', 'badStatus']);
  assert.equal(limited, false);
  // Один запрос без фильтра по статусу: сортировка по дате и ограничение количества
  assert.deepEqual(fb.log.queries, [[{ orderBy: 'createdAt', dir: 'desc' }, { limit: ADMIN_REVIEWS_LIMIT }]]);
  assert.equal(fb.stats.writes, 0);
});

test('fetchAllReviews: ограничение количества — limited, когда загружено ровно limit отзывов', async () => {
  const fb = seed();
  const res = await fetchAllReviews(fb, { limit: 2 });
  assert.deepEqual(res.reviews.map((r) => r.id), ['p1', 'a1']);
  assert.equal(res.limited, true);
  assert.equal(ADMIN_REVIEWS_LIMIT, 500);
});

test('fetchAllReviews: повреждённые документы не ломают список', async () => {
  const fb = fakeFirebase({
    ok: review('pending'),
    noName: review('pending', { name: 42 }),
    emptyName: review('pending', { name: '   ' }),
    noText: review('approved', { text: null }),
    floatRating: review('approved', { rating: 4.5 }),
    zeroRating: review('approved', { rating: 0 }),
    noStatus: (({ status: _omit, ...rest }) => rest)(review('pending')),
    badDates: review('rejected', { createdAt: 'вчера', moderatedAt: 123, lang: 7 }),
  });
  const { reviews, invalidIds } = await fetchAllReviews(fb);
  assert.deepEqual(reviews.map((r) => r.id).sort(), ['badDates', 'ok']);
  assert.deepEqual(invalidIds.sort(), ['emptyName', 'floatRating', 'noName', 'noStatus', 'noText', 'zeroRating']);
  // Неверные даты и язык не делают отзыв повреждённым — показываются пустыми
  const bad = reviews.find((r) => r.id === 'badDates');
  assert.equal(bad.createdAt, null);
  assert.equal(bad.moderatedAt, null);
  assert.equal(bad.lang, null);
});

test('fetchAllReviews: нет индекса (failed-precondition) — чтение без сортировки, сортировка в браузере', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const fb = seed();
  fb.failOrderBy = 'failed-precondition';
  const { reviews, invalidIds } = await fetchAllReviews(fb);
  assert.deepEqual(reviews.map((r) => r.id), ['p1', 'a1', 'r1']);
  assert.equal(invalidIds.length, 2);
  assert.deepEqual(fb.log.queries.at(-1), [{ limit: ADMIN_REVIEWS_LIMIT }], 'резервный запрос — тоже с ограничением');
});

test('fetchAllReviews: текст отзыва не изменяется (разметка остаётся обычным текстом)', async () => {
  const text = '<img src=x onerror=alert(1)> Отличный аромат!';
  const fb = fakeFirebase({ x: review('pending', { text }) });
  const { reviews } = await fetchAllReviews(fb);
  assert.equal(reviews[0].text, text);
  assert.doesNotMatch(read('src/services/adminReviewsStore.js'), /dangerouslySetInnerHTML|innerHTML/);
});

test('toAdminReview и isReviewStatus: пустые данные и статусы', () => {
  assert.equal(toAdminReview('x', null), null);
  assert.equal(toAdminReview('x', 'текст'), null);
  assert.deepEqual(['pending', 'approved', 'rejected'].map(isReviewStatus), [true, true, true]);
  assert.deepEqual(['published', '', undefined, 'Approved'].map(isReviewStatus), [false, false, false, false]);
});

// ---------- setReviewStatus ----------

test('setReviewStatus: одобрение — status и moderatedAt от сервера, остальные поля не меняются', async () => {
  const fb = seed();
  const before = fb.docs.get('p1');
  const res = await setReviewStatus(fb, 'p1', 'approved', 'pending');
  assert.deepEqual(res, { id: 'p1', status: 'approved', changed: true });
  const after = fb.docs.get('p1');
  assert.equal(after.status, 'approved');
  assert.ok(after.moderatedAt instanceof FakeTimestamp, 'moderatedAt ставит сервер');
  const { status: _s1, moderatedAt: _m1, ...restAfter } = after;
  const { status: _s0, ...restBefore } = before;
  assert.deepEqual(restAfter, restBefore, 'имя, оценка, текст, язык и дата создания прежние');
  assert.equal(fb.stats.writes, 1);
  // Другие отзывы не затронуты
  assert.equal(fb.docs.get('a1').status, 'approved');
  assert.equal(fb.docs.get('r1').status, 'rejected');
});

test('setReviewStatus: все переходы между pending, approved и rejected', async () => {
  const fb = fakeFirebase({ x: review('pending') });
  const steps = [
    ['pending', 'rejected'],
    ['rejected', 'approved'],
    ['approved', 'pending'],
    ['pending', 'approved'],
    ['approved', 'rejected'],
    ['rejected', 'pending'],
  ];
  for (const [from, to] of steps) {
    assert.deepEqual(await setReviewStatus(fb, 'x', to, from), { id: 'x', status: to, changed: true });
    assert.equal(fb.docs.get('x').status, to);
  }
  assert.equal(fb.stats.writes, steps.length);
});

test('setReviewStatus: записываются только два поля — status и moderatedAt = serverTimestamp()', async () => {
  const fb = seed();
  await setReviewStatus(fb, 'p1', 'rejected', 'pending');
  await setReviewStatus(fb, 'a1', 'pending', 'approved');
  assert.equal(fb.log.updates.length, 2);
  for (const { data } of fb.log.updates) {
    assert.deepEqual(Object.keys(data).sort(), ['moderatedAt', 'status']);
    assert.equal(data.moderatedAt, SERVER_TIMESTAMP);
  }
  // Те же поля разрешает правило isValidReviewModeration в firestore.rules
  const rules = read('firestore.rules');
  const fn = rules.slice(rules.indexOf('function isValidReviewModeration'));
  const allowed = [...fn.slice(fn.indexOf('.hasOnly(['), fn.indexOf(']')).matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(allowed.sort(), ['moderatedAt', 'status']);
});

test('setReviewStatus: время модерации обновляется при каждом новом решении', async () => {
  const fb = fakeFirebase({ x: review('pending') });
  await setReviewStatus(fb, 'x', 'approved', 'pending');
  const first = fb.docs.get('x').moderatedAt.ms;
  await setReviewStatus(fb, 'x', 'rejected', 'approved');
  assert.ok(fb.docs.get('x').moderatedAt.ms > first);
});

test('setReviewStatus: нет документа — not-found, новый документ не создаётся', async () => {
  const fb = seed();
  await rejectsWith(setReviewStatus(fb, 'missing', 'approved', 'pending'), 'not-found');
  assert.equal(fb.docs.has('missing'), false);
  assert.equal(fb.stats.writes, 0);
});

test('setReviewStatus: некорректный id — not-found без обращения к базе', async () => {
  const fb = seed();
  for (const id of ['', null, undefined, 42, 'a/b', 'x'.repeat(1501)]) {
    await rejectsWith(setReviewStatus(fb, id, 'approved', 'pending'), 'not-found');
  }
  assert.equal(fb.stats.transactions, 0);
});

test('setReviewStatus: неизвестный статус (новый или загруженный) — invalid без обращения к базе', async () => {
  const fb = seed();
  await rejectsWith(setReviewStatus(fb, 'p1', 'published', 'pending'), 'invalid');
  await rejectsWith(setReviewStatus(fb, 'p1', 'approved', undefined), 'invalid');
  await rejectsWith(setReviewStatus(fb, 'p1', undefined, 'pending'), 'invalid');
  assert.equal(fb.stats.transactions, 0);
  assert.equal(fb.docs.get('p1').status, 'pending');
});

test('setReviewStatus: статус изменил другой администратор после загрузки — conflict, его решение не затёрто', async () => {
  const fb = seed();
  // Оба администратора загрузили отзыв в статусе pending; первый отклонил его
  await setReviewStatus(fb, 'p1', 'rejected', 'pending');
  const afterFirst = fb.docs.get('p1');
  // Второй, не обновив список, пытается одобрить
  await rejectsWith(setReviewStatus(fb, 'p1', 'approved', 'pending'), 'conflict');
  assert.deepEqual(fb.docs.get('p1'), afterFirst);
  assert.equal(fb.stats.writes, 1);
});

test('setReviewStatus: тот же статус — без записи, changed: false (moderatedAt не меняется)', async () => {
  const fb = seed();
  const before = fb.docs.get('a1');
  assert.deepEqual(await setReviewStatus(fb, 'a1', 'approved', 'approved'), { id: 'a1', status: 'approved', changed: false });
  assert.deepEqual(fb.docs.get('a1'), before);
  assert.equal(fb.stats.writes, 0);
  assert.equal(fb.log.updates.length, 0);
});

test('setReviewStatus: другой администратор уже поставил этот же статус — changed: false, а не conflict', async () => {
  const fb = seed();
  await setReviewStatus(fb, 'p1', 'approved', 'pending');
  const after = fb.docs.get('p1');
  assert.deepEqual(await setReviewStatus(fb, 'p1', 'approved', 'pending'), { id: 'p1', status: 'approved', changed: false });
  assert.deepEqual(fb.docs.get('p1'), after);
  assert.equal(fb.stats.writes, 1);
});

// ---------- deleteReview ----------

test('deleteReview: отклонённый отзыв удаляется навсегда, остальные на месте', async () => {
  const fb = seed();
  assert.equal(await deleteReview(fb, 'r1'), 'r1');
  assert.equal(fb.docs.has('r1'), false);
  assert.deepEqual([...fb.docs.keys()].sort(), ['a1', 'badRating', 'badStatus', 'p1']);
  assert.equal(fb.stats.writes, 1);
});

test('deleteReview: цепочка «отклонить → удалить»', async () => {
  const fb = seed();
  await setReviewStatus(fb, 'p1', 'rejected', 'pending');
  assert.equal(await deleteReview(fb, 'p1'), 'p1');
  assert.equal(fb.docs.has('p1'), false);
});

test('deleteReview: ожидающий и одобренный отзыв удалить нельзя — not-rejected, документы не тронуты', async () => {
  const fb = seed();
  const before = new Map(fb.docs);
  await rejectsWith(deleteReview(fb, 'p1'), 'not-rejected');
  await rejectsWith(deleteReview(fb, 'a1'), 'not-rejected');
  // Повреждённый документ с неизвестным статусом или без статуса — тоже не удаляется
  await rejectsWith(deleteReview(fb, 'badStatus'), 'not-rejected');
  assert.deepEqual(fb.docs, before);
  assert.equal(fb.stats.writes, 0);
});

test('deleteReview: отзыв вернули из rejected в другой вкладке — not-rejected, не удалён', async () => {
  const fb = seed();
  await setReviewStatus(fb, 'r1', 'pending', 'rejected');
  await rejectsWith(deleteReview(fb, 'r1'), 'not-rejected');
  assert.equal(fb.docs.get('r1').status, 'pending');
});

test('deleteReview: нет документа — not-found; некорректный id — без обращения к базе', async () => {
  const fb = seed();
  await rejectsWith(deleteReview(fb, 'missing'), 'not-found');
  assert.equal(fb.stats.transactions, 1);
  for (const id of ['', null, 'a/b']) await rejectsWith(deleteReview(fb, id), 'not-found');
  assert.equal(fb.stats.transactions, 1);
  assert.equal(fb.stats.writes, 0);
});

// ---------- Ошибки Firebase и согласованность ----------

test('ошибки Firebase: нет прав → denied, нет сети → network, прочее → failed (во всех функциях)', async () => {
  const cases = [
    ['permission-denied', 'denied'],
    ['unavailable', 'network'],
    ['deadline-exceeded', 'network'],
    ['internal', 'failed'],
  ];
  for (const [firebaseCode, code] of cases) {
    const fb = seed();
    const calls = [
      () => fetchAllReviews(fb),
      () => setReviewStatus(fb, 'p1', 'approved', 'pending'),
      () => deleteReview(fb, 'r1'),
    ];
    for (const call of calls) {
      fb.failNext = { code: firebaseCode };
      await rejectsWith(call(), code);
    }
    assert.equal(fb.stats.writes, 0, firebaseCode);
  }
});

test('статусы хранилища совпадают с REVIEW_STATUS и списком в firestore.rules', () => {
  const rules = read('firestore.rules');
  const fn = rules.slice(rules.indexOf('function isValidReviewModeration'));
  const marker = 'request.resource.data.status in [';
  const start = fn.indexOf(marker);
  const inRules = [...fn.slice(start + marker.length, fn.indexOf(']', start)).matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(inRules.sort(), Object.values(REVIEW_STATUS).sort());
  assert.ok(Object.values(REVIEW_STATUS).every(isReviewStatus));
  // Удаление — только при status == 'rejected', как в правиле delete
  assert.ok(rules.includes("allow delete: if isAdmin() && resource.data.status == 'rejected';"));
});

test('хранилище: запись только в транзакциях, без auth и без прямых setDoc/updateDoc/deleteDoc', () => {
  const store = read('src/services/adminReviewsStore.js');
  assert.doesNotMatch(store, /dbApi\.(setDoc|updateDoc|deleteDoc|addDoc)\(/);
  assert.equal(store.match(/dbApi\.runTransaction\(/g).length, 2);
  assert.match(store, /tx\.update\(ref, \{ status, moderatedAt: dbApi\.serverTimestamp\(\) \}\);/);
  assert.equal(store.match(/tx\.update\(/g).length, 1);
  assert.equal(store.match(/tx\.delete\(/g).length, 1);
  assert.doesNotMatch(store, /auth|currentUser/);
});
