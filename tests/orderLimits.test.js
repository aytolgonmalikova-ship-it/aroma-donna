// C3.3, этап 1: общий список регионов (src/data/regions.js) и общие ограничения заказа
// (src/utils/orderLimits.js). Поведение формы оформления заказа не меняется. Запуск: npm test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REGIONS, isKnownRegionCity } from '../src/data/regions.js';
import { ORDER_LIMITS, isValidOrderLineCount, isValidOrderQuantity, isWithinLength } from '../src/utils/orderLimits.js';
import { MAX_QUANTITY } from '../src/utils/cart.js';
import { validateCheckout } from '../src/utils/validation.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const ROOT = new URL('..', import.meta.url).pathname;

// Тот же список, что был в CheckoutForm.jsx до переноса (порядок регионов и городов — порядок в форме)
const BEFORE = {
  bishkek: ['bishkek'],
  chui: ['tokmok'],
  osh: ['osh'],
  jalalabad: ['jalalabad'],
  issykkul: ['karakol', 'cholponata'],
  naryn: ['naryn'],
  talas: ['talas'],
  batken: ['batken'],
};

test('регионы: перенесены без изменений, порядок тот же; у каждого есть переводы на трёх языках', () => {
  assert.deepEqual(REGIONS, BEFORE);
  assert.deepEqual(Object.keys(REGIONS), Object.keys(BEFORE));
  for (const lang of ['ru', 'ky', 'en']) {
    const dict = JSON.parse(read(`src/locales/${lang}/translation.json`));
    for (const [region, cities] of Object.entries(REGIONS)) {
      assert.ok(dict.regions[region], `${lang}: regions.${region}`);
      for (const city of cities) assert.ok(dict.cities[city], `${lang}: cities.${city}`);
    }
  }
});

test('isKnownRegionCity: только существующая пара регион–город; служебные ключи объекта не проходят', () => {
  assert.equal(isKnownRegionCity('bishkek', 'bishkek'), true);
  assert.equal(isKnownRegionCity('issykkul', 'cholponata'), true);
  assert.equal(isKnownRegionCity('issykkul', 'osh'), false, 'город из другого региона');
  assert.equal(isKnownRegionCity('moscow', 'moscow'), false);
  for (const bad of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) assert.equal(isKnownRegionCity(bad, 'length'), false, bad);
  for (const [r, c] of [[null, 'osh'], ['osh', null], [1, 'osh'], ['osh', ['osh']], ['', '']]) assert.equal(isKnownRegionCity(r, c), false);
});

test('форма оформления берёт регионы из общего модуля; своего списка в ней больше нет', () => {
  const form = read('src/components/forms/CheckoutForm.jsx');
  assert.match(form, /import \{ REGIONS \} from '\.\.\/\.\.\/data\/regions';/);
  assert.doesNotMatch(form, /const REGIONS\s*=/);
  // Использование не изменилось: смена региона подставляет первый город, списки строятся из REGIONS
  assert.ok(form.includes("if (name === 'region') next.city = REGIONS[value]?.[0] || '';"));
  assert.ok(form.includes('Object.keys(REGIONS).map((region) =>'));
  assert.ok(form.includes('(REGIONS[values.region] || []).map((city) =>'));
});

// Отрисовка формы (react-dom/server): те же регионы и города в том же порядке
async function loadForm() {
  const esbuild = await import('esbuild');
  const dir = mkdtempSync(join(tmpdir(), 'aroma-regions-'));
  try {
    const entry = join(dir, 'entry.jsx');
    writeFileSync(
      entry,
      `import { renderToStaticMarkup } from 'react-dom/server';
       import i18n from '${ROOT}src/i18n.js';
       import CheckoutForm from '${ROOT}src/components/forms/CheckoutForm.jsx';
       export { i18n };
       export const form = (values, delivery = 'regions') =>
         renderToStaticMarkup(<CheckoutForm initialValues={values} deliveryMethod={delivery} onDeliveryChange={() => {}} onSubmit={() => {}} onCancel={() => {}} submitting={false} totalLabel="1 000" />);`,
    );
    const outfile = join(dir, 'bundle.mjs');
    await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile,
      jsx: 'automatic',
      loader: { '.js': 'jsx', '.css': 'empty' },
      logLevel: 'silent',
      nodePaths: [join(ROOT, 'node_modules')],
      define: { 'import.meta.env': '{}' },
      banner: { js: "globalThis.document ??= { documentElement: { setAttribute() {} }, title: '' }; globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} }; import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
    });
    return await import(pathToFileURL(outfile).href);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('форма показывает те же регионы и города в том же порядке (ru)', async () => {
  const app = await loadForm();
  await app.i18n.changeLanguage('ru');
  const options = (html, id) => {
    const select = html.slice(html.indexOf(`<select id="${id}"`), html.indexOf('</select>', html.indexOf(`<select id="${id}"`)));
    return [...select.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
  };
  const html = app.form({ region: 'issykkul', city: 'karakol' });
  assert.deepEqual(options(html, 'co-region'), Object.keys(BEFORE));
  assert.deepEqual(options(html, 'co-city'), ['karakol', 'cholponata']);
  // Курьер по Бишкеку: регион и город доступны (другой регион переключает доставку на «по регионам»)
  const courier = app.form({}, 'courier');
  for (const id of ['co-region', 'co-city']) assert.doesNotMatch(courier.match(new RegExp(`<select id="${id}"[^>]*>`))[0], /disabled/, id);
  assert.deepEqual(options(courier, 'co-city'), ['bishkek']);
  const form = readFileSync(join(ROOT, 'src/components/forms/CheckoutForm.jsx'), 'utf8');
  assert.match(form, /name === 'region' && values\.delivery === 'courier' && value !== 'bishkek'/);
  assert.match(form, /if \(leavesCourier\) onDeliveryChange\('regions'\)/);
});

test('ограничения заказа: 20 позиций, 10 штук (та же константа, что в корзине), длины полей', () => {
  assert.equal(ORDER_LIMITS.maxLines, 20);
  assert.equal(ORDER_LIMITS.maxQuantity, 10);
  assert.equal(ORDER_LIMITS.maxQuantity, MAX_QUANTITY, 'не расходится с корзиной');
  assert.ok(Object.isFrozen(ORDER_LIMITS));
  // Комментарий — как maxLength поля в форме
  assert.match(read('src/components/forms/CheckoutForm.jsx'), new RegExp(`maxLength=\\{${ORDER_LIMITS.commentMax}\\}`));
  for (const key of ['nameMax', 'lastNameMax', 'emailMax', 'addressMax', 'commentMax', 'promoCodeMax']) {
    assert.ok(Number.isInteger(ORDER_LIMITS[key]) && ORDER_LIMITS[key] > 0, key);
  }
  assert.equal(ORDER_LIMITS.emailMax, 254);
});

test('минимальные длины совпадают с проверкой формы (validateCheckout не изменился)', () => {
  const base = { name: 'Айгерим', lastName: 'Асанова', phone: '700123456', email: 'a@mail.com', delivery: 'courier', region: 'bishkek', city: 'bishkek', address: 'ул. Токтогула, 12', agree: true };
  assert.deepEqual(validateCheckout(base), {});
  const short = (n) => 'А'.repeat(n);
  assert.equal(validateCheckout({ ...base, name: short(ORDER_LIMITS.nameMin - 1) }).name, 'validation.nameMin');
  assert.equal(validateCheckout({ ...base, name: short(ORDER_LIMITS.nameMin) }).name, undefined);
  assert.equal(validateCheckout({ ...base, lastName: short(ORDER_LIMITS.lastNameMin - 1) }).lastName, 'validation.lastNameMin');
  assert.equal(validateCheckout({ ...base, address: short(ORDER_LIMITS.addressMin - 1) }).address, 'validation.addressMin');
  assert.equal(validateCheckout({ ...base, address: short(ORDER_LIMITS.addressMin) }).address, undefined);
});

test('isValidOrderQuantity, isValidOrderLineCount, isWithinLength', () => {
  for (const ok of [1, 5, 10]) assert.equal(isValidOrderQuantity(ok), true, String(ok));
  for (const bad of [0, 11, -1, 1.5, '2', null, undefined, NaN, Infinity]) assert.equal(isValidOrderQuantity(bad), false, String(bad));
  for (const ok of [1, 20]) assert.equal(isValidOrderLineCount(ok), true);
  for (const bad of [0, 21, 2.5, '3']) assert.equal(isValidOrderLineCount(bad), false, String(bad));
  assert.equal(isWithinLength('  ab  ', 2, 2), true, 'пробелы по краям не считаются');
  assert.equal(isWithinLength('abc', 2), false);
  assert.equal(isWithinLength('', 10), true);
  assert.equal(isWithinLength('', 10, 1), false);
  for (const bad of [null, undefined, 5, ['a'], { length: 1 }]) assert.equal(isWithinLength(bad, 10), false);
});

test('модули — без React и браузерных API: подходят для серверной проверки заказа', () => {
  for (const file of ['src/data/regions.js', 'src/utils/orderLimits.js', 'src/utils/cart.js']) {
    const code = read(file).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(code, /\b(window|document|localStorage|sessionStorage|navigator|import\.meta)\b/, file);
    assert.doesNotMatch(code, /from ['"](react|react-dom|react-router-dom|react-i18next|firebase)/, file);
    assert.doesNotMatch(code, /from ['"][^'"]+\.jsx['"]/, file);
    // Импорты — с расширением .js (Node без сборщика)
    for (const [, spec] of code.matchAll(/from ['"](\.[^'"]+)['"]/g)) assert.match(spec, /\.js$/, `${file}: ${spec}`);
  }
});
