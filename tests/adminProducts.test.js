// Тесты списка товаров в админ-панели: поиск, фильтры, сортировка, параметры адреса (этап 5б);
// видимость, счётчики, доступность скрытия и удаления, обновление списка (этап 5в);
// окончательное удаление на странице товара: JSON-копия, ввод ID, ошибки (подэтап 5в.4);
// видимость на странице товара (подэтап 5в.5).
// Запуск: npm test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CATEGORIES, FAMILIES, products } from '../src/data/products.js';
import { AVAILABILITIES } from '../src/utils/products.js';
import {
  DEFAULT_PRODUCT_FILTERS,
  PRODUCT_BACKUP_FORMAT,
  PRODUCT_SORTS,
  PRODUCT_VISIBILITIES,
  applyFetchedProduct,
  buildProductBackup,
  countActiveProductFilters,
  countProductVisibility,
  deleteBlockReason,
  deleteErrorAction,
  filterAdminProducts,
  hideBlockReason,
  isDeleteConfirmed,
  matchesProductQuery,
  parseProductListParams,
  productBackupFileName,
  productVisibilityState,
  removeListProduct,
  replaceListProduct,
  sortAdminProducts,
  toProductListParams,
  visibilityErrorAction,
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
  hidden: false,
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
    { q: 'rose', gender: 'men', family: 'woody', stock: 'lowStock', visibility: '', sort: 'priceDesc' },
  );
  assert.deepEqual(
    parseProductListParams(new URLSearchParams('gender=kids&family=spicy&stock=soon&visibility=all&sort=random')),
    DEFAULT_PRODUCT_FILTERS,
  );
  const filters = { q: 'rose poudree', gender: 'men', family: '', stock: 'inStock', visibility: '', sort: 'updated' };
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
  assert.equal(countActiveProductFilters({ q: 'x', gender: 'men', family: 'woody', stock: '', visibility: '', sort: 'name' }), 2);
  assert.equal(countActiveProductFilters({ ...DEFAULT_PRODUCT_FILTERS, visibility: 'hidden' }), 1);
});

// ---------- Видимость, счётчики, скрытие и удаление (этап 5в) ----------

test('фильтр видимости: на витрине, скрытые, все; сочетается с другими фильтрами', () => {
  assert.deepEqual(PRODUCT_VISIBILITIES, ['visible', 'hidden']);
  assert.equal(DEFAULT_PRODUCT_FILTERS.visibility, '');
  assert.deepEqual(ids(filterAdminProducts(LIST, { visibility: 'hidden' })), ['berry-kiss']);
  assert.deepEqual(ids(filterAdminProducts(LIST, { visibility: 'visible' })), ['rose-poudree', 'oud-royal', 'ala-too-breeze']);
  assert.deepEqual(ids(filterAdminProducts(LIST, { visibility: '' })), ids(LIST));
  assert.deepEqual(ids(filterAdminProducts(LIST, { visibility: 'visible', q: 'maison' })), ['rose-poudree']);
  assert.deepEqual(ids(filterAdminProducts(LIST, { visibility: 'hidden', gender: 'men' })), []);
});

test('фильтр видимости в адресе: разбор, запись, неизвестное значение → «все»', () => {
  const hidden = parseProductListParams(new URLSearchParams('visibility=hidden'));
  assert.deepEqual(hidden, { ...DEFAULT_PRODUCT_FILTERS, visibility: 'hidden' });
  assert.equal(toProductListParams(hidden).toString(), 'visibility=hidden');
  assert.equal(parseProductListParams(new URLSearchParams('visibility=visible')).visibility, 'visible');
  for (const bad of ['all', 'HIDDEN', '1', '']) {
    assert.equal(parseProductListParams(new URLSearchParams(`visibility=${bad}`)).visibility, '', bad);
  }
  // Сброс фильтров (как на странице) очищает и видимость, сортировка остаётся
  const reset = { ...DEFAULT_PRODUCT_FILTERS, sort: 'name' };
  assert.equal(toProductListParams(reset).toString(), 'sort=name');
});

test('countProductVisibility: всего, на витрине, скрытых, повреждённых', () => {
  assert.deepEqual(countProductVisibility({ products: LIST, invalidIds: ['broken'] }), {
    total: 5,
    visible: 3,
    hidden: 1,
    damaged: 1,
  });
  assert.deepEqual(countProductVisibility({ products: [], invalidIds: [] }), { total: 0, visible: 0, hidden: 0, damaged: 0 });
  // Пока список не загружен
  assert.deepEqual(countProductVisibility(null), { total: 0, visible: 0, hidden: 0, damaged: 0 });
});

test('hideBlockReason: последний видимый товар скрыть нельзя; скрытый возвращается всегда', () => {
  const counts = (visible) => ({ total: 5, visible, hidden: 1, damaged: 0 });
  assert.equal(hideBlockReason(LIST[0], counts(3)), null);
  assert.equal(hideBlockReason(LIST[0], counts(2)), null);
  assert.equal(hideBlockReason(LIST[0], counts(1)), 'last-visible');
  // Скрытый товар — действие «Показать», ограничений нет
  assert.equal(hideBlockReason(LIST[3], counts(0)), null);
  assert.equal(hideBlockReason(undefined, counts(3)), null);
});

test('deleteBlockReason: только скрытый товар и только если на витрине есть видимые', () => {
  const counts = (visible) => ({ total: 5, visible, hidden: 1, damaged: 0 });
  assert.equal(deleteBlockReason(LIST[0], counts(3)), 'not-hidden');
  assert.equal(deleteBlockReason(LIST[3], counts(3)), null);
  assert.equal(deleteBlockReason(LIST[3], counts(1)), null);
  assert.equal(deleteBlockReason(LIST[3], counts(0)), 'last-visible');
  assert.equal(deleteBlockReason({ ...LIST[0], hidden: undefined }, counts(3)), 'not-hidden');
});

test('replaceListProduct: строка обновляется на месте, повреждённый документ после исправления уходит из списка ошибок', () => {
  const data = { products: LIST, invalidIds: ['broken'] };
  const hiddenRose = { ...LIST[0], hidden: true, updatedAt: '2026-11-02T12:00:00.000Z' };
  const next = replaceListProduct(data, hiddenRose);
  assert.deepEqual(ids(next.products), ids(LIST)); // порядок тот же
  assert.equal(next.products[0], hiddenRose);
  assert.deepEqual(next.invalidIds, ['broken']);
  assert.equal(LIST[0].hidden, false); // исходный список не изменён
  assert.deepEqual(countProductVisibility(next), { total: 5, visible: 2, hidden: 2, damaged: 1 });

  const fixed = replaceListProduct(data, P('broken', 'Исправлен', 'X'));
  assert.deepEqual(fixed.invalidIds, []);
  assert.equal(fixed.products.length, LIST.length + 1);
});

test('removeListProduct: товар убирается из списка и из повреждённых, счётчики уменьшаются', () => {
  const data = { products: LIST, invalidIds: ['broken'] };
  const next = removeListProduct(data, 'berry-kiss');
  assert.deepEqual(ids(next.products), ['rose-poudree', 'oud-royal', 'ala-too-breeze']);
  assert.deepEqual(countProductVisibility(next), { total: 4, visible: 3, hidden: 0, damaged: 1 });
  assert.deepEqual(removeListProduct(data, 'broken').invalidIds, []);
  assert.equal(data.products.length, LIST.length); // исходный список не изменён
});

test('applyFetchedProduct: строка после повторного чтения — обновлена, повреждена или удалена', () => {
  const data = { products: LIST, invalidIds: [] };
  // Скрыли — свежая строка с новой датой; порядок и остальные строки не меняются
  const fresh = { ...LIST[0], hidden: true, updatedAt: '2026-11-02T12:00:00.000Z' };
  const hiddenNow = applyFetchedProduct(data, fresh.id, { product: fresh, damaged: false });
  assert.deepEqual(ids(hiddenNow.products), ids(LIST));
  assert.equal(hiddenNow.products[0].updatedAt, '2026-11-02T12:00:00.000Z');
  assert.deepEqual(countProductVisibility(hiddenNow), { total: 4, visible: 2, hidden: 2, damaged: 0 });
  // Товар удалили в другом окне
  const gone = applyFetchedProduct(data, 'oud-royal', null);
  assert.deepEqual(ids(gone.products), ['rose-poudree', 'ala-too-breeze', 'berry-kiss']);
  // Документ повредили в другом окне — строка переходит в список повреждённых (без повторов)
  const broken = applyFetchedProduct(data, 'oud-royal', { product: { id: 'oud-royal', name: 'x' }, damaged: true });
  assert.deepEqual(broken.invalidIds, ['oud-royal']);
  assert.equal(broken.products.length, 3);
  assert.deepEqual(applyFetchedProduct(broken, 'oud-royal', { product: {}, damaged: true }).invalidIds, ['oud-royal']);
  // Список перезагружается (null) — ничего не делаем
  assert.equal(applyFetchedProduct(null, 'oud-royal', null), null);
  assert.equal(LIST.length, 4);
});

test('скрытие при фильтре «На витрине» убирает строку, показ при фильтре «Скрытые» — тоже', () => {
  const data = { products: LIST, invalidIds: [] };
  const view = (d, visibility) => ids(filterAdminProducts(d.products, { ...DEFAULT_PRODUCT_FILTERS, visibility }));
  assert.ok(view(data, 'visible').includes('rose-poudree'));
  const afterHide = applyFetchedProduct(data, 'rose-poudree', { product: { ...LIST[0], hidden: true }, damaged: false });
  assert.equal(view(afterHide, 'visible').includes('rose-poudree'), false);
  assert.ok(view(afterHide, 'hidden').includes('rose-poudree'));

  const afterShow = applyFetchedProduct(data, 'berry-kiss', { product: { ...LIST[3], hidden: false }, damaged: false });
  assert.deepEqual(view(afterShow, 'hidden'), []);
  assert.ok(view(afterShow, 'visible').includes('berry-kiss'));
  // Счётчики и блокировка кнопки согласованы с тем же списком
  const lastOne = { products: [LIST[0], LIST[3]], invalidIds: [] };
  assert.equal(hideBlockReason(LIST[0], countProductVisibility(lastOne)), 'last-visible');
  const twoVisible = applyFetchedProduct(lastOne, 'berry-kiss', { product: { ...LIST[3], hidden: false }, damaged: false });
  assert.equal(hideBlockReason(LIST[0], countProductVisibility(twoVisible)), null);
});

// ---------- Страница списка ----------

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

const VISIBILITY_ERRORS = ['conflict', 'not-found', 'damaged', 'last-visible', 'denied', 'network', 'not-configured', 'invalid', 'failed'];

test('страница «Товары»: все ключи переводов есть в ru, ky и en', () => {
  const page = read('src/pages/admin/AdminProductsPage.jsx');
  const keys = new Set([...page.matchAll(/\bt\('([a-zA-Z0-9_.-]+)'/g)].map((m) => m[1]));
  PRODUCT_SORTS.forEach((s) => keys.add(`admin.products.sort.${s}`));
  CATEGORIES.forEach((c) => keys.add(`categories.${c}`));
  FAMILIES.forEach((f) => keys.add(`families.${f}`));
  AVAILABILITIES.forEach((a) => keys.add(`availability.${a}`));
  ['failed', 'network', 'denied', 'not-configured', 'not-empty', 'invalid'].forEach((e) => keys.add(`admin.products.errors.${e}`));
  // Ключи с подстановкой (`...${v}`) — перечисляем явно
  ['all', ...PRODUCT_VISIBILITIES].forEach((v) => keys.add(`admin.products.visibility.${v}`));
  ['hide', 'show'].forEach((a) => {
    keys.add(`admin.products.visibilityAction.${a}`);
    keys.add(`admin.products.visibilityBusy.${a}`);
  });
  VISIBILITY_ERRORS.forEach((e) => keys.add(`admin.products.visibilityErrors.${e}`));
  ['hiddenDone', 'shownDone'].forEach((k) => keys.add(`admin.products.${k}`));
  assert.ok(keys.size > 60);
  for (const lang of ['ru', 'ky', 'en']) {
    const dict = JSON.parse(read(`src/locales/${lang}/translation.json`));
    const missing = [...keys].filter((k) => typeof get(dict, k) !== 'string');
    assert.deepEqual(missing, [], lang);
    // Сообщения о товаре называют его: {{name}} есть во всех текстах, кроме not-configured
    VISIBILITY_ERRORS.filter((e) => e !== 'not-configured').forEach((e) =>
      assert.match(get(dict, `admin.products.visibilityErrors.${e}`), /\{\{name\}\}/, `${lang}: ${e}`),
    );
    ['hiddenDone', 'shownDone'].forEach((k) => assert.match(dict.admin.products[k], /\{\{name\}\}/, `${lang}: ${k}`));
    // Старые ключи сводки удалены, упоминаний будущего этапа в подсказке нет
    assert.equal(dict.admin.products.inFirestore, undefined, lang);
    assert.doesNotMatch(dict.admin.products.hiddenHint, /5в|5v|5c/, lang);
  }
});

test('страница «Товары»: параметры в адресе, ссылки на форму, скрытие — через setProductHidden, удаления нет', () => {
  const page = read('src/pages/admin/AdminProductsPage.jsx');
  assert.match(page, /parseProductListParams\(searchParams\)/);
  assert.match(page, /setSearchParams\(toProductListParams\(/);
  assert.match(page, /to="\/admin\/products\/new"/);
  assert.match(page, /\/admin\/products\/\$\{id\}\/edit/);
  assert.match(page, /fetchAllProducts\(\)/);
  // Видимость: сервис из 5в.1 с датой строки, затем перечитывание строки (свежий updatedAt)
  assert.match(page, /setProductHidden\(product\.id, hidden, product\.updatedAt\)/);
  assert.match(page, /fetchProductForEdit\(id\)/);
  assert.match(page, /applyFetchedProduct\(/);
  assert.match(page, /hideBlockReason\(p, counts\)/);
  assert.match(page, /disabled=\{Boolean\(busyId\) \|\| Boolean\(blocked\)\}/);
  assert.match(page, /if \(busyId\) return;/);
  assert.match(page, /dispatch\(fetchProducts\(\)\)/);
  // Окончательное удаление — отдельный подэтап (страница редактирования)
  assert.doesNotMatch(page, /deleteDoc|deleteProduct|removeListProduct/);
});

// ---------- Окончательное удаление (подэтап 5в.4) ----------

test('deleteBlockReason без счётчиков (страница товара): только not-hidden, last-visible проверяет сервис', () => {
  assert.equal(deleteBlockReason(LIST[3], null), null);
  assert.equal(deleteBlockReason(LIST[3], undefined), null);
  assert.equal(deleteBlockReason(LIST[0], null), 'not-hidden');
  assert.equal(deleteBlockReason({ ...LIST[3], hidden: undefined }, null), 'not-hidden');
  assert.equal(deleteBlockReason(null, null), null);
});

test('isDeleteConfirmed: нужен точный ID с учётом регистра; пробелы по краям не мешают', () => {
  const id = 'rose-poudree';
  assert.equal(isDeleteConfirmed('rose-poudree', id), true);
  assert.equal(isDeleteConfirmed('  rose-poudree\n', id), true);
  ['', '   ', 'rose', 'rose-poudre', 'rose-poudree-', 'Rose-Poudree', 'ROSE-POUDREE', 'rose poudree', 'rose-poudree x'].forEach(
    (input) => assert.equal(isDeleteConfirmed(input, id), false, input),
  );
  assert.equal(isDeleteConfirmed(undefined, id), false);
  assert.equal(isDeleteConfirmed(null, id), false);
  // Пустой ID товара не подтверждается ничем
  assert.equal(isDeleteConfirmed('', ''), false);
  assert.equal(isDeleteConfirmed('x', undefined), false);
});

test('buildProductBackup: все поля документа, Timestamp → ISO-строка, исходные данные не меняются', () => {
  const ts = { toDate: () => new Date('2026-10-01T10:00:00Z') };
  const raw = {
    id: 'rose-poudree',
    name: 'Rose Poudrée',
    brand: 'Maison',
    hidden: true,
    volumes: [
      { ml: 50, price: 5900 },
      { ml: 100, price: 8900 },
    ],
    notes: { top: ['rose'], heart: [], base: ['musk'] },
    rating: 4.7,
    isNew: false,
    updatedAt: ts,
  };
  const backup = buildProductBackup('rose-poudree', raw, new Date('2026-11-02T08:30:00Z'));
  assert.equal(backup.format, PRODUCT_BACKUP_FORMAT);
  assert.equal(backup.version, 1);
  assert.equal(backup.collection, 'products');
  assert.equal(backup.id, 'rose-poudree');
  assert.equal(backup.exportedAt, '2026-11-02T08:30:00.000Z');
  assert.deepEqual(backup.document, { ...raw, updatedAt: '2026-10-01T10:00:00.000Z' });
  assert.equal(raw.updatedAt, ts); // исходный документ не изменён
  assert.notEqual(backup.document.volumes, raw.volumes); // копия, а не ссылка
  // Копия — обычный JSON: после записи в файл и чтения данные те же
  assert.deepEqual(JSON.parse(JSON.stringify(backup)), backup);
  // Документ без данных (на всякий случай) — пустой объект, а не ошибка
  assert.deepEqual(buildProductBackup('x', undefined, new Date(0)).document, {});
});

test('productBackupFileName: product-<id>-<дата>.json', () => {
  assert.equal(productBackupFileName('rose-poudree', new Date('2026-11-02T23:00:00Z')), 'product-rose-poudree-2026-11-02.json');
});

test('deleteErrorAction: что предложить после ошибки удаления', () => {
  assert.equal(deleteErrorAction('conflict'), 'reload');
  assert.equal(deleteErrorAction('not-hidden'), 'reload');
  assert.equal(deleteErrorAction('not-found'), 'list');
  assert.equal(deleteErrorAction('denied'), null);
  assert.equal(deleteErrorAction('last-visible'), null);
  assert.equal(deleteErrorAction('not-configured'), null);
  assert.equal(deleteErrorAction('network'), 'retry');
  assert.equal(deleteErrorAction('failed'), 'retry');
  assert.equal(deleteErrorAction('something-new'), 'retry');
});

const DELETE_ERRORS = ['conflict', 'not-hidden', 'not-found', 'last-visible', 'denied', 'network', 'not-configured', 'failed'];

test('переводы окна удаления: одинаковые ключи на ru, ky, en; тексты всех ошибок deleteProduct', () => {
  const keys = (obj, prefix = '') =>
    Object.entries(obj).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
  const dicts = Object.fromEntries(
    ['ru', 'ky', 'en'].map((lang) => [lang, JSON.parse(read(`src/locales/${lang}/translation.json`))]),
  );
  const ruKeys = keys(dicts.ru.admin.productDelete).sort();
  for (const [lang, dict] of Object.entries(dicts)) {
    const block = dict.admin.productDelete;
    assert.ok(block, lang);
    assert.deepEqual(keys(block).sort(), ruKeys, lang);
    keys(block).forEach((k) => assert.ok(String(k.split('.').reduce((o, x) => o[x], block)).trim(), `${lang}: ${k}`));
    DELETE_ERRORS.forEach((e) => assert.ok(block.errors[e], `${lang}: errors.${e}`));
    assert.match(block.done, /\{\{name\}\}/, lang);
    assert.match(block.downloaded, /\{\{file\}\}/, lang);
    // Подсказка не обещает «этап 5в» и ведёт к блоку видимости на этой же странице, а не в список
    assert.doesNotMatch(block.blockedNotHidden, /5в|5v|5c/, lang);
    assert.equal(dict.admin.productForm.hiddenNote, undefined, lang);
  }
});

test('страница товара: удаление только скрытого, deleteProduct с updatedAt формы, возврат к списку', () => {
  const page = read('src/pages/admin/AdminProductFormPage.jsx');
  assert.match(page, /deleteProduct\(routeId, loaded\.updatedAt\)/);
  assert.match(page, /deleteBlockReason\(loaded\.product, null\)/);
  assert.match(page, /disabled=\{Boolean\(blocked\) \|\| saving \|\| deleting \|\| toggling\}/);
  // После удаления: уведомление, свежая витрина, список без вопроса о несохранённых изменениях
  assert.match(page, /notify\(\{ message: 'admin\.productDelete\.done'/);
  assert.match(page, /dispatch\(fetchProducts\(\)\)/);
  assert.match(page, /navigate\(listPath, \{ replace: true \}\)/);
  assert.match(page, /useUnsavedChangesPrompt\(dirty && !saving && !deleting/);
  // Окно получает исходный документ для JSON-копии
  assert.match(page, /raw=\{loaded\.raw\}/);
  // Удаляется только товар: ни заказов, ни прямых вызовов Firestore
  assert.doesNotMatch(page, /deleteDoc|orders|firebase\/firestore/);
});

test('окно удаления: копия и точный ID обязательны, фокус на «Отмене», Escape закрывает', () => {
  const dialog = read('src/components/admin/DeleteProductDialog.jsx');
  assert.match(dialog, /role="alertdialog"/);
  assert.match(dialog, /aria-modal="true"/);
  assert.match(dialog, /const confirmed = isDeleteConfirmed\(typedId, product\.id\)/);
  assert.match(dialog, /const canDelete = downloaded && confirmed && !deleting/);
  assert.match(dialog, /disabled=\{!canDelete/);
  assert.match(dialog, /if \(canDelete\) onConfirm\(\)/);
  assert.match(dialog, /cancelRef\.current\?\.focus\(\)/);
  assert.match(dialog, /ref=\{cancelRef\}/);
  assert.match(dialog, /e\.key === 'Escape'/);
  assert.match(dialog, /if \(!deleting\) onCancel\(\)/);
  assert.match(dialog, /buildProductBackup\(product\.id, raw\)/);
  // Название, бренд и ID товара на виду
  assert.match(dialog, /\{product\.name/);
  assert.match(dialog, /\{product\.brand/);
  assert.match(dialog, /<code>\{product\.id\}<\/code>/);
  // Список товаров в 5в.4 не меняется: удаление — только со страницы товара
  assert.doesNotMatch(read('src/pages/admin/AdminProductsPage.jsx'), /deleteProduct\(/);
});

// ---------- Видимость на странице товара (подэтап 5в.5) ----------

test('productVisibilityState: состояние, действие и причина блокировки', () => {
  assert.deepEqual(productVisibilityState({ product: { hidden: false } }), {
    status: 'visible',
    action: 'hide',
    blocked: null,
  });
  assert.deepEqual(productVisibilityState({ product: { hidden: true } }), {
    status: 'hidden',
    action: 'show',
    blocked: null,
  });
  // Видим только hidden === false, как в запросе витрины
  assert.equal(productVisibilityState({ product: {} }).status, 'hidden');
  // Несохранённые изменения важнее «занято»: администратору объясняют, что делать
  assert.equal(productVisibilityState({ product: { hidden: false }, dirty: true }).blocked, 'dirty');
  assert.equal(productVisibilityState({ product: { hidden: true }, dirty: true, busy: true }).blocked, 'dirty');
  assert.equal(productVisibilityState({ product: { hidden: true }, busy: true }).blocked, 'busy');
  // Повреждённый документ: кнопки нет, сначала исправить форму
  for (const args of [{ product: { hidden: false }, damaged: true }, { product: null }]) {
    assert.deepEqual(productVisibilityState(args), { status: 'damaged', action: null, blocked: 'damaged' });
  }
});

test('visibilityErrorAction: что предложить после ошибки видимости', () => {
  assert.equal(visibilityErrorAction('conflict'), 'reload');
  assert.equal(visibilityErrorAction('damaged'), 'reload');
  assert.equal(visibilityErrorAction('not-found'), 'list');
  for (const code of ['last-visible', 'denied', 'network', 'not-configured', 'invalid', 'failed', 'other', null]) {
    assert.equal(visibilityErrorAction(code), null, String(code));
  }
});

// Коды ошибок setProductHidden — тот же список VISIBILITY_ERRORS, что у списка товаров
test('переводы блока видимости: одинаковые ключи на ru, ky, en; все состояния и ошибки setProductHidden', () => {
  const keys = (obj, prefix = '') =>
    Object.entries(obj).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
  const dicts = Object.fromEntries(
    ['ru', 'ky', 'en'].map((lang) => [lang, JSON.parse(read(`src/locales/${lang}/translation.json`))]),
  );
  const ruKeys = keys(dicts.ru.admin.productVisibility).sort();
  for (const [lang, dict] of Object.entries(dicts)) {
    const block = dict.admin.productVisibility;
    assert.ok(block, lang);
    assert.deepEqual(keys(block).sort(), ruKeys, lang);
    keys(block).forEach((k) => assert.ok(String(k.split('.').reduce((o, x) => o[x], block)).trim(), `${lang}: ${k}`));
    for (const s of ['visible', 'hidden', 'damaged']) {
      assert.ok(block.status[s], `${lang}: status.${s}`);
      assert.ok(block.text[s], `${lang}: text.${s}`);
    }
    for (const a of ['hide', 'show']) {
      assert.ok(block.action[a], `${lang}: action.${a}`);
      assert.ok(block.busy[a], `${lang}: busy.${a}`);
    }
    assert.ok(block.dirtyHint, lang);
    VISIBILITY_ERRORS.forEach((e) => assert.ok(block.errors[e], `${lang}: errors.${e}`));
    // Уведомления об успехе — те же, что в списке
    assert.match(dict.admin.products.hiddenDone, /\{\{name\}\}/, lang);
    assert.match(dict.admin.products.shownDone, /\{\{name\}\}/, lang);
  }
});

test('страница товара: видимость через setProductHidden с updatedAt формы, блокировки и обновление витрины', () => {
  const page = read('src/pages/admin/AdminProductFormPage.jsx');
  // Существующая функция сервиса, без прямых вызовов Firestore
  assert.match(page, /setProductHidden\(routeId, hidden, loaded\.updatedAt\)/);
  assert.doesNotMatch(page, /firebase\/firestore|updateDoc|setDoc/);
  // Несохранённые изменения, другое действие и повторное нажатие блокируют кнопку
  assert.match(page, /productVisibilityState\(\{\s*product: loaded\.product,\s*damaged: loaded\.damaged,\s*dirty,\s*busy: saving \|\| deleting \|\| toggling,/);
  assert.match(page, /if \(toggling \|\| saving \|\| deleting \|\| !state\.action \|\| state\.blocked\) return;/);
  assert.match(page, /admin\.productVisibility\.dirtyHint/);
  assert.match(page, /aria-busy=\{toggling \|\| undefined\}/);
  // Во время переключения не сохраняется форма
  assert.match(page, /if \(saving \|\| toggling\) return;/);
  // Успех: свежий документ (новая дата), уведомление, витрина перечитывается
  assert.match(page, /await refreshAfterToggle\(hidden\)/);
  assert.match(page, /'admin\.products\.hiddenDone' : 'admin\.products\.shownDone'/);
  assert.match(page, /admin\.productVisibility\.errors\.\$\{visibilityError\}/);
  assert.match(page, /visibilityErrorAction\(visibilityError\)/);
  // Форма после переключения не перезаписывается: только loaded
  const refresh = page.slice(page.indexOf('const refreshAfterToggle'), page.indexOf('const handleToggleHidden'));
  assert.doesNotMatch(refresh, /setForm|setInitial/);
  // Список товаров по-прежнему переключает видимость сам
  assert.match(read('src/pages/admin/AdminProductsPage.jsx'), /setProductHidden\(product\.id, hidden, product\.updatedAt\)/);
});

// ---------- Локализация, оформление и документация видимости и удаления (подэтап 5в.6) ----------

const LANGS = ['ru', 'ky', 'en'];
const dictOf = (lang) => JSON.parse(read(`src/locales/${lang}/translation.json`));
const stringsOf = (obj) => (typeof obj === 'string' ? [obj] : Object.values(obj).flatMap(stringsOf));

test('переводы видимости и удаления: единые термины «Скрыть», «Показать», «На витрине», «Удалить навсегда», «Скачать JSON-копию»', () => {
  const terms = {
    ru: { hide: 'Скрыть', show: 'Показать', visible: 'На витрине', confirm: 'Удалить навсегда', download: 'Скачать JSON-копию' },
    ky: { hide: 'Жашыруу', show: 'Көрсөтүү', visible: 'Витринада', confirm: 'Биротоло өчүрүү', download: 'JSON-көчүрмөнү жүктөп алуу' },
    en: { hide: 'Hide', show: 'Show', visible: 'In the store', confirm: 'Delete permanently', download: 'Download JSON backup' },
  };
  const stems = { ru: /^(Скрыть|Показать)/, ky: /(жашыруу|көрсөтүү)$/i, en: /^(Hide|Show)/ };
  for (const lang of LANGS) {
    const { admin } = dictOf(lang);
    const tr = terms[lang];
    assert.equal(admin.products.visibilityAction.hide, tr.hide, lang);
    assert.equal(admin.products.visibilityAction.show, tr.show, lang);
    // Кнопки страницы товара — те же глаголы, что в списке (без «Вернуть на витрину»)
    assert.match(admin.productVisibility.action.hide, stems[lang], `${lang}: action.hide`);
    assert.match(admin.productVisibility.action.show, stems[lang], `${lang}: action.show`);
    assert.equal(admin.productVisibility.busy.show, admin.products.visibilityBusy.show, `${lang}: busy.show`);
    assert.equal(admin.productVisibility.busy.hide, admin.products.visibilityBusy.hide, `${lang}: busy.hide`);
    // «На витрине» — одно и то же в сводке, фильтре и значке статуса
    assert.equal(admin.products.summary.visible, tr.visible, lang);
    assert.equal(admin.products.visibility.visible, tr.visible, lang);
    assert.equal(admin.productVisibility.status.visible, tr.visible, lang);
    // Скрытый товар: значок в списке и на странице товара совпадает
    assert.equal(admin.productVisibility.status.hidden, admin.products.hidden, lang);
    assert.equal(admin.productDelete.confirm, tr.confirm, lang);
    assert.equal(admin.productDelete.download, tr.download, lang);
    // Одинаковый текст «Firebase не подключён» во всех блоках этапа
    const nc = new Set([
      admin.products.visibilityErrors['not-configured'],
      admin.productVisibility.errors['not-configured'],
      admin.productDelete.errors['not-configured'],
    ]);
    assert.equal(nc.size, 1, `${lang}: not-configured`);
  }
  // Старый термин «вернуть на витрину» в кнопках не используется
  assert.doesNotMatch(JSON.stringify(dictOf('ru').admin.productVisibility), /Вернуть на витрину|Возвращаем|верните на витрину/);
  assert.doesNotMatch(JSON.stringify(dictOf('en').admin.productVisibility), /Return to store|Returning|Return another/);
  assert.doesNotMatch(JSON.stringify(dictOf('ky').admin.productVisibility), /Витринага кайтаруу|Кайтарылууда/);
});

test('переводы видимости и удаления: нет ссылок на этапы разработки, ky пишет Firestore’дон/’до единообразно', () => {
  for (const lang of LANGS) {
    const { admin } = dictOf(lang);
    // admin.products.errors — ошибки загрузки списка из этапа 5а («правила этапа 5а»), к 5в не относятся
    const { errors: _loadErrors, ...productsTexts } = admin.products;
    const texts = [
      ...stringsOf(productsTexts),
      ...stringsOf(admin.productVisibility),
      ...stringsOf(admin.productDelete),
      ...stringsOf(admin.productForm),
    ];
    for (const s of texts) {
      assert.doesNotMatch(s, /5в|5c|5v|этап|stage|появится на|will arrive/i, `${lang}: ${s}`);
    }
    if (lang === 'ky') texts.forEach((s) => assert.doesNotMatch(s, /Firestore[а-яөүң]/, s));
  }
});

test('окно удаления: текст о корзинах и избранном соответствует поведению (товар убирается, а не «недоступен»)', () => {
  const ru = dictOf('ru').admin.productDelete.factCarts;
  assert.match(ru, /будет убран/);
  // Не обещает, что товар сам вернётся в корзину после восстановления: корзина очищается
  assert.doesNotMatch(ru, /появится там снова/);
  assert.doesNotMatch(ru, /недоступ/);
  assert.doesNotMatch(dictOf('en').admin.productDelete.factCarts, /unavailable/);
  // Корзина действительно пропускает товар, которого нет в каталоге витрины
  assert.match(read('src/utils/cart.js'), /if \(!product\) return;/);
  assert.match(read('src/features/favorites/favoritesSlice.js'), /\.filter\(Boolean\)/);
  assert.match(read('src/features/cart/cartSlice.js'), /pruneCartItems\(state\.items, action\.payload\.items\)/);
});

test('окно удаления: фокус не уходит за пределы окна, ошибка получает фокус', () => {
  const dialog = read('src/components/admin/DeleteProductDialog.jsx');
  // Tab и Shift+Tab возвращают фокус в окно, если он оказался снаружи (кнопка стала disabled)
  assert.match(dialog, /const outside = !dialogRef\.current\.contains\(document\.activeElement\)/);
  assert.match(dialog, /e\.shiftKey && \(document\.activeElement === first \|\| outside\)/);
  assert.match(dialog, /!e\.shiftKey && \(document\.activeElement === last \|\| outside\)/);
  assert.match(dialog, /errorRef\.current\.focus\(\{ preventScroll: true \}\)/);
  assert.match(dialog, /role="alert" tabIndex=\{-1\}/);
  // Кнопка «Отмена» — первая в DOM-порядке действий, на ней фокус при открытии
  assert.match(dialog, /ref=\{cancelRef\}/);
});

test('страница товара: «К списку» после ошибки удаления не спрашивает о несохранённых изменениях', () => {
  const page = read('src/pages/admin/AdminProductFormPage.jsx');
  const start = page.indexOf('onBackToList={');
  assert.ok(start > 0);
  const handler = page.slice(start, page.indexOf('/>', start));
  assert.match(handler, /setInitial\(JSON\.stringify\(form\)\)/);
  assert.match(handler, /navigate\(listPath, \{ replace: true \}\)/);
});

test('оформление видимости и удаления: стили есть, цвета — только переменные темы (светлая и тёмная)', () => {
  const css = read('src/styles/admin.css');
  const classes = [
    'admin-products__actions',
    'admin-products__action-error',
    'admin-products__damaged-count',
    'admin-product-visibility',
    'admin-product-visibility__btn',
    'admin-product-visibility__error',
    'admin-badge--visible',
    'admin-badge--damaged',
    'admin-product-delete',
    'admin-product-delete__btn',
    'admin-delete-dialog',
    'admin-delete-dialog__confirm',
    'admin-delete-dialog__actions',
  ];
  classes.forEach((c) => assert.match(css, new RegExp(`\\.${c}\\b`), c));
  const block = css.slice(css.indexOf('.admin-products__actions {'));
  // Никаких жёстко заданных цветов: тёмная тема меняет переменные в variables.css
  assert.doesNotMatch(block, /#[0-9a-f]{3,8}\b|rgba?\(/i);
  const vars = read('src/styles/variables.css');
  const dark = vars.slice(vars.indexOf("[data-theme='dark']"));
  ['--error', '--error-bg', '--warning', '--warning-bg', '--success', '--success-bg', '--surface'].forEach((v) =>
    assert.match(dark, new RegExp(`${v}:`), `dark ${v}`),
  );
  // Телефоны: кнопки во всю ширину, «Отмена» под «Удалить навсегда» не уходит за край
  const mobile = css.slice(css.lastIndexOf('@media (max-width: 640px)'));
  assert.match(mobile, /\.admin-delete-dialog__actions \{\s*flex-direction: column-reverse;/);
  assert.match(mobile, /\.admin-product-visibility__btn/);
});

test('ADMIN_SETUP.md: раздел о видимости и удалении, без обещаний будущих этапов', () => {
  const doc = read('docs/ADMIN_SETUP.md');
  assert.match(doc, /## 7\. Товары: видимость на витрине и удаление/);
  for (const heading of [
    '### Счётчики и фильтр видимости',
    '### Как скрыть товар',
    '### Как вернуть товар на витрину',
    '### Как окончательно удалить товар',
    '### Зачем нужна JSON-копия',
    '### Ограничения при удалении',
    '### Что происходит с заказами, корзинами и избранным',
    '### Демо-каталог не подменяет ваш каталог',
  ]) {
    assert.ok(doc.includes(heading), heading);
  }
  // Названия кнопок в документации совпадают с интерфейсом
  const ru = dictOf('ru').admin;
  for (const label of [
    ru.products.visibilityAction.hide,
    ru.products.visibilityAction.show,
    ru.productVisibility.action.hide,
    ru.productVisibility.action.show,
    ru.productDelete.open,
    ru.productDelete.download,
    ru.productDelete.confirm,
  ]) {
    assert.ok(doc.includes(`«${label}»`), label);
  }
  assert.match(doc, /\?visibility=visible/);
  assert.doesNotMatch(doc, /появ\S* на этап\S* 5в|этапах 5б–5в|полное удаление — этап 5в/);
});
