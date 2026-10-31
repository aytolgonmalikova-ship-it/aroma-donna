// Тесты проверки отзыва (те же ограничения повторены в firestore.rules).
// Запуск: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REVIEW_LIMITS, validateReview } from '../src/utils/validation.js';

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
