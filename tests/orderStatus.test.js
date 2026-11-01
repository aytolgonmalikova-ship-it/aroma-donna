// Тесты статусов заказа для админ-панели: список статусов совпадает с firestore.rules,
// подсчёт и фильтрация по статусу. Запуск: npm test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ORDER_STATUSES, countByStatus, filterOrdersByStatus, isOrderStatus } from '../src/utils/orderStatus.js';

const ORDERS = [
  { id: 'A', status: 'new' },
  { id: 'B', status: 'shipped' },
  { id: 'C', status: 'new' },
  { id: 'D', status: 'cancelled' },
];

test('orderStatus: список статусов совпадает с firestore.rules', () => {
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  const match = rules.match(/request\.resource\.data\.status in \[([^\]]+)\]/);
  assert.ok(match, 'в firestore.rules не найден список статусов');
  const fromRules = match[1].split(',').map((s) => s.trim().replace(/'/g, ''));
  assert.deepEqual(fromRules, ORDER_STATUSES);
});

test('orderStatus: проверка допустимого статуса', () => {
  assert.equal(isOrderStatus('delivered'), true);
  assert.equal(isOrderStatus('demo'), false);
  assert.equal(isOrderStatus('__proto__'), false);
  assert.equal(isOrderStatus(undefined), false);
});

test('orderStatus: подсчёт по статусам', () => {
  assert.deepEqual(countByStatus(ORDERS), { all: 4, new: 2, confirmed: 0, shipped: 1, delivered: 0, cancelled: 1 });
});

test('orderStatus: фильтр по статусу', () => {
  assert.deepEqual(filterOrdersByStatus(ORDERS, 'new').map((o) => o.id), ['A', 'C']);
  assert.equal(filterOrdersByStatus(ORDERS, 'all'), ORDERS);
  assert.deepEqual(filterOrdersByStatus(ORDERS, 'delivered'), []);
});
