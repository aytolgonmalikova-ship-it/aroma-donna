// Тесты проверки отзыва (те же ограничения повторены в firestore.rules)
// и правил модерации отзывов в firestore.rules (этап D).
// Запуск: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { REVIEW_LIMITS, validateReview } from '../src/utils/validation.js';
import { REVIEW_STATUS } from '../src/services/reviewsStore.js';

const VALID = { name: 'Айгерим', rating: 5, text: 'Очень стойкий аромат, держится весь день.' };

test('validateReview: корректный отзыв проходит', () => {
  assert.deepEqual(validateReview(VALID), {});
});

test('validateReview: обязательные поля', () => {
  const errors = validateReview({ name: '  ', rating: 0, text: '' });
  assert.equal(errors.name, 'validation.required');
  assert.equal(errors.rating, 'validation.rating');
  assert.equal(errors.text, 'validation.required');
});

test('validateReview: оценка только целое число от 1 до 5', () => {
  for (const rating of [1, 2, 3, 4, 5]) assert.equal(validateReview({ ...VALID, rating }).rating, undefined);
  for (const rating of [0, 6, -1, 3.5, '5', null, undefined, NaN]) {
    assert.equal(validateReview({ ...VALID, rating }).rating, 'validation.rating', `rating=${rating}`);
  }
});

test('validateReview: длина имени и текста', () => {
  assert.equal(validateReview({ ...VALID, name: 'A' }).name, 'validation.nameMin');
  assert.equal(validateReview({ ...VALID, name: 'x'.repeat(REVIEW_LIMITS.nameMax + 1) }).name, 'validation.tooLong');
  assert.equal(validateReview({ ...VALID, text: 'коротко' }).text, 'validation.messageMin');
  assert.equal(validateReview({ ...VALID, text: 'x'.repeat(REVIEW_LIMITS.textMax + 1) }).text, 'validation.tooLong');
  assert.deepEqual(validateReview({ ...VALID, text: 'x'.repeat(REVIEW_LIMITS.textMax) }), {});
});

test('validateReview: пробелы по краям не засчитываются в длину', () => {
  assert.equal(validateReview({ ...VALID, text: '   123456789   ' }).text, 'validation.messageMin');
});

// ---------- firestore.rules: строгие правила модерации (этап D) ----------

const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const reviewsBlock = rules.slice(rules.indexOf('match /reviews/{reviewId}'), rules.indexOf('// Товары каталога'));
// Только сам match-блок (без функций): до закрывающей скобки блока, а не до } в {reviewId}
const reviewsMatch = reviewsBlock.slice(0, reviewsBlock.indexOf('\n    }') + 6);
const listAfter = (text, marker) => {
  const start = text.indexOf(marker);
  assert.ok(start >= 0, `в правилах нет ${marker}`);
  return [...text.slice(start + marker.length, text.indexOf(']', start)).matchAll(/'([^']+)'/g)].map((m) => m[1]);
};
const allowedKeys = listAfter(reviewsBlock, 'review.keys().hasOnly([');
const requiredKeys = listAfter(reviewsBlock, 'review.keys().hasAll([');
const allowLines = (block) => block.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('allow '));

test('правила reviews: ровно четыре правила — чтение, создание, модерация, удаление отклонённых', () => {
  assert.deepEqual(allowLines(reviewsMatch), [
    "allow read: if isAdmin() || resource.data.status == 'approved';",
    'allow create: if isValidReview(request.resource.data);',
    'allow update: if isAdmin() && isValidReviewModeration();',
    "allow delete: if isAdmin() && resource.data.status == 'rejected';",
  ]);
  // Нет старых «открытых» правил и нет write/list в обход
  assert.doesNotMatch(reviewsMatch, /allow read: if true|allow write|allow list|allow get|allow update, delete/);
});

test("правила reviews: посетитель читает только approved, администратор — все статусы", () => {
  // isAdmin() первым: для несуществующего документа resource == null; гость без входа до exists() не доходит
  assert.match(reviewsMatch, /allow read: if isAdmin\(\) \|\| resource\.data\.status == 'approved';/);
  assert.match(rules, /function isAdmin\(\) \{\s*return isSignedIn\(\) && exists\(\/databases\/\$\(database\)\/documents\/admins\/\$\(request\.auth\.uid\)\);/);
});

test("правила reviews: создать может гость, только строгий формат и status == 'pending'", () => {
  assert.deepEqual(allowedKeys, ['name', 'rating', 'text', 'lang', 'status', 'createdAt']);
  assert.deepEqual(requiredKeys, ['name', 'rating', 'text', 'status', 'createdAt']);
  // moderatedAt при создании передать нельзя
  assert.ok(!allowedKeys.includes('moderatedAt'));
  const fn = reviewsBlock.slice(reviewsBlock.indexOf('function isValidReview('), reviewsBlock.indexOf('function isValidReviewModeration'));
  assert.match(fn, /&& review\.status == 'pending'\n/);
  assert.doesNotMatch(fn, /'approved'|'rejected'|!\('status' in review\)/);
  // Вход не требуется
  assert.doesNotMatch(fn + allowLines(reviewsMatch)[1], /isSignedIn|request\.auth|isAdmin/);
  assert.match(fn, /&& review\.createdAt == request\.time;/);
});

test('правила reviews: модерация — только админ, только status и moderatedAt = request.time', () => {
  const fn = reviewsBlock.slice(reviewsBlock.indexOf('function isValidReviewModeration'));
  assert.match(
    fn,
    /return request\.resource\.data\.diff\(resource\.data\)\.affectedKeys\(\)\s*\.hasOnly\(\['status', 'moderatedAt'\]\)\s*&& request\.resource\.data\.status in \['pending', 'approved', 'rejected'\]\s*&& request\.resource\.data\.moderatedAt == request\.time;/,
  );
  assert.match(allowLines(reviewsMatch)[2], /^allow update: if isAdmin\(\) && /);
});

test('правила reviews: список статусов совпадает с REVIEW_STATUS в reviewsStore.js', () => {
  const inRules = listAfter(reviewsBlock, 'request.resource.data.status in [');
  assert.deepEqual([...inRules].sort(), Object.values(REVIEW_STATUS).sort());
});

test("правила reviews: навсегда удалить можно только отклонённый отзыв и только администратору", () => {
  assert.equal(allowLines(reviewsMatch)[3], "allow delete: if isAdmin() && resource.data.status == 'rejected';");
});

test("форма (reviewsStore.createReview) проходит строгое правило: status: 'pending', все поля разрешены", () => {
  const store = readFileSync(new URL('../src/services/reviewsStore.js', import.meta.url), 'utf8');
  const add = store.slice(store.indexOf('export async function createReview'));
  assert.match(add, /name: name\.trim\(\),\s*rating,\s*text: text\.trim\(\),\s*lang,\s*status: REVIEW_STATUS\.pending,\s*createdAt: dbApi\.serverTimestamp\(\),\s*\}/);
  assert.match(store, /pending: 'pending'/);
  // Все обязательные поля правила форма передаёт, лишних нет
  for (const key of requiredKeys) assert.match(add, new RegExp(`\\b${key}\\b`), key);
  for (const key of ['name', 'rating', 'text', 'lang', 'status', 'createdAt']) assert.ok(allowedKeys.includes(key), key);
});

test('запросы приложения совместимы с правилами: каждое чтение reviews — с фильтром status == approved', () => {
  const store = readFileSync(new URL('../src/services/reviewsStore.js', import.meta.url), 'utf8');
  // Три обращения к коллекции: список, статистика, создание
  assert.equal(store.match(/dbApi\.collection\(db, COLLECTION\)/g).length, 3);
  assert.match(store, /const approvedOnly = \(dbApi\) => dbApi\.where\('status', '==', REVIEW_STATUS\.approved\);/);
  assert.match(store, /\[dbApi\.collection\(db, COLLECTION\), approvedOnly\(dbApi\), dbApi\.orderBy\('createdAt', 'desc'\)\]/);
  assert.match(store, /const approved = dbApi\.query\(dbApi\.collection\(db, COLLECTION\), approvedOnly\(dbApi\)\);/);
  // getDocs и getAggregateFromServer — только по запросу approved (и резервный расчёт тоже)
  assert.deepEqual(store.match(/dbApi\.(getDocs|getAggregateFromServer)\([^,)]+/g), [
    'dbApi.getDocs(dbApi.query(...parts',
    'dbApi.getAggregateFromServer(approved',
    'dbApi.getDocs(approved',
  ]);
  // Других мест с запросами к reviews нет (админ-панель читает статистику через fetchReviewStats)
  const service = readFileSync(new URL('../src/services/reviewsService.js', import.meta.url), 'utf8');
  assert.doesNotMatch(service, /dbApi\./);
});

test('firestore.indexes.json: составные индексы reviews — список (status ↑, createdAt ↓) и рейтинг (status ↑, rating ↑)', () => {
  const { indexes, fieldOverrides } = JSON.parse(readFileSync(new URL('../firestore.indexes.json', import.meta.url), 'utf8'));
  const found = indexes.filter((i) => i.collectionGroup === 'reviews');
  assert.deepEqual(found, [
    // Список одобренных: where(status) + orderBy(createdAt desc)
    { collectionGroup: 'reviews', queryScope: 'COLLECTION', fields: [{ fieldPath: 'status', order: 'ASCENDING' }, { fieldPath: 'createdAt', order: 'DESCENDING' }] },
    // Статистика: where(status) + average(rating)
    { collectionGroup: 'reviews', queryScope: 'COLLECTION', fields: [{ fieldPath: 'status', order: 'ASCENDING' }, { fieldPath: 'rating', order: 'ASCENDING' }] },
  ]);
  // Дубликатов нет
  const keys = indexes.map((i) => JSON.stringify([i.collectionGroup, i.queryScope, i.fields]));
  assert.equal(new Set(keys).size, keys.length);
  // Одиночный индекс заказов на месте
  assert.deepEqual(fieldOverrides.map((o) => [o.collectionGroup, o.fieldPath, o.indexes.length]), [['orders', 'createdAt', 4]]);
});
