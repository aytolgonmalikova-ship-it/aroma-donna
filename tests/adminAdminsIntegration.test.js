// Тесты подключения раздела «Администраторы» к меню и маршрутам (Блок 2) без эмулятора:
// видимость разделов по роли, защита страницы (OwnerSectionRoute) и боковое меню (AdminLayout) —
// настоящей отрисовкой react-dom/server с заданной ролью. Сценарии в браузере — tests-e2e/admins.e2e.mjs.
// Запуск: npm test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ADMIN_SECTIONS, isSectionVisible } from '../src/components/admin/adminSections.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const ru = JSON.parse(read('src/locales/ru/translation.json')).admin;
const ACCESS = ['owner', 'pending', 'none', 'loading', 'error'];

test('isSectionVisible: «Администраторы» — только главному администратору; остальные разделы — всем', () => {
  const admins = ADMIN_SECTIONS.find((s) => s.path === 'admins');
  assert.deepEqual(admins, { path: 'admins', icon: 'shield', stage: 6, ready: true, ownerOnly: true });
  assert.deepEqual(ACCESS.map((a) => isSectionVisible(admins, a)), [true, false, false, false, false]);
  for (const s of ADMIN_SECTIONS.filter((x) => x.path !== 'admins')) {
    assert.equal(s.ownerOnly, undefined, s.path);
    for (const a of ACCESS) assert.equal(isSectionVisible(s, a), true, `${s.path}/${a}`);
  }
});

/** esbuild.build; при ошибке временная папка удаляется */
async function buildOrClean(esbuild, dir, options) {
  try {
    await esbuild.build(options);
  } catch (err) {
    rmSync(dir, { recursive: true, force: true });
    throw err;
  }
}

async function renderer() {
  const esbuild = await import('esbuild');
  const root = new URL('..', import.meta.url).pathname;
  const dir = mkdtempSync(join(tmpdir(), 'aroma-admins-int-'));
  const entry = join(dir, 'entry.jsx');
  writeFileSync(
    entry,
    `import { renderToStaticMarkup } from 'react-dom/server';
     import { MemoryRouter, Route, Routes } from 'react-router-dom';
     import { Provider } from 'react-redux';
     import { configureStore } from '@reduxjs/toolkit';
     import '${root}src/i18n.js';
     import { ThemeProvider } from '${root}src/hooks/useTheme.jsx';
     import { OwnerAccessContext } from '${root}src/hooks/useOwnerAccess.jsx';
     import OwnerSectionRoute from '${root}src/components/admin/OwnerSectionRoute.jsx';
     import AdminLayout from '${root}src/layouts/AdminLayout.jsx';
     const user = { uid: 'u1', email: 'admin@example.com', name: 'Админ' };
     const store = configureStore({ reducer: () => ({ user: { current: user, initialized: true }, notifications: { list: [] } }) });
     const withRole = (access, el) => (
       <OwnerAccessContext.Provider value={{ access, config: null, refresh() {} }}>{el}</OwnerAccessContext.Provider>
     );
     export const guard = (access) => renderToStaticMarkup(withRole(access, <OwnerSectionRoute><p id="page">СТРАНИЦА</p></OwnerSectionRoute>));
     export const layout = (access) => renderToStaticMarkup(
       <Provider store={store}><ThemeProvider><MemoryRouter initialEntries={['/admin/orders']}>
         {withRole(access, <Routes><Route path="/admin/*" element={<AdminLayout />} /></Routes>)}
       </MemoryRouter></ThemeProvider></Provider>,
     );`,
  );
  const outfile = join(dir, 'bundle.mjs');
  await buildOrClean(esbuild, dir, {
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
    jsx: 'automatic',
    loader: { '.js': 'jsx', '.css': 'empty' },
    logLevel: 'silent',
    nodePaths: [join(root, 'node_modules')],
    define: { 'import.meta.env': '{}' },
    banner: {
      js: "globalThis.document ??= { documentElement: { setAttribute() {} }, title: '', querySelector: () => null, head: { appendChild() {} }, createElement: () => ({ remove() {} }) }; globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} }; globalThis.window ??= { location: { hostname: 'localhost' }, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), scrollTo() {} }; import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
    },
  });
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  try {
    return { mod: await import(pathToFileURL(outfile).href), cleanup };
  } catch (err) {
    cleanup(); // сборка удалась, импорт — нет: временная папка не остаётся
    throw err;
  }
}

test('OwnerSectionRoute: страница — владельцу и кандидату; обычному администратору — сообщение без страницы', async () => {
  const { mod, cleanup } = await renderer();
  try {
    for (const access of ['owner', 'pending']) assert.ok(mod.guard(access).includes('СТРАНИЦА'), access);
    const none = mod.guard('none');
    assert.ok(!none.includes('СТРАНИЦА'), 'страница не монтируется — её сервис не вызывается');
    assert.ok(none.includes(ru.admins.access.ownerOnlyTitle) && none.includes(ru.nav.admins));
    const loading = mod.guard('loading');
    assert.ok(!loading.includes('СТРАНИЦА') && loading.includes(ru.admins.loading));
    const error = mod.guard('error');
    assert.ok(!error.includes('СТРАНИЦА') && error.includes(ru.admins.errors.failed));
  } finally {
    cleanup();
  }
});

test('меню AdminLayout: пункт «Администраторы» только у владельца; остальные разделы — у всех', async () => {
  const { mod, cleanup } = await renderer();
  try {
    for (const access of ACCESS) {
      const html = mod.layout(access);
      const links = [...html.matchAll(/href="(\/admin[^"]*)"/g)].map((m) => m[1]);
      for (const path of ['/admin', '/admin/orders', '/admin/products', '/admin/customers', '/admin/reviews']) {
        assert.ok(links.includes(path), `${access}: ${path}`);
      }
      assert.equal(links.includes('/admin/admins'), access === 'owner', `${access}: /admin/admins`);
    }
  } finally {
    cleanup();
  }
});

test('подключение: роль — из существующего fetchOwnerStatus, один контекст на панель; страница не переписана', () => {
  const hook = read('src/hooks/useOwnerAccess.jsx');
  assert.match(hook, /import \{ fetchOwnerStatus \} from '\.\.\/services\/adminService';/);
  assert.doesNotMatch(hook, /ownerUid ===|getDoc\(|firebase\/firestore|getFirebase/);
  const app = read('src/pages/admin/AdminApp.jsx');
  assert.match(app, /<OwnerAccessProvider uid=\{uid\}>\{children\}<\/OwnerAccessProvider>/);
  assert.equal((app.match(/OwnerAccessProvider uid=/g) || []).length, 1, 'один запрос роли на всю панель');
  assert.match(read('src/layouts/AdminLayout.jsx'), /ADMIN_SECTIONS\.filter\(\(s\) => isSectionVisible\(s, access\)\)/);
  assert.match(read('src/pages/admin/AdminDashboardPage.jsx'), /ADMIN_SECTIONS\.filter\(\(s\) => isSectionVisible\(s, access\)\)/);
  // В странице — только необязательный обработчик onRolesChanged после принятия и отклонения
  const page = read('src/pages/admin/AdminAdminsPage.jsx');
  assert.equal((page.match(/onRolesChanged\?\.\(\)/g) || []).length, 2);
  // Правила Firestore не менялись в Блоке 2: ключевые строки A3.1 на месте
  const rules = read('firestore.rules');
  assert.ok(rules.includes('allow list: if isPrimaryOwner();'));
  assert.ok(rules.includes('existsAfter(/databases/$(database)/documents/admins/$(after.pendingOwnerUid))'));
});
