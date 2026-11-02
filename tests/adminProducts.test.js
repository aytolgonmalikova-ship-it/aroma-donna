// Тесты списка товаров в админ-панели (этап 5б): поиск, фильтры, сортировка, параметры адреса.
// Запуск: npm test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CATEGORIES, FAMILIES, products } from '../src/data/products.js';
import { AVAILABILITIES } from '../src/utils/products.js';
import {
  DEFAULT_PRODUCT_FILTERS,
  PRODUCT_SORTS,
  countActiveProductFilters,
  filterAdminProducts,
  matchesProductQuery,
  parseProductListParams,
  sortAdminProducts,
  toProductListParams,
} from '../src/utils/adminProducts.js';

const P = (id, name, brand, extra = {}) => ({
  id,
  name,
  brand,
  category: 'women',
  fragranceFamily: 'floral',
  availability: 'inStock',
  price: 5000,
  updatedAt: null,
  ...extra,
});

const LIST = [
  P('rose-poudree', 'Rose Poudrée', 'Maison Rosé', { price: 5900, updatedAt: '2026-11-01T10:00:00.000Z' }),
  P('oud-royal', 'Oud Royal', 'Atelier Oud', { category: 'men', fragranceFamily: 'woody', price: 9800, availability: 'lowStock', updatedAt: '2026-11-02T09:00:00.000Z' }),
  P('ala-too-breeze', 'Ala-Too Breeze', 'Tian Shan', { category: 'unisex', fragranceFamily: 'aquatic', price: 3600, availability: 'outOfStock' }),
  P('berry-kiss', 'Berry Kiss', 'Maison Rosé', { fragranceFamily: 'fruity', price: 3600, updatedAt: '2026-10-01T10:00:00.000Z', hidden: true }),
];
const ids = (list) => list.map((p) => p.id);

test('поиск по названию, бренду и id без учёта регистра и пробелов', () => {
  assert.ok(matchesProductQuery(LIST[0], '  ROSE '));
  assert.ok(matchesProductQuery(LIST[1], 'atelier'));
  assert.ok(matchesProductQuery(LIST[2], 'too-bree'));
  assert.ok(matchesProductQuery(LIST[0], ''));
  assert.equal(matchesProductQuery(LIST[1], 'jasmin'), false);
  assert.deepEqual(ids(filterAdminProducts(LIST, { q: 'maison rosé' })), ['rose-poudree', 'berry-kiss']);
});

test('фильтры: пол (category), семейство, наличие и их сочетание; скрытые товары не отбрасываются', () => {
  assert.deepEqual(ids(filterAdminProducts(LIST, { gender: 'women' })), ['rose-poudree', 'berry-kiss']);
  assert.deepEqual(ids(filterAdminProducts(LIST, { gender: 'unisex' })), ['ala-too-breeze']);
  assert.deepEqual(ids(filterAdminProducts(LIST, { family: 'woody' })), ['oud-royal']);
  assert.deepEqual(ids(filterAdminProducts(LIST, { stock: 'outOfStock' })), ['ala-too-breeze']);
  assert.deepEqual(ids(filterAdminProducts(LIST, { gender: 'women', family: 'fruity', q: 'kiss' })), ['berry-kiss']);
  assert.deepEqual(ids(filterAdminProducts(LIST, { gender: 'men', stock: 'inStock' })), []);
  assert.deepEqual(ids(filterAdminProducts(LIST, DEFAULT_PRODUCT_FILTERS)), ids(LIST));
});

test('сортировка: по дате изменения (без даты — в конце), названию и цене; исходный массив не меняется', () => {
  const before = ids(LIST);
  assert.deepEqual(ids(sortAdminProducts(LIST, 'updated')), ['oud-royal', 'rose-poudree', 'berry-kiss', 'ala-too-breeze']);
  assert.deepEqual(ids(sortAdminProducts(LIST, 'name')), ['ala-too-breeze', 'berry-kiss', 'oud-royal', 'rose-poudree']);
  // Одинаковая цена — по названию
  assert.deepEqual(ids(sortAdminProducts(LIST, 'priceAsc')), ['ala-too-breeze', 'berry-kiss', 'rose-poudree', 'oud-royal']);
  assert.deepEqual(ids(sortAdminProducts(LIST, 'priceDesc')), ['oud-royal', 'rose-poudree', 'ala-too-breeze', 'berry-kiss']);
  assert.deepEqual(ids(sortAdminProducts(LIST, 'unknown')), ids(sortAdminProducts(LIST, 'updated')));
  assert.deepEqual(ids(LIST), before);
});

test('работает на всём демо-каталоге: 24 товара, фильтры дают непересекающиеся группы', () => {
  const genders = ['women', 'men', 'unisex'].map((gender) => filterAdminProducts(products, { gender }).length);
  assert.equal(genders.reduce((a, b) => a + b, 0), products.length);
  const sorted = sortAdminProducts(products, 'priceAsc');
  assert.equal(sorted.length, 24);
  sorted.slice(1).forEach((p, i) => assert.ok(p.price >= sorted[i].price));
});

test('параметры адреса: разбор, неизвестные значения → по умолчанию, обратное преобразование', () => {
  assert.deepEqual(parseProductListParams(new URLSearchParams('')), DEFAULT_PRODUCT_FILTERS);
  assert.equal(PRODUCT_SORTS[0], 'updated');
  assert.deepEqual(
    parseProductListParams(new URLSearchParams('q=rose&gender=men&family=woody&stock=lowStock&sort=priceDesc')),
    { q: 'rose', gender: 'men', family: 'woody', stock: 'lowStock', sort: 'priceDesc' },
  );
  assert.deepEqual(
    parseProductListParams(new URLSearchParams('gender=kids&family=spicy&stock=soon&sort=random')),
    DEFAULT_PRODUCT_FILTERS,
  );
  const filters = { q: 'rose poudree', gender: 'men', family: '', stock: 'inStock', sort: 'updated' };
  const params = toProductListParams(filters);
  assert.equal(params.toString(), 'q=rose+poudree&gender=men&stock=inStock');
  assert.deepEqual(parseProductListParams(params), filters);
  // Пробел при вводе сохраняется (поле поиска читает значение из адреса), пустой запрос не пишется
  assert.equal(toProductListParams({ ...DEFAULT_PRODUCT_FILTERS, q: 'rose ' }).get('q'), 'rose ');
  assert.equal(toProductListParams({ ...DEFAULT_PRODUCT_FILTERS, q: '   ' }).toString(), '');
  assert.equal(toProductListParams(DEFAULT_PRODUCT_FILTERS).toString(), '');
});

test('счётчик активных фильтров не учитывает поиск и сортировку', () => {
  assert.equal(countActiveProductFilters(DEFAULT_PRODUCT_FILTERS), 0);
  assert.equal(countActiveProductFilters({ q: 'x', gender: 'men', family: 'woody', stock: '', sort: 'name' }), 2);
});

// ---------- Страница списка ----------

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

test('страница «Товары»: все ключи переводов есть в ru, ky и en', () => {
  const page = read('src/pages/admin/AdminProductsPage.jsx');
  const keys = new Set([...page.matchAll(/\bt\('([a-zA-Z0-9_.-]+)'/g)].map((m) => m[1]));
  PRODUCT_SORTS.forEach((s) => keys.add(`admin.products.sort.${s}`));
  CATEGORIES.forEach((c) => keys.add(`categories.${c}`));
  FAMILIES.forEach((f) => keys.add(`families.${f}`));
  AVAILABILITIES.forEach((a) => keys.add(`availability.${a}`));
  ['failed', 'network', 'denied', 'not-configured', 'not-empty', 'invalid'].forEach((e) => keys.add(`admin.products.errors.${e}`));
  assert.ok(keys.size > 40);
  for (const lang of ['ru', 'ky', 'en']) {
    const dict = JSON.parse(read(`src/locales/${lang}/translation.json`));
    const missing = [...keys].filter((k) => typeof get(dict, k) !== 'string');
    assert.deepEqual(missing, [], lang);
  }
});

test('страница «Товары»: параметры в адресе, ссылки на форму, без скрытия и удаления (этап 5в)', () => {
  const page = read('src/pages/admin/AdminProductsPage.jsx');
  assert.match(page, /parseProductListParams\(searchParams\)/);
  assert.match(page, /setSearchParams\(toProductListParams\(/);
  assert.match(page, /to="\/admin\/products\/new"/);
  assert.match(page, /\/admin\/products\/\$\{id\}\/edit/);
  assert.match(page, /fetchAllProducts\(\)/);
  assert.doesNotMatch(page, /deleteDoc|removeProduct|deleteProduct|hideProduct|setHidden|hidden: /);
});
