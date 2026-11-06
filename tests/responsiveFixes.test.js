// C3.2, этап 1: таблица товаров админки не расширяет страницу; мобильная панель фильтров каталога —
// доступное модальное окно. Поведение в браузере (ширины, Tab, Escape, фокус) — tests-e2e/admins.e2e.mjs.
// Запуск: npm test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const ROOT = new URL('..', import.meta.url).pathname;

async function loadBundle() {
  const esbuild = await import('esbuild');
  const dir = mkdtempSync(join(tmpdir(), 'aroma-c32-'));
  try {
    const entry = join(dir, 'entry.jsx');
    writeFileSync(
      entry,
      `import { renderToStaticMarkup } from 'react-dom/server';
       import { Provider } from 'react-redux';
       import i18n from '${ROOT}src/i18n.js';
       import { store } from '${ROOT}src/store/store.js';
       import ProductFilters, { FILTERS_DRAWER_QUERY } from '${ROOT}src/components/products/ProductFilters.jsx';
       import FloatingContacts, { CONTACTS_COMPACT_QUERY } from '${ROOT}src/components/layout/FloatingContacts.jsx';
       import { MemoryRouter } from 'react-router-dom';
       import { products } from '${ROOT}src/data/products.js';
       export { i18n, FILTERS_DRAWER_QUERY, CONTACTS_COMPACT_QUERY };
       export const contacts = (path = '/') => renderToStaticMarkup(<MemoryRouter initialEntries={[path]}><FloatingContacts /></MemoryRouter>);
       const FILTERS = { category: [], family: [], brand: [], concentration: [], minPrice: null, maxPrice: null, inStock: false, q: '', sort: 'popular' };
       export const filtersPanel = (open) =>
         renderToStaticMarkup(<Provider store={store}><ProductFilters products={products} filters={FILTERS} onToggle={() => {}} onSet={() => {}} onReset={() => {}} open={open} onClose={() => {}} id="catalog-filters" /></Provider>);`,
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
const app = await loadBundle();

/** Отрисовка «на экране шириной до 959px»: matchMedia отвечает true только на запрос панели */
function asPhone(fn) {
  globalThis.window = { matchMedia: (q) => ({ matches: q === app.FILTERS_DRAWER_QUERY, addEventListener() {}, removeEventListener() {} }) };
  try {
    return fn();
  } finally {
    delete globalThis.window;
  }
}
const asideTag = (html) => html.match(/<aside[^>]*>/)[0];

test('таблица товаров: контейнер прокрутки — точка отсчёта для скрытых заголовков, прокрутка внутри сохранена', () => {
  const css = read('src/styles/admin.css');
  assert.match(css, /\.admin-table-wrap \{\s*overflow-x: auto;[^}]*position: relative;\s*\}/);
  // Скрытые заголовки по-прежнему есть — для экранного диктора
  const page = read('src/pages/admin/AdminProductsPage.jsx');
  assert.match(page, /<th scope="col">\s*<span className="visually-hidden">\{t\('admin\.products\.col\.photo'\)\}<\/span>/);
  assert.match(page, /<th scope="col">\s*<span className="visually-hidden">\{t\('admin\.products\.col\.actions'\)\}<\/span>/);
  // Карточки на телефоне не тронуты, глобальная прокрутка не спрятана
  assert.match(css, /@media \(max-width: 640px\) \{\s*\.admin-table thead \{\s*display: none;/);
  assert.doesNotMatch(css, /(html|body|\.admin|\.admin__main|\.admin__body) \{[^}]*overflow-x: (hidden|clip)/);
});

test('панель фильтров: граница 959px одна и та же в JS и CSS', () => {
  assert.equal(app.FILTERS_DRAWER_QUERY, '(max-width: 959px)');
  const css = read('src/styles/pages.css');
  const block = css.slice(css.indexOf('@media (max-width: 959px) {\n  .catalog {'));
  assert.match(block, /^@media \(max-width: 959px\) \{\s*\.catalog \{[\s\S]*?\.filters \{\s*position: fixed;/);
});

test('компьютер (шире 959px): обычная боковая колонка — без role="dialog", inert и aria-hidden', () => {
  for (const open of [false, true]) {
    const aside = asideTag(app.filtersPanel(open));
    assert.match(aside, /aria-label="Фильтры"/);
    assert.doesNotMatch(aside, /role=|aria-modal|aria-hidden|inert/, `open=${open}: ${aside}`);
  }
});

test('телефон, панель закрыта: недоступна клавиатуре и экранному диктору (inert, aria-hidden)', () => {
  const aside = asPhone(() => asideTag(app.filtersPanel(false)));
  assert.match(aside, /id="catalog-filters"/);
  assert.match(aside, /aria-hidden="true"/);
  assert.match(aside, /\binert=""/);
  assert.doesNotMatch(aside, /role="dialog"/);
});

test('телефон, панель открыта: модальное окно с подписью, доступно', () => {
  const html = asPhone(() => app.filtersPanel(true));
  const aside = asideTag(html);
  assert.match(aside, /role="dialog"/);
  assert.match(aside, /aria-modal="true"/);
  assert.match(aside, /aria-label="Фильтры"/);
  assert.doesNotMatch(aside, /aria-hidden|inert/);
  assert.match(html, /class="icon-btn filters__close"[^>]*aria-label="Закрыть"/, 'первая кнопка — «Закрыть», на неё ставится фокус');
});

test('кнопка «Фильтры» связана с панелью: aria-controls, aria-expanded, aria-haspopup', () => {
  const page = read('src/pages/CatalogPage.jsx');
  assert.match(page, /aria-haspopup="dialog"\s*aria-expanded=\{filtersOpen\}\s*aria-controls="catalog-filters"/);
  assert.match(page, /id="catalog-filters"/);
  const panel = read('src/components/products/ProductFilters.jsx');
  for (const part of ["e.key === 'Escape'", "e.key !== 'Tab'", 'opener.focus()', "document.body.style.overflow = 'hidden'", "querySelector('.filters__close')?.focus()"]) {
    assert.ok(panel.includes(part), part);
  }
});

// ---------- C3.2, этап 2: шрифт полей, контраст светлой темы, области нажатия ----------

const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const luminance = (rgb) => {
  const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = rgb.map(f);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [l1, l2] = [luminance(hexRgb(a)), luminance(hexRgb(b))].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};
/** Переменные блока (:root или [data-theme='dark']) */
const vars = (css, start) => {
  const block = css.slice(css.indexOf(start), css.indexOf('\n}\n', css.indexOf(start)));
  return Object.fromEntries([...block.matchAll(/^\s*(--[\w-]+):\s*([^;\n]+);/gm)].filter((m) => !m[2].includes(' на ')).map((m) => [m[1], m[2].trim()]));
};
/** Правило внутри @media (max-width: 768px) {...}: селектор и свойство */
const inMobile = (css, selector, decl) => {
  for (const m of css.matchAll(/@media \(max-width: 768px\) \{([\s\S]*?)\n\}/g)) {
    const body = m[1];
    const i = body.indexOf(selector);
    if (i !== -1 && body.slice(i, body.indexOf('}', i)).includes(decl)) return true;
  }
  return false;
};

test('шрифт полей до 768px — 16px: цена и сортировка в каталоге, фильтры и сортировка в админке; шире — без изменений', () => {
  const comp = read('src/styles/components.css');
  const admin = read('src/styles/admin.css');
  assert.ok(inMobile(comp, '.price-filter input,\n  .sort select {', 'font-size: 1rem;'));
  assert.ok(inMobile(admin, '.admin-toolbar__sort .field__control {', 'font-size: 1rem;'));
  // Поля цены: рядом, если подсказка помещается, иначе друг под другом (этап 3 — на всех ширинах)
  assert.match(comp, /^\.price-filter__row \{\s*display: grid;\s*grid-template-columns: repeat\(auto-fit, minmax\(8\.5em, 1fr\)\);/m);
  // Базовые размеры (компьютер) прежние
  assert.match(comp, /\.price-filter input \{[^}]*font-size: 0\.85rem;/);
  assert.match(comp, /\.sort \{[^}]*font-size: 0\.9rem;/);
  assert.match(admin, /\.admin-toolbar__sort \{[^}]*font-size: 0\.9rem;/);
});

test('контраст светлой темы по переменным: все исправленные пары ≥ 4.5', () => {
  const light = vars(read('src/styles/variables.css'), ':root {');
  const pairs = [
    ['«АДМИН», роль владельца: --gold-text на --gold-soft', light['--gold-text'], light['--gold-soft']],
    ['надпись над заголовком: --gold-text на самом розовом месте фона главной', light['--gold-text'], '#f8d9d6'],
    ['бренд товара: --gold-text на --bg', light['--gold-text'], light['--bg']],
    ['«НОВИНКА»: белый на --gold-text', '#ffffff', light['--gold-text']],
    ['акцент на розовом: --primary-text на --rose-soft', light['--primary-text'], light['--rose-soft']],
    ['зелёные метки: --success на --success-bg', light['--success'], light['--success-bg']],
  ];
  for (const [what, fg, bg] of pairs) assert.ok(contrast(fg, bg) >= 4.5, `${what}: ${contrast(fg, bg).toFixed(2)}`);
  // Было ниже нормы — подтверждение, что исправление нужно
  assert.ok(contrast(light['--gold'], light['--gold-soft']) < 4.5);
  assert.ok(contrast(light['--primary'], light['--rose-soft']) < 4.5);
  // Тот же оттенок, только темнее: --primary и --gold для кнопок и украшений не менялись
  assert.equal(light['--primary'], '#a9525f');
  assert.equal(light['--gold'], '#a8812f');
});

test('тёмная тема не изменилась: прежние переменные совпадают с последним коммитом, новые = прежние цвета', async () => {
  const { execFileSync } = await import('node:child_process');
  const before = vars(execFileSync('git', ['show', 'HEAD:src/styles/variables.css'], { cwd: ROOT, encoding: 'utf8' }), "[data-theme='dark'] {");
  const now = vars(read('src/styles/variables.css'), "[data-theme='dark'] {");
  for (const [k, v] of Object.entries(before)) assert.equal(now[k], v, k);
  assert.equal(now['--gold-text'], 'var(--gold)');
  assert.equal(now['--primary-text'], 'var(--primary)');
});

test('исправленные элементы используют новые переменные текста', () => {
  const rule = (file, sel) => {
    const css = read(file);
    const i = css.indexOf(`${sel} {`);
    assert.notEqual(i, -1, sel);
    return css.slice(i, css.indexOf('}', i));
  };
  assert.match(rule('src/styles/admin.css', '.admin__brand span'), /color: var\(--gold-text\);/);
  assert.match(rule('src/styles/admin.css', '.admin-badge--role-owner'), /color: var\(--gold-text\);/);
  assert.match(rule('src/styles/admin.css', '.admin-transfer--incoming'), /color: var\(--gold-text\);\s*background: var\(--gold-soft\);\s*border-left-color: var\(--gold\);/);
  assert.match(rule('src/styles/layout.css', '.eyebrow'), /color: var\(--gold-text\);/);
  assert.match(rule('src/styles/pages.css', '.product-info__brand'), /color: var\(--gold-text\);/);
  assert.match(rule('src/styles/components.css', '.label--new'), /background: var\(--gold-text\);/);
  assert.match(rule('src/styles/components.css', '.step-num'), /color: var\(--primary-text\);/);
  for (const sel of ['.admin__link.active', '.admin-filter.is-active', '.admin-badge--self']) {
    assert.match(rule('src/styles/admin.css', sel), /color: var\(--primary-text\);/, sel);
  }
});

test('области нажатия на телефонах — 44px; значки и карточки визуально прежние', () => {
  const comp = read('src/styles/components.css');
  const admin = read('src/styles/admin.css');
  const layout = read('src/styles/layout.css');
  assert.ok(inMobile(comp, '.toast__close {', 'min-width: 44px;'));
  assert.ok(inMobile(comp, '.toast__close {', 'min-height: 44px;'));
  assert.ok(inMobile(comp, '.toast__close {', 'margin: -10px -10px -10px 0;'), 'высота уведомления прежняя');
  assert.ok(inMobile(comp, '.filter-group__toggle {', 'min-height: 44px;'));
  assert.ok(inMobile(comp, '.link-arrow {', 'min-height: 44px;'));
  assert.ok(inMobile(admin, '.admin-back,\n  .admin-table__link {', 'min-height: 44px;'));
  assert.ok(inMobile(admin, '.admin-review__toggle {', 'min-height: 44px;'));
  assert.ok(inMobile(layout, '.footer .whatsapp-link,\n  .footer .instagram-link {', 'min-height: 44px;'));
  // «В корзину»: кнопка 36×36 не сжимается, область нажатия — псевдоэлемент на 4px шире с каждой стороны
  assert.match(comp, /\.product-card__footer \.btn--icon \{\s*position: relative;\s*flex-shrink: 0;\s*\}/);
  assert.match(comp, /\.product-card__footer \.btn--icon::after \{\s*content: '';\s*position: absolute;\s*inset: -5px;\s*border-radius: 50%;\s*\}/);
  assert.match(comp, /\.btn--icon \{\s*width: 36px;\s*height: 36px;\s*\}/);
});

// ---------- C3.2, этап 3: мелкий текст, верхняя полоса, шапка админки, плавающие кнопки ----------

test('мелкий текст: бренд, метки, счётчик корзины — 12px (0.75rem); прочие подписи не тронуты', () => {
  const rule = (file, sel) => {
    const css = read(file);
    const i = css.indexOf(`${sel} {`);
    return css.slice(i, css.indexOf('}', i));
  };
  for (const [file, sel] of [
    ['src/styles/components.css', '.badge'],
    ['src/styles/components.css', '.label'],
    ['src/styles/components.css', '.product-card__brand'],
    ['src/styles/pages.css', '.cart-item__brand'],
  ]) {
    assert.match(rule(file, sel), /font-size: 0\.75rem;/, sel);
  }
  // Название товара по-прежнему крупнее бренда — иерархия карточки прежняя
  assert.match(rule('src/styles/components.css', '.product-card__name'), /font-size: 1\.35rem;/);
});

test('верхняя полоса: части сообщения по строкам на телефоне, обе части во всех языках, «KGSтан» исправлено', async () => {
  const { execFileSync } = await import('node:child_process');
  const header = read('src/components/layout/Header.jsx');
  assert.match(header, /t\('header\.promo'\)\s*\.split\(' · '\)/);
  assert.match(header, /className="header__promo-sep" aria-hidden="true"/);
  const css = read('src/styles/layout.css');
  const m = css.match(/@media \(max-width: 640px\) \{\s*\.header__promo \{([^}]*)\}\s*\.header__promo-part \{\s*display: block;\s*\}\s*\.header__promo-sep \{\s*display: none;/);
  assert.ok(m, 'правила ≤640px');
  assert.match(m[1], /white-space: normal;/);
  for (const lang of ['ru', 'ky', 'en']) {
    const promo = JSON.parse(read(`src/locales/${lang}/translation.json`)).header.promo;
    assert.equal(promo.split(' · ').length, 2, `${lang}: две части`);
    assert.match(promo, /7[  ,]000 KGS/, `${lang}: сумма записана как раньше`);
  }
  const ky = JSON.parse(read('src/locales/ky/translation.json')).header.promo;
  assert.doesNotMatch(ky, /KGS[а-яөүңё]/i, 'суффикс не приклеен к KGS');
  // ru и en не менялись
  for (const lang of ['ru', 'en']) {
    const before = JSON.parse(execFileSync('git', ['show', `HEAD:src/locales/${lang}/translation.json`], { cwd: ROOT, encoding: 'utf8' })).header.promo;
    assert.equal(JSON.parse(read(`src/locales/${lang}/translation.json`)).header.promo, before, lang);
  }
  // Высота шапки для отступов при прокрутке — с учётом 2–3 строк полосы
  assert.match(read('src/styles/variables.css'), /@media \(max-width: 640px\) \{\s*:root \{\s*--header-total: 122px;/);
});

test('шапка админки: компактная на телефоне, подсказка прокрутки меню, доступ к разделам — как раньше', () => {
  const layout = read('src/layouts/AdminLayout.jsx');
  // Пункты меню — прежняя логика доступа
  assert.match(layout, /ADMIN_SECTIONS\.filter\(\(s\) => isSectionVisible\(s, access\)\)/);
  assert.match(layout, /const \{ access \} = useOwnerAccess\(\);/);
  assert.match(layout, /data-more-left=\{navMore\.left \|\| undefined\}/);
  assert.match(layout, /data-more-right=\{navMore\.right \|\| undefined\}/);
  // «В магазин» и «Выйти»: текст в разметке остаётся — доступное имя кнопки
  assert.equal(layout.match(/<span className="admin__action-text">/g).length, 2);
  const css = read('src/styles/admin.css');
  assert.match(css, /\.admin__nav\[data-more-right\] \{[^}]*mask-image: linear-gradient\(to right/);
  assert.match(css, /\.admin__nav\[data-more-left\] \{[^}]*mask-image: linear-gradient\(to left/);
  assert.match(css, /@media \(max-width: 899px\) \{[\s\S]*?\.admin__link\.active \{\s*box-shadow: inset 0 -3px 0 var\(--primary\);/);
  const phone = css.slice(css.indexOf('/* Телефоны: компактная шапка'));
  assert.match(phone, /^\/\* Телефоны: компактная шапка[^\n]*\n@media \(max-width: 640px\) \{/);
  assert.match(phone, /\.admin__topbar \{\s*flex-wrap: nowrap;/);
  assert.match(phone, /\.admin__action-text \{\s*position: absolute;\s*width: 1px;/);
  assert.match(phone, /\.admin__action \{\s*position: relative;/);
  assert.match(phone, /min-width: 44px;\s*min-height: 44px;/);
});

test('плавающие кнопки: на телефоне уходят при прокрутке вниз; корзина и оформление — без кнопок; ссылки прежние', () => {
  const fc = read('src/components/layout/FloatingContacts.jsx');
  assert.match(fc, /const HIDE_ON_MOBILE = \['\/cart', '\/checkout'\];/);
  assert.match(fc, /href: 'https:\/\/wa\.me\/996504889991'/);
  assert.match(fc, /floating-contacts--away/);
  const css = read('src/styles/components.css');
  assert.ok(inMobile(css, '.floating-contacts--away {', 'pointer-events: none;'));
  assert.ok(inMobile(css, '.floating-contacts--away:focus-within {', 'transform: none;'));
  assert.ok(inMobile(css, '.floating-contacts--hide-mobile {', 'display: none;'));
  // Нижние системные отступы
  assert.match(css, /bottom: max\(14px, env\(safe-area-inset-bottom\)\);/);
  assert.match(css, /bottom: max\(20px, env\(safe-area-inset-bottom\)\);/);
});

test('зелёный текст (--success) светлой темы: ≥ 4.5 на всех светлых фонах сайта', () => {
  const light = vars(read('src/styles/variables.css'), ':root {');
  for (const bg of ['--bg', '--bg-alt', '--surface', '--surface-2', '--success-bg', '--blush']) {
    assert.ok(contrast(light['--success'], light[bg]) >= 4.5, `${bg}: ${contrast(light['--success'], light[bg]).toFixed(2)}`);
  }
});

// ---------- C3.2, этап 4: кыргызские суммы, две подписи 12px, меню контактов на телефоне ----------

test('кыргызский перевод: к KGS не приклеены суффиксы; суммы и условия прежние; ru и en не менялись', async () => {
  const { execFileSync } = await import('node:child_process');
  const ky = JSON.parse(read('src/locales/ky/translation.json'));
  const raw = read('src/locales/ky/translation.json');
  assert.doesNotMatch(raw, /KGS[а-яөүңё]/i);
  assert.equal(ky.quiz.options.budget.economy, '5 000 KGS жана андан төмөн');
  assert.equal(ky.quiz.options.budget.premium, '8 000 KGS жана андан жогору');
  assert.equal(ky.quiz.options.budget.medium, '5 000 – 8 000 KGS', 'средний диапазон не менялся');
  const faq = ky.faq.items.delivery.a;
  for (const part of ['300 KGS', '7 000 KGS жана андан жогору', '450 KGS', '12 000 KGS жана андан жогору', 'акысыз']) assert.ok(faq.includes(part), part);
  // «Бишкекте» и вся полоса — кириллица (латиница только в «KGS»)
  assert.equal(ky.header.promo.replace(/KGS/g, '').match(/[A-Za-z]/g), null);
  assert.ok(ky.header.promo.startsWith('Бишкекте '));
  for (const lang of ['ru', 'en']) {
    const before = JSON.parse(execFileSync('git', ['show', `HEAD:src/locales/${lang}/translation.json`], { cwd: ROOT, encoding: 'utf8' }));
    const now = JSON.parse(read(`src/locales/${lang}/translation.json`));
    assert.deepEqual(now.quiz.options.budget, before.quiz.options.budget, lang);
    assert.equal(now.faq.items.delivery.a, before.faq.items.delivery.a, lang);
  }
});

test('счётчик фильтров и малая метка совпадения в квизе — 12px; основная метка крупнее', () => {
  const rule = (file, sel) => {
    const css = read(file);
    const i = css.indexOf(`${sel} {`);
    return css.slice(i, css.indexOf('}', i));
  };
  assert.match(rule('src/styles/components.css', '.filter-group__count'), /font-size: 0\.75rem;/);
  assert.match(rule('src/styles/pages.css', '.match-badge--sm'), /font-size: 0\.75rem;/);
  assert.match(rule('src/styles/pages.css', '.match-badge'), /font-size: 0\.8rem;/);
});

/** Отрисовка «на телефоне»: matchMedia отвечает true на запросы до 768px и 959px */
function asNarrow(fn) {
  globalThis.window = { matchMedia: (q) => ({ matches: /max-width: (768|959)px/.test(q), addEventListener() {}, removeEventListener() {} }), scrollY: 0 };
  try {
    return fn();
  } finally {
    delete globalThis.window;
  }
}

test('контакты на компьютере: две кнопки WhatsApp и Instagram, как раньше', () => {
  const html = app.contacts('/');
  assert.equal(app.CONTACTS_COMPACT_QUERY, '(max-width: 768px)');
  assert.equal((html.match(/class="floating-contacts__btn /g) || []).length, 2);
  assert.match(html, /href="https:\/\/wa\.me\/996504889991"/);
  assert.match(html, /href="https:\/\/www\.instagram\.com\/aroma__donna\/"/);
  assert.doesNotMatch(html, /floating-contacts__launcher/);
});

test('контакты на телефоне: одна кнопка «Быстрая связь» с aria-expanded/aria-controls, меню закрыто, ссылки прежние', () => {
  const html = asNarrow(() => app.contacts('/'));
  const launcher = html.match(/<button[^>]*floating-contacts__launcher[^>]*>/)[0];
  for (const attr of ['type="button"', 'aria-label="Быстрая связь"', 'aria-expanded="false"', 'aria-controls="floating-contacts-menu"']) assert.ok(launcher.includes(attr), attr);
  assert.match(html, /<ul id="floating-contacts-menu" class="floating-contacts__menu" hidden="">/);
  assert.equal((html.match(/class="floating-contacts__item /g) || []).length, 2);
  assert.match(html, /href="https:\/\/wa\.me\/996504889991" target="_blank" rel="noopener noreferrer" class="floating-contacts__item floating-contacts__item--whatsapp" aria-label="Написать в WhatsApp \(откроется в новой вкладке\)"/);
  assert.match(html, /href="https:\/\/www\.instagram\.com\/aroma__donna\/"[^>]*aria-label="Открыть Instagram магазина \(откроется в новой вкладке\)"/);
  assert.doesNotMatch(html, /floating-contacts__btn /, 'двух отдельных кнопок на телефоне нет');
  // Корзина и оформление — скрыто, как раньше
  for (const path of ['/cart', '/checkout']) assert.match(asNarrow(() => app.contacts(path)), /class="floating-contacts floating-contacts--compact floating-contacts--hide-mobile"/);
  const css = read('src/styles/components.css');
  assert.ok(inMobile(css, '.floating-contacts--compact {', 'flex-direction: column-reverse;'));
  assert.ok(inMobile(css, '.floating-contacts__menu[hidden] {', 'display: none;'));
});

test('кыргызский перевод: суффиксы не приклеены к латинским названиям в benefits.title и faq.items.account.a', () => {
  const ky = JSON.parse(read('src/locales/ky/translation.json'));
  assert.equal(ky.benefits.title, 'AROMA DONNA бутигинин артыкчылыктары');
  assert.equal(
    ky.faq.items.account.a,
    'Жеке кабинетте буйрутмалар тарыхы сакталат. Firebase туташтырылбаса, катталуу демо-режимде иштейт жана маалыматтарды сиздин браузериңизде гана сактайт.',
  );
  for (const text of [ky.benefits.title, ky.faq.items.account.a]) assert.doesNotMatch(text, /[A-Za-z][а-яөүңё]/i);
});
