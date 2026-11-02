// Тесты раздела «Покупатели»: объединение профилей с заказами, статистика, поиск,
// сортировка и проверка, что админ получил в firestore.rules только чтение профилей. Запуск: npm test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CUSTOMER_SORTS,
  buildCustomers,
  filterCustomers,
  isCustomerSort,
  shortUid,
  sortCustomers,
} from '../src/utils/customers.js';

const PROFILES = [
  { uid: 'u1', name: 'Айгуль', email: 'aigul@mail.kg', createdAt: '2026-09-01T10:00:00.000Z' },
  { uid: 'u2', name: 'Bob', email: 'bob@example.com', createdAt: '2026-10-01T10:00:00.000Z' },
];

const ORDERS = [
  { id: 'A', userId: 'u1', total: 5000, status: 'delivered', createdAt: '2026-09-10T10:00:00.000Z', customer: { phone: '+996 700 111 111' } },
  { id: 'B', userId: 'u1', total: 3000, status: 'new', createdAt: '2026-10-20T10:00:00.000Z', customer: {} },
  { id: 'C', userId: 'u1', total: 9000, status: 'cancelled', createdAt: '2026-10-05T10:00:00.000Z', customer: {} },
  {
    id: 'D',
    userId: 'u3',
    total: 2000,
    status: 'new',
    createdAt: '2026-10-15T10:00:00.000Z',
    customer: { name: 'Нурлан', lastName: 'Асанов', email: 'nur@mail.kg', phone: '+996 555 000 000' },
  },
];

const byUid = (list) => Object.fromEntries(list.map((c) => [c.uid, c]));

test('customers: статистика покупателя с заказами', () => {
  const { u1 } = byUid(buildCustomers(PROFILES, ORDERS));
  assert.equal(u1.hasProfile, true);
  assert.equal(u1.ordersCount, 3);
  assert.equal(u1.totalSpent, 8000, 'отменённый заказ не входит в сумму');
  assert.equal(u1.lastOrderAt, '2026-10-20T10:00:00.000Z');
  assert.deepEqual(u1.orders.map((o) => o.id), ['B', 'C', 'A'], 'заказы — новые сверху');
  assert.equal(u1.phone, '+996 700 111 111', 'телефон — из последнего заказа, где он указан');
});

test('customers: зарегистрирован, но без заказов', () => {
  const { u2 } = byUid(buildCustomers(PROFILES, ORDERS));
  assert.equal(u2.ordersCount, 0);
  assert.equal(u2.totalSpent, 0);
  assert.equal(u2.lastOrderAt, null);
  assert.equal(u2.phone, '');
});

test('customers: заказы без профиля — данные из заказа, hasProfile = false', () => {
  const { u3 } = byUid(buildCustomers(PROFILES, ORDERS));
  assert.equal(u3.hasProfile, false);
  assert.equal(u3.name, 'Нурлан Асанов');
  assert.equal(u3.email, 'nur@mail.kg');
  assert.equal(u3.createdAt, null);
  assert.equal(u3.ordersCount, 1);
});

test('customers: пустые данные и заказы без userId', () => {
  assert.deepEqual(buildCustomers([], []), []);
  assert.deepEqual(buildCustomers([], [{ id: 'X', total: 100 }]), []);
});

test('customers: поиск по имени и e-mail без учёта регистра', () => {
  const list = buildCustomers(PROFILES, ORDERS);
  assert.deepEqual(filterCustomers(list, 'айгуль').map((c) => c.uid), ['u1']);
  assert.deepEqual(filterCustomers(list, '  EXAMPLE.com ').map((c) => c.uid), ['u2']);
  assert.equal(filterCustomers(list, '').length, 3);
  assert.deepEqual(filterCustomers(list, 'нет-такого'), []);
});

test('customers: сортировка', () => {
  const list = buildCustomers(PROFILES, ORDERS);
  const ids = (sort) => sortCustomers(list, sort).map((c) => c.uid);
  assert.deepEqual(ids('registered'), ['u2', 'u1', 'u3'], 'без даты регистрации — в конце');
  assert.deepEqual(ids('lastOrder'), ['u1', 'u3', 'u2']);
  assert.deepEqual(ids('spent'), ['u1', 'u3', 'u2']);
  assert.deepEqual(ids('orders'), ['u1', 'u3', 'u2']);
  assert.deepEqual(ids('unknown'), ids(CUSTOMER_SORTS[0]));
  assert.notEqual(sortCustomers(list, 'name'), list, 'исходный массив не меняется');
});

test('customers: допустимые сортировки и короткий uid', () => {
  assert.equal(isCustomerSort('spent'), true);
  assert.equal(isCustomerSort('__proto__'), false);
  assert.equal(shortUid('abcdefghijklmnopqrstuvwxyz'), 'abcdef…wxyz');
  assert.equal(shortUid('short'), 'short');
});

test('firestore.rules: администратор может только читать профили users', () => {
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  const block = rules.slice(rules.indexOf('match /users/{userId}'), rules.indexOf('match /orders/{orderId}'));
  assert.match(block, /allow read: if isOwner\(userId\) \|\| isAdmin\(\);/);
  const writes = block.split('\n').filter((line) => /allow (create|update|delete|write)/.test(line));
  assert.ok(writes.length >= 3);
  // Строки allow create/update/delete для профиля не упоминают isAdmin
  writes.forEach((line) => assert.doesNotMatch(line, /isAdmin/));
  assert.doesNotMatch(block.replace(/\/\/.*$/gm, ''), /isAdmin\(\)\s*&&/);
});
