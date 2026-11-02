// Тесты подключения формы товара (этап 5б.4): маршруты, сервис, защита id/hidden, переводы.
// Логика формы и сервиса проверяется в productForm.test.js и adminProductsStore.test.js. Запуск: npm test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CATEGORIES, CONCENTRATIONS, FAMILIES, INTENSITIES } from '../src/data/products.js';
import { AVAILABILITIES, NOTE_LEVELS } from '../src/utils/products.js';
import { NOTE_KEYS } from '../src/utils/productForm.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

const app = read('src/pages/admin/AdminApp.jsx');
const page = read('src/pages/admin/AdminProductFormPage.jsx');
const form = read('src/components/admin/ProductForm.jsx');
const hook = read('src/hooks/useUnsavedChangesPrompt.js');

test('маршруты /admin/products/new и /admin/products/:id/edit ведут на форму', () => {
  assert.match(app, /path="products\/new" element=\{<AdminProductFormPage key="new" \/>\}/);
  assert.match(app, /path="products\/:id\/edit" element=\{<AdminProductFormPage key="edit" \/>\}/);
});

test('страница формы использует сервис: создание, изменение с датой открытия, загрузка', () => {
  assert.match(page, /fetchProductForEdit\(routeId\)/);
  assert.match(page, /await updateProduct\(routeId, data, loaded\.updatedAt\)/);
  assert.match(page, /await createProduct\(data\)/);
  assert.match(page, /validateProductForm\(form\)/);
  assert.match(page, /getProductFormWarnings\(form, loaded\?\.product/);
  // Ответы сервиса: занятый id — ошибка у поля, конфликт — кнопка загрузки актуальной версии
  assert.match(page, /code === 'id-taken'[^]*setErrors\(\{ id: 'idTaken' \}\)/);
  assert.match(page, /saveError === 'conflict'[^]*reloadLatest/);
  // После сохранения — сообщение, обновление витрины и возврат к списку
  assert.match(page, /notify\([^]*admin\.productForm\.saved[^]*fetchProducts\(\)[^]*navigate\(listPath\)/);
  // Несохранённые изменения
  assert.match(page, /useUnsavedChangesPrompt\(dirty && !saving/);
  assert.match(page, /if \(dirty && !window\.confirm\(leaveMessage\)\) return;/);
});

test('форма не меняет id при редактировании и не содержит поля hidden (этап 5в)', () => {
  assert.match(form, /readOnly: isEdit/);
  assert.match(page, /if \(!isEdit && field === 'name' && !idTouched\)/);
  assert.doesNotMatch(form, /onChange\('hidden'|form\.hidden|name="hidden"/);
  for (const src of [page, form]) assert.doesNotMatch(src, /deleteDoc|deleteProduct|hideProduct|setHidden/);
});

test('предупреждение об уходе: вкладка и ссылки внутри сайта', () => {
  assert.match(hook, /addEventListener\('beforeunload'/);
  assert.match(hook, /document\.addEventListener\('click', onClick, true\)/);
  assert.match(hook, /window\.confirm\(message\)/);
  assert.match(hook, /removeEventListener\('beforeunload'/);
});

test('все ключи переводов формы есть в ru, ky и en', () => {
  const keys = new Set();
  for (const src of [page, form]) for (const m of src.matchAll(/\bt\(\s*'([a-zA-Z0-9_.-]+)'/g)) keys.add(m[1]);
  ['main', 'description', 'image', 'volumes', 'notes', 'extra'].forEach((s) => keys.add(`admin.productForm.sections.${s}`));
  ['priceOrder', 'removedVolumes'].forEach((w) => keys.add(`admin.productForm.warnings.${w}`));
  ['id-taken', 'conflict', 'not-found', 'invalid', 'denied', 'network', 'not-configured', 'failed'].forEach((c) =>
    keys.add(`admin.productForm.saveErrors.${c}`),
  );
  ['failed', 'network', 'denied', 'not-configured'].forEach((c) => keys.add(`admin.products.errors.${c}`));
  CATEGORIES.forEach((v) => keys.add(`categories.${v}`));
  FAMILIES.forEach((v) => keys.add(`families.${v}`));
  CONCENTRATIONS.forEach((v) => keys.add(`concentration.${v}`));
  INTENSITIES.forEach((v) => keys.add(`intensity.${v}`));
  AVAILABILITIES.forEach((v) => keys.add(`availability.${v}`));
  NOTE_LEVELS.forEach((v) => keys.add(`notes.levels.${v}`));
  NOTE_KEYS.forEach((v) => keys.add(`notes.items.${v}`));
  assert.ok(keys.size > 120);
  for (const lang of ['ru', 'ky', 'en']) {
    const dict = JSON.parse(read(`src/locales/${lang}/translation.json`));
    const missing = [...keys].filter((k) => typeof get(dict, k) !== 'string');
    assert.deepEqual(missing, [], lang);
  }
});
