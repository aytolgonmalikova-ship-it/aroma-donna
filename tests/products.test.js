// Тесты этапа 5а «Каталог в Firestore»: формат документа products/{id}, подготовка импорта,
// чтение документа витриной, бренды и диапазон цен, согласованность с firestore.rules. Запуск: npm test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CATEGORIES, CONCENTRATIONS, FAMILIES, INTENSITIES, products } from '../src/data/products.js';
import {
  AVAILABILITIES,
  PRODUCT_FIELDS,
  getBrands,
  getPriceLimits,
  prepareCatalogImport,
  toCatalogProduct,
  toFirestoreProduct,
  validateProductData,
} from '../src/utils/products.js';

const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const productsBlock = rules.slice(rules.indexOf('match /products/{productId}'), rules.indexOf('// Всё остальное закрыто'));

// Документ «как в Firestore»: данные импорта + серверное время (имитация Timestamp)
const asStored = (data, date = '2026-11-02T10:00:00.000Z') => ({ ...data, updatedAt: { toDate: () => new Date(date) } });
const sample = () => toFirestoreProduct(products[0]);

test('демо-каталог: 24 товара с уникальными id, все проходят проверку формата', () => {
  assert.equal(products.length, 24);
  const docs = prepareCatalogImport(products);
  assert.equal(docs.length, 24);
  assert.deepEqual(docs.map((d) => d.id), products.map((p) => p.id), 'id товаров сохраняются');
  docs.forEach((d) => assert.deepEqual(validateProductData(d), [], d.id));
});

test('toFirestoreProduct: только поля документа, объёмы отдельно, price — минимальная, видимый', () => {
  products.forEach((p) => {
    const doc = toFirestoreProduct(p);
    Object.keys(doc).forEach((k) => assert.ok(PRODUCT_FIELDS.includes(k), `${p.id}: лишнее поле ${k}`));
    assert.equal('volume' in doc, false, 'volume вычисляется при чтении и не хранится');
    assert.equal('updatedAt' in doc, false, 'updatedAt ставит сервер');
    assert.deepEqual(doc.volumes.map((v) => v.ml), [30, 50, 100]);
    assert.equal(doc.price, Math.min(...doc.volumes.map((v) => v.price)));
    assert.equal(doc.price, p.price, 'цена «от» не меняется при переносе');
    assert.equal(doc.hidden, false);
    assert.equal(doc.image, `/images/products/${p.id}.jpg`);
  });
});

test('toFirestoreProduct не меняет исходный товар', () => {
  const p = structuredClone(products[1]);
  p.volumes.reverse();
  const before = structuredClone(p);
  toFirestoreProduct(p);
  assert.deepEqual(p, before);
});

test('validateProductData: ловит неверные поля и значения', () => {
  const cases = [
    [{ role: 'admin' }, 'unknown.role'],
    [{ id: 'Rose Poudrée' }, 'id'],
    [{ id: '' }, 'id'],
    [{ name: '   ' }, 'name'],
    [{ category: 'kids' }, 'category'],
    [{ concentration: 'cologne' }, 'concentration'],
    [{ fragranceFamily: 'smoky' }, 'fragranceFamily'],
    [{ intensity: 'max' }, 'intensity'],
    [{ availability: 'soon' }, 'availability'],
    [{ hidden: 'false' }, 'hidden'],
    [{ isNew: 1 }, 'isNew'],
    [{ rating: 6 }, 'rating'],
    [{ popularity: -1 }, 'popularity'],
    [{ image: 42 }, 'image'],
    [{ description: { ru: 'Текст', en: 'Text' } }, 'description.ky'],
    [{ notes: { top: ['rose'], heart: 'jasmine', base: [] } }, 'notes.heart'],
    [{ volumes: [] }, 'volumes'],
    [{ volumes: [{ ml: 30.5, price: 100 }] }, 'volumes'],
    [{ volumes: [{ ml: 30, price: 0 }] }, 'volumes'],
    [{ volumes: [{ ml: 30, price: 100 }, { ml: 30, price: 200 }] }, 'volumes'],
    [{ volumes: [30, 50, 75, 100, 150].map((ml) => ({ ml, price: ml * 100 })) }, 'volumes'],
    [{ price: 1 }, 'price'],
  ];
  cases.forEach(([patch, error]) => {
    const errors = validateProductData({ ...sample(), ...patch });
    assert.ok(errors.includes(error), `${JSON.stringify(patch)} → ожидали ${error}, получили ${errors}`);
  });
  assert.deepEqual(validateProductData(null), ['data']);
  // Серверное время в данных допустимо (поле есть в формате документа)
  assert.deepEqual(validateProductData({ ...sample(), updatedAt: {} }), []);
});

test('prepareCatalogImport: повторяющиеся id или ошибка формата — импорт целиком отклоняется', () => {
  assert.throws(() => prepareCatalogImport([products[0], products[1], products[0]]), /duplicate-id/);
  assert.throws(() => prepareCatalogImport([products[0], { ...products[1], category: 'kids' }]), /invalid-product:.*category/);
});

test('toCatalogProduct: документ Firestore → товар витрины в прежнем формате', () => {
  products.forEach((p) => {
    const item = toCatalogProduct(p.id, asStored(toFirestoreProduct(p)));
    const { hidden, updatedAt, ...rest } = item;
    assert.deepEqual(rest, p, `${p.id}: формат совпадает с резервным каталогом`);
    assert.equal(hidden, false);
    assert.equal(updatedAt, '2026-11-02T10:00:00.000Z', 'Timestamp → ISO-строка (сериализуемо для Redux)');
  });
});

test('toCatalogProduct: hidden как у витрины — видимым считается только hidden === false', () => {
  const doc = asStored(toFirestoreProduct(products[0]));
  assert.equal(toCatalogProduct(doc.id, { ...doc, hidden: false }).hidden, false);
  assert.equal(toCatalogProduct(doc.id, { ...doc, hidden: true }).hidden, true);
  // Нет поля или не логическое значение — запрос витрины (hidden == false) такой документ не вернёт
  const { hidden: _omit, ...noHidden } = doc;
  assert.equal(toCatalogProduct(doc.id, noHidden).hidden, true);
  assert.equal(toCatalogProduct(doc.id, { ...doc, hidden: 'false' }).hidden, true);
});

test('toCatalogProduct: объёмы сортируются, price и volume — по минимальному, мусор отбрасывается', () => {
  const item = toCatalogProduct('x', {
    ...sample(),
    volumes: [{ ml: 100, price: 9000 }, { ml: 30, price: 4000, extra: true }, { ml: 50, price: 'много' }],
  });
  assert.deepEqual(item.volumes, [{ ml: 30, price: 4000 }, { ml: 100, price: 9000 }]);
  assert.equal(item.price, 4000);
  assert.equal(item.volume, 30);
  assert.equal(item.id, 'x', 'id берётся из id документа');
});

test('toCatalogProduct: повреждённые документы и значения по умолчанию', () => {
  assert.equal(toCatalogProduct('x', null), null);
  assert.equal(toCatalogProduct('x', { ...sample(), name: '' }), null);
  assert.equal(toCatalogProduct('x', { ...sample(), volumes: [] }), null);
  assert.equal(toCatalogProduct('x', { ...sample(), volumes: 'много' }), null);

  const item = toCatalogProduct('x', { ...sample(), availability: '???', image: '', notes: null, updatedAt: undefined });
  assert.equal(item.availability, 'outOfStock', 'неизвестное наличие — товар нельзя купить');
  assert.equal(item.image, '/images/products/x.jpg');
  assert.deepEqual(item.notes, { top: [], heart: [], base: [] });
  assert.equal(item.updatedAt, null);
  assert.equal(item.isNew, false);
});

test('getBrands и getPriceLimits считаются из загруженного каталога', () => {
  assert.deepEqual(getBrands(products), [...new Set(products.map((p) => p.brand))].sort());
  assert.deepEqual(getBrands([{ brand: 'B' }, { brand: 'A' }, { brand: 'B' }]), ['A', 'B']);
  // Те же значения, что давала прежняя константа PRICE_LIMITS
  assert.deepEqual(getPriceLimits(products), {
    min: Math.min(...products.map((p) => p.price)),
    max: Math.max(...products.map((p) => p.volumes[p.volumes.length - 1].price)),
  });
  assert.deepEqual(getPriceLimits([{ volumes: [{ ml: 30, price: 500 }, { ml: 100, price: 1500 }] }]), { min: 500, max: 1500 });
  assert.equal(getPriceLimits([]), null);
});

// ---------- firestore.rules ----------

const listIn = (text, marker) => {
  const start = text.indexOf(marker);
  assert.ok(start >= 0, `в правилах нет ${marker}`);
  const list = text.slice(start + marker.length, text.indexOf(']', start));
  return [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);
};

test('правила products: публично — только видимые, запись — только админ с проверкой формата', () => {
  assert.match(productsBlock, /allow read: if isAdmin\(\) \|\| resource\.data\.hidden == false;/);
  assert.match(productsBlock, /allow create, update: if isAdmin\(\) && isValidProduct\(request\.resource\.data, productId\);/);
  // Удаление — только админ и только скрытого товара (этап 5c.8)
  assert.match(productsBlock, /allow delete: if isAdmin\(\) && resource\.data\.hidden == true;/);
  assert.doesNotMatch(productsBlock, /allow delete: if isAdmin\(\);/);
  assert.equal((productsBlock.match(/allow /g) || []).length, 3, 'других разрешений для products нет');
  assert.match(productsBlock, /p\.updatedAt == request\.time/);
  assert.match(productsBlock, /p\.id == productId/);
});

test('правила products согласованы с форматом документа в src/utils/products.js', () => {
  assert.deepEqual(listIn(productsBlock, 'p.keys().hasOnly([').sort(), [...PRODUCT_FIELDS].sort());
  assert.deepEqual(listIn(productsBlock, 'p.keys().hasAll([').sort(), [...PRODUCT_FIELDS].sort());
  assert.deepEqual(listIn(productsBlock, 'p.category in ['), CATEGORIES);
  assert.deepEqual(listIn(productsBlock, 'p.concentration in ['), CONCENTRATIONS);
  assert.deepEqual(listIn(productsBlock, 'p.fragranceFamily in ['), FAMILIES);
  assert.deepEqual(listIn(productsBlock, 'p.intensity in ['), INTENSITIES);
  assert.deepEqual(listIn(productsBlock, 'p.availability in ['), AVAILABILITIES);
});

test('прежние правила users, orders, reviews, admins и запрет по умолчанию на месте', () => {
  [
    'allow read: if isOwner(userId) || isAdmin();',
    'allow update: if isAdmin() && isValidOrderStatusChange();',
    'allow get: if isOwner(adminId);',
    'allow list, create, update, delete: if false;',
    // reviews — строгие правила модерации (этап D), подробно в tests/reviews.test.js
    'allow create: if isValidReview(request.resource.data);',
    'allow update: if isAdmin() && isValidReviewModeration();',
  ].forEach((line) => assert.ok(rules.includes(line), line));
  assert.match(rules, /match \/\{document=\*\*\} \{\s*allow read, write: if false;\s*\}/);
});
