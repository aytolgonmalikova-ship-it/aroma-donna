// formatDate: дата Firestore (Timestamp и его JSON { seconds, nanoseconds }) не роняет страницу (React #31). Запуск: npm test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDate } from '../src/utils/format.js';

test('formatDate: ISO-строка, Timestamp и { seconds, nanoseconds } дают одну и ту же строку', () => {
  const iso = '2026-11-08T10:40:00.000Z';
  const expected = formatDate(iso, 'ru');
  assert.match(expected, /08\.11\.2026/);
  const seconds = Date.parse(iso) / 1000;
  assert.equal(formatDate({ seconds, nanoseconds: 0 }, 'ru'), expected);
  assert.equal(formatDate({ seconds, nanoseconds: 0, toDate: () => new Date(iso) }, 'ru'), expected);
  assert.equal(formatDate(new Date(iso), 'ru'), expected);
});

test('formatDate: непонятная дата — всегда строка, не объект', () => {
  for (const bad of [{}, { foo: 1 }, 'не дата', undefined, null, NaN]) assert.equal(typeof formatDate(bad, 'ru'), 'string', String(bad));
  assert.equal(formatDate({ seconds: 'x' }, 'ru'), '—');
});
