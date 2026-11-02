// Тесты модели формы товара (этап 5б): товар ↔ форма, проверка полей, предупреждения, id по названию.
// Запуск: npm test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { products } from '../src/data/products.js';
import { PRODUCT_FIELDS, toCatalogProduct, toFirestoreProduct, validateProductData } from '../src/utils/products.js';
import {
  FORM_VOLUMES,
  NOTE_KEYS,
  defaultImagePath,
  emptyProductForm,
  formToProduct,
  PRODUCT_FORM_FIELD_ORDER,
  getProductFormWarnings,
  parsePrice,
  productFormErrorMessage,
  productFormFieldId,
  serverFieldsToFormErrors,
  parseRating,
  productToForm,
  slugifyProductId,
  validateProductForm,
} from '../src/utils/productForm.js';

const locale = (lang) => JSON.parse(readFileSync(new URL(`../src/locales/${lang}/translation.json`, import.meta.url), 'utf8'));
const rose = products[0];

/** Корректная форма нового товара; overrides — изменения поверх */
function validForm(overrides = {}) {
  const form = emptyProductForm();
  Object.assign(form, {
    id: 'test-scent',
    name: 'Test Scent',
    brand: 'Maison Test',
    category: 'unisex',
    concentration: 'edp',
    fragranceFamily: 'woody',
    intensity: 'moderate',
    description: { ru: 'Описание', ky: 'Сүрөттөмө', en: 'Description' },
    image: '/images/products/test-scent.jpg',
    notes: { top: ['bergamot'], heart: ['rose'], base: ['musk'] },
  });
  form.volumes[30] = { enabled: true, price: '4000' };
  form.volumes[50] = { enabled: true, price: '5800' };
  return { ...form, ...overrides };
}

// ---------- Словарь и формат ----------

test('NOTE_KEYS совпадает со словарём notes.items во всех трёх языках и покрывает демо-каталог', () => {
  for (const lang of ['ru', 'ky', 'en']) {
    assert.deepEqual(Object.keys(locale(lang).notes.items).sort(), [...NOTE_KEYS].sort(), lang);
  }
  assert.equal(NOTE_KEYS.length, 34);
  products.forEach((p) =>
    ['top', 'heart', 'base'].forEach((level) => p.notes[level].forEach((n) => assert.ok(NOTE_KEYS.includes(n), `${p.id}: ${n}`))),
  );
});

test('все 24 демо-товара: товар → форма → документ совпадает с toFirestoreProduct и проходит правила', () => {
  assert.equal(products.length, 24);
  products.forEach((p) => {
    const form = productToForm(p);
    assert.deepEqual(validateProductForm(form), {}, p.id);
    const doc = formToProduct(form, { hidden: false });
    assert.deepEqual(doc, toFirestoreProduct(p), p.id);
    assert.deepEqual(validateProductData(doc), [], p.id);
    // Демо-рейтинги — максимум один знак после запятой (иначе форма не открылась бы без ошибки)
    assert.equal(doc.rating, p.rating);
  });
});

test('документ формы содержит ровно поля products/{id}, кроме updatedAt (его ставит сервер)', () => {
  const doc = formToProduct(validForm());
  assert.deepEqual(Object.keys(doc).sort(), PRODUCT_FIELDS.filter((f) => f !== 'updatedAt').sort());
});

test('товар из Firestore (формат витрины) открывается в форме без потерь, исходный товар не меняется', () => {
  const stored = { ...toFirestoreProduct(rose), hidden: true, updatedAt: { toDate: () => new Date('2026-11-01T10:00:00Z') } };
  const catalogProduct = toCatalogProduct(rose.id, stored);
  const snapshot = JSON.stringify(catalogProduct);
  const form = productToForm(catalogProduct);
  assert.equal(JSON.stringify(catalogProduct), snapshot);
  assert.equal('hidden' in form, false);
  assert.equal('updatedAt' in form, false);
  // Правка формы не затрагивает массивы исходного товара
  form.notes.top.push('mint');
  assert.equal(catalogProduct.notes.top.includes('mint'), false);
});

// ---------- id и hidden ----------

test('hidden берётся только из параметра: форма не может показать скрытый товар', () => {
  const form = { ...productToForm(rose), hidden: false }; // даже если в форму подложили hidden
  assert.equal(formToProduct(form, { hidden: true }).hidden, true);
  assert.equal(formToProduct(form, { hidden: false }).hidden, false);
  assert.equal(formToProduct(validForm()).hidden, false); // создание — видимый товар
});

test('id сохраняется как есть: правка названия не меняет id', () => {
  const form = productToForm(rose);
  form.name = 'Rose Poudrée Intense';
  assert.equal(formToProduct(form).id, rose.id);
});

test('проверка id: обязателен, только a-z0-9 и дефисы, до 60 символов', () => {
  assert.equal(validateProductForm(validForm({ id: '' })).id, 'required');
  assert.equal(validateProductForm(validForm({ id: '   ' })).id, 'required');
  assert.equal(validateProductForm(validForm({ id: 'Rose Poudree' })).id, 'format');
  assert.equal(validateProductForm(validForm({ id: 'rose--poudree' })).id, 'format');
  assert.equal(validateProductForm(validForm({ id: '-rose' })).id, 'format');
  assert.equal(validateProductForm(validForm({ id: 'роза' })).id, 'format');
  assert.equal(validateProductForm(validForm({ id: 'a'.repeat(61) })).id, 'tooLong');
  assert.equal(validateProductForm(validForm({ id: 'a'.repeat(60) })).id, undefined);
});

// ---------- Обязательные поля и тексты ----------

test('пустая форма: ошибки у всех обязательных полей', () => {
  const errors = validateProductForm(emptyProductForm());
  for (const field of ['id', 'name', 'brand', 'category', 'concentration', 'fragranceFamily', 'intensity', 'description.ru', 'description.ky', 'description.en', 'volumes']) {
    assert.equal(errors[field], 'required', field);
  }
  // Значения по умолчанию корректны, фото и ноты необязательны
  for (const field of ['availability', 'rating', 'popularity', 'image', 'notes.top']) assert.equal(errors[field], undefined, field);
});

test('тексты обрезаются по краям, строка из пробелов не считается заполненной, длина ограничена', () => {
  assert.equal(validateProductForm(validForm({ name: '   ' })).name, 'required');
  assert.equal(validateProductForm(validForm({ name: 'a'.repeat(101) })).name, 'tooLong');
  assert.equal(validateProductForm(validForm({ brand: 'b'.repeat(101) })).brand, 'tooLong');
  const long = validForm();
  long.description = { ...long.description, ky: 'ы'.repeat(2001) };
  assert.equal(validateProductForm(long)['description.ky'], 'tooLong');
  const doc = formToProduct(validForm({ name: '  Test Scent  ', description: { ru: ' а ', ky: ' б ', en: ' c ' } }));
  assert.equal(doc.name, 'Test Scent');
  assert.deepEqual(doc.description, { ru: 'а', ky: 'б', en: 'c' });
});

test('списки значений: пол, концентрация, семейство, интенсивность, наличие', () => {
  assert.equal(validateProductForm(validForm({ category: 'kids' })).category, 'invalid');
  assert.equal(validateProductForm(validForm({ concentration: 'cologne' })).concentration, 'invalid');
  assert.equal(validateProductForm(validForm({ fragranceFamily: 'spicy' })).fragranceFamily, 'invalid');
  assert.equal(validateProductForm(validForm({ intensity: 'extreme' })).intensity, 'invalid');
  assert.equal(validateProductForm(validForm({ availability: '' })).availability, 'required');
  assert.equal(validateProductForm(validForm({ availability: 'soon' })).availability, 'invalid');
});

// ---------- Объёмы и цены ----------

test('объёмы: только 30/50/100, хотя бы один, цена у каждого включённого', () => {
  assert.deepEqual(FORM_VOLUMES, [30, 50, 100]);
  const none = validForm();
  none.volumes = { 30: { enabled: false, price: '4000' }, 50: { enabled: false, price: '' }, 100: { enabled: false, price: '' } };
  assert.equal(validateProductForm(none).volumes, 'required');

  const cases = [
    ['', 'required'],
    ['abc', 'invalid'],
    ['12.5', 'invalid'],
    ['-5', 'invalid'],
    ['0', 'range'],
    ['10000001', 'range'],
  ];
  cases.forEach(([price, code]) => {
    const form = validForm();
    form.volumes = { ...form.volumes, 100: { enabled: true, price } };
    assert.equal(validateProductForm(form)['volumes.100'], code, `цена «${price}»`);
  });
  // Цена выключенного объёма не проверяется и в документ не попадает
  const off = validForm();
  off.volumes = { ...off.volumes, 100: { enabled: false, price: 'мусор' } };
  assert.deepEqual(validateProductForm(off), {});
  assert.deepEqual(formToProduct(off).volumes.map((v) => v.ml), [30, 50]);
});

test('цены: пробелы между разрядами, price — минимальная, объёмы по возрастанию', () => {
  assert.equal(parsePrice('8 550'), 8550);
  assert.equal(parsePrice(' 4000 '), 4000);
  assert.equal(parsePrice('4,5'), null);
  const form = validForm();
  form.volumes = { 30: { enabled: false, price: '' }, 50: { enabled: true, price: '6 000' }, 100: { enabled: true, price: '5500' } };
  const doc = formToProduct(form);
  assert.deepEqual(doc.volumes, [{ ml: 50, price: 6000 }, { ml: 100, price: 5500 }]);
  assert.equal(doc.price, 5500);
  assert.deepEqual(validateProductData(doc), []);
});

// ---------- Фото ----------

test('фото: путь на сайте или https, пустое — путь по умолчанию по id', () => {
  const ok = ['/images/products/x.jpg', 'https://cdn.example.com/a/b.webp?w=400'];
  ok.forEach((image) => assert.equal(validateProductForm(validForm({ image })).image, undefined, image));
  const bad = ['http://example.com/a.jpg', 'javascript:alert(1)', 'data:image/png;base64,AAA', '//evil.example/a.jpg', 'images/x.jpg', '/images/my photo.jpg'];
  bad.forEach((image) => assert.equal(validateProductForm(validForm({ image })).image, 'format', image));
  assert.equal(validateProductForm(validForm({ image: `/${'a'.repeat(500)}` })).image, 'tooLong');
  assert.equal(formToProduct(validForm({ image: '  ' })).image, defaultImagePath('test-scent'));
  assert.equal(defaultImagePath('test-scent'), '/images/products/test-scent.jpg');
});

// ---------- Ноты ----------

test('ноты: только из словаря, без повторов, до 10 на уровень, можно пусто', () => {
  const notes = (top) => validForm({ notes: { top, heart: [], base: [] } });
  assert.equal(validateProductForm(notes(['rose', 'unicorn']))['notes.top'], 'unknownNote');
  assert.equal(validateProductForm(notes(['rose', 'rose']))['notes.top'], 'duplicate');
  assert.equal(validateProductForm(notes(NOTE_KEYS.slice(0, 11)))['notes.top'], 'tooMany');
  assert.deepEqual(validateProductForm(notes(NOTE_KEYS.slice(0, 10))), {});
  assert.deepEqual(validateProductForm(notes([])), {});
});

// ---------- Рейтинг и популярность ----------

test('рейтинг 0–5 (один знак, запятая допустима) и популярность 0–100 (целое)', () => {
  assert.equal(parseRating('4,5'), 4.5);
  assert.equal(formToProduct(validForm({ rating: '4,5' })).rating, 4.5);
  assert.equal(validateProductForm(validForm({ rating: '' })).rating, 'required');
  assert.equal(validateProductForm(validForm({ rating: '4.55' })).rating, 'invalid');
  assert.equal(validateProductForm(validForm({ rating: '-1' })).rating, 'invalid');
  assert.equal(validateProductForm(validForm({ rating: '5.1' })).rating, 'range');
  assert.equal(validateProductForm(validForm({ rating: '0' })).rating, undefined);
  assert.equal(validateProductForm(validForm({ popularity: '50.5' })).popularity, 'invalid');
  assert.equal(validateProductForm(validForm({ popularity: '101' })).popularity, 'range');
  assert.equal(validateProductForm(validForm({ popularity: '' })).popularity, 'required');
  const fresh = emptyProductForm();
  assert.equal(fresh.rating, '0');
  assert.equal(fresh.popularity, '50');
  assert.equal(fresh.availability, 'inStock');
});

// ---------- Предупреждения ----------

test('предупреждения: больший объём дешевле и удалённые объёмы (сохранению не мешают)', () => {
  assert.deepEqual(getProductFormWarnings(productToForm(rose), rose), []);

  const cheaper = validForm();
  cheaper.volumes = { ...cheaper.volumes, 100: { enabled: true, price: '3000' } };
  assert.deepEqual(getProductFormWarnings(cheaper), [{ code: 'priceOrder', params: { larger: 100, smaller: 50 } }]);
  assert.deepEqual(validateProductForm(cheaper), {});

  const removed = productToForm(rose);
  removed.volumes[100] = { ...removed.volumes[100], enabled: false };
  assert.deepEqual(getProductFormWarnings(removed, rose), [{ code: 'removedVolumes', params: { volumes: [100] } }]);

  // Объём вне 30/50/100 (например, добавлен вручную в консоли) форма не поддерживает — предупреждаем
  const with75 = { ...rose, volumes: [...rose.volumes, { ml: 75, price: 9000 }] };
  assert.deepEqual(getProductFormWarnings(productToForm(with75), with75), [{ code: 'removedVolumes', params: { volumes: [75] } }]);
});

// ---------- id по названию ----------

test('slugifyProductId: латиница, кириллица и кыргызские буквы, диакритика, ограничение длины', () => {
  assert.equal(slugifyProductId('Rose Poudrée'), 'rose-poudree');
  assert.equal(slugifyProductId('  Jasmin de Minuit!  '), 'jasmin-de-minuit');
  assert.equal(slugifyProductId('Ала-Тоо Түн'), 'ala-too-tun');
  assert.equal(slugifyProductId('Өрүк жана Жаңгак'), 'oruk-zhana-zhanggak'); // ң → ng, г → g
  assert.equal(slugifyProductId('Щедрый Ёж № 5'), 'schedryy-ezh-5');
  assert.equal(slugifyProductId('***'), '');
  assert.equal(slugifyProductId(''), '');
  const long = slugifyProductId(`${'a'.repeat(59)} b`);
  assert.ok(long.length <= 60 && !long.endsWith('-'), long);
  // Результат всегда проходит проверку id (если не пустой)
  ['Rose Poudrée', 'Ала-Тоо Түн', 'Oud & Leather 2026'].forEach((name) => {
    assert.equal(validateProductForm(validForm({ id: slugifyProductId(name) })).id, undefined, name);
  });
});

// ---------- Тексты ошибок (этап 5б.4) ----------

test('productFormErrorMessage: понятный ключ и параметры для каждой ошибки', () => {
  assert.deepEqual(productFormErrorMessage('name', 'required'), { key: 'required' });
  assert.deepEqual(productFormErrorMessage('category', 'required'), { key: 'choose' });
  assert.deepEqual(productFormErrorMessage('volumes', 'required'), { key: 'volumesRequired' });
  assert.deepEqual(productFormErrorMessage('volumes.50', 'required'), { key: 'required' });
  assert.deepEqual(productFormErrorMessage('id', 'tooLong'), { key: 'tooLong', params: { max: 60 } });
  assert.deepEqual(productFormErrorMessage('name', 'tooLong'), { key: 'tooLong', params: { max: 100 } });
  assert.deepEqual(productFormErrorMessage('description.ky', 'tooLong'), { key: 'tooLong', params: { max: 2000 } });
  assert.deepEqual(productFormErrorMessage('image', 'tooLong'), { key: 'tooLong', params: { max: 500 } });
  assert.deepEqual(productFormErrorMessage('id', 'format'), { key: 'idFormat' });
  assert.deepEqual(productFormErrorMessage('image', 'format'), { key: 'imageFormat' });
  assert.deepEqual(productFormErrorMessage('volumes.100', 'invalid'), { key: 'priceInvalid' });
  assert.equal(productFormErrorMessage('volumes.100', 'range').key, 'priceRange');
  assert.deepEqual(productFormErrorMessage('rating', 'range'), { key: 'ratingRange' });
  assert.deepEqual(productFormErrorMessage('popularity', 'invalid'), { key: 'popularityInvalid' });
  assert.deepEqual(productFormErrorMessage('notes.top', 'tooMany'), { key: 'tooMany', params: { max: 10 } });
  assert.deepEqual(productFormErrorMessage('id', 'idTaken'), { key: 'idTaken' });
  assert.deepEqual(productFormErrorMessage('brand', 'invalid'), { key: 'invalid' });
});

test('любая ошибка проверки формы имеет текст на ru, ky и en и место в порядке полей', () => {
  const broken = [
    emptyProductForm(),
    validForm({ id: 'Bad Id', name: 'n'.repeat(101), brand: 'b'.repeat(101), image: 'http://x', rating: '9', popularity: 'x', category: 'kids', availability: 'soon' }),
    validForm({ id: 'a'.repeat(61), rating: 'abc', popularity: '101', image: `/${'a'.repeat(500)}`, notes: { top: ['rose', 'rose'], heart: ['nope'], base: NOTE_KEYS.slice(0, 11) } }),
  ];
  const withPrices = validForm();
  withPrices.volumes = { 30: { enabled: true, price: '' }, 50: { enabled: true, price: 'abc' }, 100: { enabled: true, price: '0' } };
  withPrices.description = { ru: '', ky: 'ы'.repeat(2001), en: ' ' };
  broken.push(withPrices);

  const pairs = broken.flatMap((form) => Object.entries(validateProductForm(form)));
  pairs.push(['id', 'idTaken']);
  assert.ok(pairs.length > 25);
  const dicts = ['ru', 'ky', 'en'].map((lang) => [lang, locale(lang).admin.productForm.errors]);
  for (const [field, code] of pairs) {
    assert.ok(PRODUCT_FORM_FIELD_ORDER.includes(field), `нет в порядке полей: ${field}`);
    const { key } = productFormErrorMessage(field, code);
    for (const [lang, errors] of dicts) assert.equal(typeof errors[key], 'string', `${lang}: ${field}/${code} → ${key}`);
  }
});

test('serverFieldsToFormErrors: поля из ответа сервиса → ошибки у полей формы', () => {
  assert.deepEqual(serverFieldsToFormErrors(['name', 'price', 'description.ky', 'notes.base', 'unknown.extra', 'updatedAt']), {
    name: 'invalid',
    volumes: 'invalid',
    'description.ky': 'invalid',
    'notes.base': 'invalid',
  });
  assert.deepEqual(serverFieldsToFormErrors(['description', 'notes']), { 'description.ru': 'invalid', 'notes.top': 'invalid' });
  assert.deepEqual(serverFieldsToFormErrors(undefined), {});
});

test('productFormFieldId и предупреждения для повреждённого документа', () => {
  assert.equal(productFormFieldId('description.ky'), 'pf-description-ky');
  assert.equal(productFormFieldId('volumes.30'), 'pf-volumes-30');
  // Повреждённый документ: объёмы не массив или с мусором — предупреждения не падают
  assert.deepEqual(getProductFormWarnings(validForm(), { volumes: 'oops' }), []);
  assert.deepEqual(getProductFormWarnings(validForm(), { volumes: [null, { ml: 'x' }, { ml: 100, price: 1 }] }), [
    { code: 'removedVolumes', params: { volumes: [100] } },
  ]);
  // Повреждённый документ открывается в форме без падения
  const form = productToForm({ id: 'broken', name: 'Без объёмов', volumes: [], notes: 'x', description: null });
  assert.equal(form.name, 'Без объёмов');
  assert.equal(validateProductForm(form).volumes, 'required');
});
