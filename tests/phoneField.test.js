// Тесты поля телефона (Блок 2, этап 2): проверка формы оформления, компонент PhoneField
// (отрисовка react-dom/server на трёх языках) и переводы. Поведение в браузере — tests-e2e/admins.e2e.mjs.
// Запуск: npm test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateCheckout } from '../src/utils/validation.js';
import { PHONE_ERRORS } from '../src/utils/phone.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const get = (obj, key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const dicts = Object.fromEntries(['ru', 'ky', 'en'].map((l) => [l, JSON.parse(read(`src/locales/${l}/translation.json`))]));
const ROOT = new URL('..', import.meta.url).pathname;
const LANGS = ['ru', 'ky', 'en'];

// Компоненты импортируют модули без расширений (как принято у Vite) — собираем через esbuild во временную папку
async function loadBundle() {
  const esbuild = await import('esbuild');
  const dir = mkdtempSync(join(tmpdir(), 'aroma-phone-'));
  try {
    const entry = join(dir, 'entry.jsx');
    writeFileSync(
      entry,
      `import { renderToStaticMarkup } from 'react-dom/server';
       import i18n from '${ROOT}src/i18n.js';
       import PhoneField from '${ROOT}src/components/common/PhoneField.jsx';
       import CheckoutForm from '${ROOT}src/components/forms/CheckoutForm.jsx';
       export { i18n };
       export const phoneField = (props) => renderToStaticMarkup(<PhoneField id="co-phone" name="phone" label="Телефон" required {...props} />);
       export const checkoutForm = (values = {}) =>
         renderToStaticMarkup(<CheckoutForm initialValues={values} deliveryMethod="courier" onDeliveryChange={() => {}} onSubmit={() => {}} onCancel={() => {}} submitting={false} totalLabel="1 000 сом" />);`,
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
    rmSync(dir, { recursive: true, force: true }); // модуль уже загружен в память
  }
}
const app = await loadBundle();

const CUSTOMER = {
  name: 'Айгерим',
  lastName: 'Асанова',
  phone: '700123456',
  email: 'a@mail.com',
  delivery: 'courier',
  region: 'bishkek',
  city: 'bishkek',
  address: 'ул. Токтогула, 12',
  agree: true,
};

test('validateCheckout: телефон — ровно 9 цифр после +996, один ключ ошибки', () => {
  for (const ok of ['700123456', '996123456', '555000000']) assert.equal(validateCheckout({ ...CUSTOMER, phone: ok }).phone, undefined, ok);
  assert.equal(validateCheckout({ ...CUSTOMER, phone: '' }).phone, 'validation.required');
  assert.equal(validateCheckout({ ...CUSTOMER, phone: '   ' }).phone, 'validation.required');
  for (const bad of ['70012345', '7001234567', '070012345', '+996700123456', '700 123 456', 'abcdefghi']) {
    assert.equal(validateCheckout({ ...CUSTOMER, phone: bad }).phone, 'validation.phone', bad);
  }
});

test('переводы: ошибки телефона и подписи есть на трёх языках, старые форматы в тексте не предлагаются', () => {
  const keys = ['form.phone', 'validation.phone', ...Object.values(PHONE_ERRORS)];
  for (const lang of LANGS) {
    for (const key of keys) {
      const text = get(dicts[lang], key);
      assert.ok(typeof text === 'string' && text.trim(), `${lang}: ${key}`);
    }
    assert.ok(get(dicts[lang], 'validation.phone').includes('+996'), lang);
    assert.ok(!get(dicts[lang], 'validation.phone').includes('0700'), `${lang}: формат с 0 больше не предлагается`);
  }
  // Тексты разные на разных языках (не скопированы)
  assert.notEqual(dicts.ru.validation.phoneForeign, dicts.en.validation.phoneForeign);
  assert.notEqual(dicts.ky.validation.phoneForeign, dicts.ru.validation.phoneForeign);
});

test('PhoneField: префикс +996 отдельно от поля; tel-клавиатура; в поле только 9 цифр группами', () => {
  const html = app.phoneField({ value: '700123456' });
  assert.match(html, /<label for="co-phone" class="phone-input__prefix">\+996<\/label>/, 'префикс — подпись поля, не текст в нём');
  const input = html.match(/<input [^>]*>/)[0];
  for (const attr of ['type="tel"', 'inputMode="tel"', 'autoComplete="tel"', 'id="co-phone"', 'name="phone"', 'value="700 123 456"', 'aria-invalid="false"', 'aria-required="true"']) {
    assert.ok(input.includes(attr), `${attr} в ${input}`);
  }
  assert.doesNotMatch(input, /maxLength/i, 'без maxLength: иначе браузер обрежет автозаполнение +996 …');
  assert.doesNotMatch(input, /\+996/, 'префикса нет внутри значения поля');
  // Подпись поля — первая, префикс — вторая: доступное имя «Телефон +996»
  assert.ok(html.indexOf('class="field__label"') < html.indexOf('phone-input__prefix'));
  // Пустое и неполное значение
  assert.match(app.phoneField({ value: '' }), /value=""/);
  assert.match(app.phoneField({ value: '7001' }), /value="700 1"/);
});

test('PhoneField: ошибка связана с полем через aria-describedby и переведена на трёх языках', async () => {
  for (const lang of LANGS) {
    await app.i18n.changeLanguage(lang);
    const html = app.phoneField({ value: '7001', error: 'validation.phone' });
    const input = html.match(/<input [^>]*>/)[0];
    assert.ok(input.includes('aria-invalid="true"') && input.includes('aria-describedby="co-phone-error"'), lang);
    assert.ok(html.includes(`<p id="co-phone-error" class="field__error" role="alert">${dicts[lang].validation.phone}</p>`), lang);
    assert.match(html, /class="field field--error"/);
  }
  await app.i18n.changeLanguage('ru');
});

test('оформление заказа: поле телефона — PhoneField на трёх языках, остальные поля на месте', async () => {
  for (const lang of LANGS) {
    await app.i18n.changeLanguage(lang);
    const html = app.checkoutForm({ phone: '555000000' });
    assert.equal(html.match(/id="co-phone"/g).length, 1, lang);
    assert.ok(html.includes(`>${dicts[lang].form.phone}<`), `${lang}: подпись`);
    assert.match(html, /class="phone-input__prefix">\+996</);
    assert.match(html, /value="555 000 000"/);
    for (const id of ['co-name', 'co-lastName', 'co-email', 'co-address']) assert.ok(html.includes(`id="${id}"`), `${lang}: ${id}`);
  }
  await app.i18n.changeLanguage('ru');
  const form = read('src/components/forms/CheckoutForm.jsx');
  assert.match(form, /<PhoneField id="co-phone" name="phone" label=\{t\('form\.phone'\)\} value=\{values\.phone\} onChange=\{handleChange\} error=\{errors\.phone\} required \/>/);
  assert.doesNotMatch(form, /placeholder="\+996/);
});

test('стили: префикс и поле в одну строку и сжимаются до 320px; рамка ошибки и фокуса — и у префикса', () => {
  const css = read('src/styles/components.css');
  assert.match(css, /\.phone-input \{\s*display: flex;\s*min-width: 0;/);
  assert.match(css, /\.phone-input__prefix \{[^}]*flex: none;[^}]*white-space: nowrap;/);
  assert.match(css, /\.phone-input \.field__control \{[^}]*flex: 1 1 auto;\s*min-width: 0;/);
  assert.match(css, /\.phone-input:focus-within \.phone-input__prefix \{\s*border-color: var\(--primary\);/);
  assert.match(css, /\.field--error \.phone-input__prefix \{\s*border-color: var\(--error\);/);
  // Цвета — только переменные темы (светлая и тёмная)
  const block = css.slice(css.indexOf('.phone-input {'), css.indexOf('.password-input__toggle {'));
  assert.doesNotMatch(block, /#[0-9a-f]{3,6}\b/i);
});

// ---------- Этап 3: сохранение, админ-панель, телефон магазина ----------

test('buildOrder: новый номер — +996XXXXXXXXX; структура заказа и остальные поля прежние', async () => {
  const { buildOrder } = await import('../src/utils/checkoutReview.js');
  const order = buildOrder({
    id: 'AD-1',
    createdAt: '2026-11-06T10:00:00.000Z',
    user: { uid: 'u1' },
    lines: [{ product: { id: 'p1', name: 'Rose', brand: 'B' }, volume: 50, price: 1000, quantity: 2 }],
    totals: { subtotal: 2000, discount: 0, delivery: 0, grandTotal: 2000 },
    promoCode: null,
    values: { ...CUSTOMER, name: ' Айгерим ', email: ' a@mail.com ', comment: ' ', phone: '700123456' },
    paymentStatus: 'awaitingPayment',
  });
  assert.deepEqual(order.customer, { name: 'Айгерим', lastName: 'Асанова', phone: '+996700123456', email: 'a@mail.com' });
  assert.deepEqual(Object.keys(order).sort(), ['createdAt', 'customer', 'delivery', 'discount', 'id', 'items', 'payment', 'paymentStatus', 'promoCode', 'shipping', 'subtotal', 'total', 'userId']);
  assert.equal(typeof order.customer.phone, 'string');
  assert.doesNotMatch(order.customer.phone, /\s/);
});

test('админ-панель: номер показывается через displayPhone в трёх местах, данные заказа не меняются', () => {
  for (const file of ['src/pages/admin/AdminOrderPage.jsx', 'src/pages/admin/AdminOrdersPage.jsx', 'src/pages/admin/AdminCustomerPage.jsx']) {
    const src = read(file);
    assert.match(src, /import \{ displayPhone \} from '\.\.\/\.\.\/utils\/phone';/, file);
    assert.match(src, /displayPhone\((customer|order\.customer\?)\.phone\)/, file);
    assert.doesNotMatch(src, /phone\.replace\(/, `${file}: ссылка tel: — только из displayPhone`);
    assert.doesNotMatch(src, /(setDoc|updateDoc|deleteDoc|runTransaction)/, `${file}: страница ничего не записывает`);
  }
  // Пустой номер — прочерк, как раньше; номер без цифр — текст без ссылки
  assert.match(read('src/pages/admin/AdminOrderPage.jsx'), /phone\.text \? phone\.href \? <a href=\{phone\.href\}>\{phone\.text\}<\/a> : phone\.text : '—'/);
  assert.match(read('src/pages/admin/AdminCustomerPage.jsx'), /\{phone\.href \? <a href=\{phone\.href\}>\{phone\.text\}<\/a> : phone\.text\}/);
});

test('телефон магазина: «+996 504 889 991» на трёх языках; ссылки WhatsApp не изменились', () => {
  for (const lang of LANGS) assert.equal(dicts[lang].contacts.phoneValue, '+996 504 889 991', lang);
  assert.ok(read('src/components/layout/Footer.jsx').includes('href="https://wa.me/996504889991"'));
  assert.ok(read('src/components/layout/FloatingContacts.jsx').includes("href: 'https://wa.me/996504889991'"));
});

test('границы: правила, API контактов, EmailJS и контакты магазина не затронуты; телефон заказа проверяет сервер', async () => {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync('git', ['diff', '--quiet', 'HEAD', '--', 'api/contact.js', 'api/_lib/contactHandler.js', 'src/services/contactService.js', 'src/components/layout/Footer.jsx'], { cwd: ROOT });
  assert.equal(r.status, 0, 'файлы отличаются от последнего коммита');
  // C3.3, этап 4: orderService отправляет заказ на сервер и телефон не меняет — формат проверяет сервер
  assert.doesNotMatch(read('src/services/orderService.js'), /phone/i);
  assert.match(read('src/utils/orderRequest.js'), /phone: values\.phone,/);
  assert.doesNotMatch(read('firestore.rules'), /phone/i, 'правила формат телефона не проверяют и не менялись ради него');
  // Плавающие кнопки меняются в C3.2 (скрытие при прокрутке), но ссылки на контакты магазина прежние
  const fc = read('src/components/layout/FloatingContacts.jsx');
  assert.ok(fc.includes("href: 'https://wa.me/996504889991'") && fc.includes("href: 'https://www.instagram.com/aroma__donna/'"));
  // C3.3: заказ оформляет сервер — телефон проверяется (9 цифр после +996) и сохраняется в E.164
  const core = read('api/_lib/orderCore.js');
  assert.match(core, /isKgLocal\(c\.phone\)/);
  assert.match(core, /customer\.phone = toStoredPhone\(c\.phone\)/);
});
