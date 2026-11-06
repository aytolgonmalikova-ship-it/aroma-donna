// Тесты страницы «Администраторы» (крупный блок 1) без эмулятора: форма назначения, модель отображения
// по ролям, все состояния представления (настоящая отрисовка react-dom/server на ru, ky, en),
// UID на экране «Нет доступа» и границы блока. Сценарии в браузере с эмулятором — tests-e2e/admins.e2e.mjs
// (npm run test:e2e). Запуск: npm test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildAdminsView, validateGrantInput } from '../src/utils/adminAdmins.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const dicts = Object.fromEntries(['ru', 'ky', 'en'].map((l) => [l, JSON.parse(read(`src/locales/${l}/translation.json`))]));
const ru = dicts.ru.admin;

const OWNER = { uid: 'ownerUID1234567890', label: 'Владелец', grantedAt: '2026-11-01T10:00:00.000Z', grantedBy: 'console', legacy: false, isOwner: true, isPendingOwner: false };
const MANAGER = { uid: 'managerUID12345678', label: 'Менеджер', grantedAt: '2026-11-02T10:00:00.000Z', grantedBy: OWNER.uid, legacy: false, isOwner: false, isPendingOwner: false };
const CANDIDATE = { uid: 'candidateUID123456', label: null, grantedAt: null, grantedBy: OWNER.uid, legacy: false, isOwner: false, isPendingOwner: true };

// ---------- Форма ----------

test('validateGrantInput: UID обязателен и проверяется по формату; e-mail не принимается; подпись нормализуется', () => {
  assert.deepEqual(validateGrantInput({ uid: '  abc_DEF-123 ', label: '  Сестра ' }), { errors: {}, value: { uid: 'abc_DEF-123', label: 'Сестра' } });
  for (const uid of ['', '   ', undefined, null]) assert.equal(validateGrantInput({ uid }).errors.uid, 'required', String(uid));
  for (const uid of ['sister@example.com', 'a b', 'a.b', 'a/b', 'x'.repeat(129)]) assert.equal(validateGrantInput({ uid }).errors.uid, 'invalid', uid);
  assert.equal(validateGrantInput({ uid: 'ok', label: 'x'.repeat(101) }).errors.label, 'invalid');
  assert.deepEqual(validateGrantInput({ uid: 'ok', label: '   ' }).value, { uid: 'ok', label: null });
  assert.deepEqual(validateGrantInput({ uid: 'x'.repeat(128) }).errors, {});
});

// ---------- Модель отображения по ролям ----------

test('buildAdminsView: владелец — список (владелец первым), действия по правилам, исходящее предложение', () => {
  const config = { ownerUid: OWNER.uid, pendingOwnerUid: CANDIDATE.uid };
  const v = buildAdminsView({ access: 'owner', admins: [CANDIDATE, MANAGER, OWNER], config, currentUid: OWNER.uid });
  assert.equal(v.canManage, true);
  assert.deepEqual(v.members.map((m) => m.admin.uid), [OWNER.uid, CANDIDATE.uid, MANAGER.uid]);
  assert.deepEqual(v.members.map((m) => [m.revoke.allowed, m.revoke.reason, m.offer.allowed]), [
    [false, 'self', false],
    [false, 'pending', false],
    [true, null, false], // пока есть предложение, новое не показывается
  ]);
  assert.deepEqual(v.outgoing, { uid: CANDIDATE.uid, name: 'candid…3456' });
  assert.equal(v.incoming, null);
  // Без предложения можно предложить роль обычному администратору (но не себе)
  const free = buildAdminsView({ access: 'owner', admins: [OWNER, MANAGER], config: { ownerUid: OWNER.uid, pendingOwnerUid: null }, currentUid: OWNER.uid });
  assert.deepEqual(free.members.map((m) => m.offer.allowed), [false, true]);
  assert.equal(free.outgoing, null);
  assert.deepEqual(buildAdminsView({ access: 'owner', admins: [], config: null, currentUid: OWNER.uid }).members, []);
});

test('buildAdminsView: обычный администратор и кандидат не получают список, даже если данные переданы', () => {
  for (const access of ['none', 'pending', undefined]) {
    const v = buildAdminsView({ access, admins: [OWNER, MANAGER], config: { ownerUid: OWNER.uid, pendingOwnerUid: MANAGER.uid }, currentUid: MANAGER.uid });
    assert.equal(v.canManage, false);
    assert.deepEqual(v.members, []);
    assert.equal(v.outgoing, null);
  }
  const pending = buildAdminsView({ access: 'pending', config: { ownerUid: OWNER.uid, pendingOwnerUid: CANDIDATE.uid }, currentUid: CANDIDATE.uid });
  assert.deepEqual(pending.incoming, { ownerUid: OWNER.uid, name: 'ownerU…7890' });
  assert.equal(buildAdminsView({ access: 'none', currentUid: MANAGER.uid }).incoming, null);
  assert.equal(buildAdminsView({ access: 'pending', config: null }).incoming, null);
});

// ---------- Отрисовка представления (react-dom/server) ----------

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
  const dir = mkdtempSync(join(tmpdir(), 'aroma-admins-page-'));
  const entry = join(dir, 'entry.jsx');
  writeFileSync(
    entry,
    `import { renderToStaticMarkup } from 'react-dom/server';
     import i18n from '${root}src/i18n.js';
     import AdminAdminsView from '${root}src/components/admin/AdminAdminsView.jsx';
     export { i18n };
     export const view = (props) => renderToStaticMarkup(<AdminAdminsView {...props} />);
`,
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
      js: "globalThis.document ??= { documentElement: { setAttribute() {} }, title: '' }; globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} }; import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
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

const noop = () => {};
const handlers = Object.fromEntries(
  ['onRefresh', 'onGrant', 'onRevokeRequest', 'onOfferRequest', 'onCancelOffer', 'onAcceptRequest', 'onDecline', 'onDialogConfirm', 'onDialogCancel', 'onCloseError'].map((k) => [k, noop]),
);

test('отрисовка: загрузка, ошибка, владелец, пустой список, обычный администратор, кандидат, ошибка действия, окно', async () => {
  const { mod, cleanup } = await renderer();
  try {
    const ownerView = buildAdminsView({ access: 'owner', admins: [CANDIDATE, MANAGER, OWNER], config: { ownerUid: OWNER.uid, pendingOwnerUid: CANDIDATE.uid }, currentUid: OWNER.uid });
    const freeView = buildAdminsView({ access: 'owner', admins: [OWNER, MANAGER], config: { ownerUid: OWNER.uid, pendingOwnerUid: null }, currentUid: OWNER.uid });
    const emptyView = buildAdminsView({ access: 'owner', admins: [], currentUid: OWNER.uid });
    const noneView = buildAdminsView({ access: 'none', currentUid: MANAGER.uid });
    const pendingView = buildAdminsView({ access: 'pending', config: { ownerUid: OWNER.uid, pendingOwnerUid: CANDIDATE.uid }, currentUid: CANDIDATE.uid });
    const r = (props) => mod.view({ ...handlers, currentUid: OWNER.uid, ...props });

    for (const lang of ['ru', 'ky', 'en']) {
      await mod.i18n.changeLanguage(lang);
      const t = dicts[lang].admin;
      const all = [
        r({ phase: 'loading', view: noneView }),
        r({ phase: 'error', loadError: 'network', view: noneView }),
        r({ phase: 'ready', view: ownerView }),
        r({ phase: 'ready', view: emptyView }),
        r({ phase: 'ready', view: noneView, currentUid: MANAGER.uid }),
        r({ phase: 'ready', view: pendingView, currentUid: CANDIDATE.uid }),
        r({ phase: 'ready', view: ownerView, actionError: { code: 'user-not-found' } }),
        r({ phase: 'ready', view: ownerView, dialog: { kind: 'revoke', name: 'Менеджер', uid: MANAGER.uid, busy: false, error: null } }),
      ].join('\n');
      assert.doesNotMatch(all, /admin\.(admins|nav)\./, `${lang}: непереведённые ключи`);
      for (const text of [t.nav.admins, t.admins.loading, t.admins.errors.network, t.admins.grant.title, t.admins.list.empty, t.admins.access.ownerOnlyTitle, t.admins.transfer.incomingTitle, t.admins.transfer.outgoingTitle, t.admins.errors['user-not-found'], t.admins.revoke.title]) {
        assert.ok(all.includes(text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;')) || all.includes(text), `${lang}: ${text}`);
      }
    }
    await mod.i18n.changeLanguage('ru');

    // Загрузка и ошибка: ни списка, ни формы
    const loading = r({ phase: 'loading', view: noneView });
    assert.ok(loading.includes(ru.admins.loading) && !loading.includes('admin-grant'));
    const failed = r({ phase: 'error', loadError: 'network', view: noneView });
    assert.ok(failed.includes(ru.admins.errors.network) && failed.includes(dicts.ru.common.retry));
    // Владелец: форма, список, владелец первым, причины запрета, отмена предложения
    const owner = r({ phase: 'ready', view: ownerView });
    assert.ok(owner.includes('admin-grant') && owner.includes('id="admin-grant-uid"'));
    assert.equal((owner.match(/class="admin-member card/g) || []).length, 3);
    assert.ok(owner.indexOf('admin-member--owner') < owner.indexOf('admin-member--pending'));
    assert.ok(owner.includes(ru.admins.revoke.blocked.self) && owner.includes(ru.admins.revoke.blocked.pending));
    assert.ok(owner.includes(ru.admins.transfer.cancelAction));
    assert.ok(owner.includes(`aria-label="${ru.admins.revoke.actionLabel.replace('{{name}}', 'Менеджер')}"`));
    assert.ok(!owner.includes(ru.admins.transfer.offerAction), 'при действующем предложении новых нет');
    // Без предложения — кнопка «Передать роль главного» у обычного администратора
    assert.ok(r({ phase: 'ready', view: freeView }).includes(ru.admins.transfer.offerActionLabel.replace('{{name}}', 'Менеджер')));
    // Пустой список
    assert.ok(r({ phase: 'ready', view: emptyView }).includes(ru.admins.list.empty));
    // Обычный администратор: только сообщение — нет формы, списка и UID других
    const none = r({ phase: 'ready', view: noneView, currentUid: MANAGER.uid });
    assert.ok(none.includes(ru.admins.access.ownerOnlyTitle));
    for (const part of ['admin-grant', 'admin-member', 'admin-transfer', OWNER.uid, CANDIDATE.uid]) assert.ok(!none.includes(part), part);
    // Кандидат: входящее предложение с действиями, без списка и формы
    const pending = r({ phase: 'ready', view: pendingView, currentUid: CANDIDATE.uid });
    assert.ok(pending.includes('admin-transfer--incoming') && pending.includes(ru.admins.transfer.acceptAction) && pending.includes(ru.admins.transfer.declineAction));
    assert.ok(!pending.includes('admin-grant') && !pending.includes('admin-member'));
    // Ошибка действия — понятный текст и кнопка закрытия
    const err = r({ phase: 'ready', view: ownerView, actionError: { code: 'offer-stale' } });
    assert.ok(err.includes(ru.admins.errors['offer-stale']) && err.includes(`aria-label="${ru.admins.closeMessage}"`));
    // Во время действия все кнопки заблокированы
    const busy = r({ phase: 'ready', view: freeView, busy: { kind: 'cancel' } });
    const buttons = busy.match(/<button[^>]*>/g) || [];
    assert.ok(buttons.length > 2);
    assert.ok(buttons.every((b) => b.includes('disabled=""')), 'все кнопки заблокированы');
    // Окно подтверждения открыто — показан тот, у кого отзывается доступ
    const dlg = r({ phase: 'ready', view: ownerView, dialog: { kind: 'revoke', name: 'Менеджер', uid: MANAGER.uid, busy: false, error: null } });
    assert.ok(dlg.includes('role="alertdialog"') && dlg.includes(MANAGER.uid));
  } finally {
    cleanup();
  }
});

test('экран «Нет доступа»: показан только UID вошедшего пользователя; переведён на три языка', async () => {
  const { mod, cleanup } = await renderer();
  try {
    for (const lang of ['ru', 'ky', 'en']) {
      await mod.i18n.changeLanguage(lang);
      // AdminRoute проверяет роль в эффекте (при серверной отрисовке — «загрузка»), поэтому экран отказа
      // с настоящим UID проверяет tests-e2e/admins.e2e.mjs; здесь — переводы и исходный текст
      const t = dicts[lang].admin;
      assert.ok(t.deniedUidLabel && t.deniedUidHint, lang);
    }
  } finally {
    cleanup();
  }
  const route = read('src/components/admin/AdminRoute.jsx');
  assert.match(route, /\{current\.uid && \(/);
  assert.match(route, /<code className="admin-gate__uid-value" aria-labelledby="admin-gate-uid-label">\s*\{current\.uid\}\s*<\/code>/);
  assert.match(route, /t\('admin\.deniedUidLabel'\)/);
  assert.match(route, /t\('admin\.deniedUidHint'\)/);
  // UID — только свой, из Firebase Auth (user.current); других UID на экране нет
  assert.equal((route.match(/\.uid\b/g) || []).length, 2, 'только current.uid');
  assert.match(read('src/styles/admin.css'), /\.admin-gate__uid-value \{[^}]*user-select: all;/);
});

// ---------- Страница: исходный текст и границы блока ----------

test('страница: только функции сервиса, перечитывание после каждой операции, роль не меняется локально', () => {
  const page = read('src/pages/admin/AdminAdminsPage.jsx');
  for (const fn of ['fetchOwnerStatus', 'fetchAdmins', 'grantAdmin', 'revokeAdmin', 'offerOwnerTransfer', 'cancelOwnerTransfer', 'declineOwnerTransfer', 'acceptOwnerTransfer']) {
    assert.match(page, new RegExp(`\\b${fn}\\(`), fn);
  }
  assert.match(page, /from '\.\.\/\.\.\/services\/adminService'/);
  assert.doesNotMatch(page, /firebase\/firestore|getFirebase|dbApi|setDoc|updateDoc|deleteDoc/);
  // Владелец и кандидат не меняются в состоянии страницы — только после перечитывания из Firestore
  assert.doesNotMatch(page, /ownerUid\s*:|pendingOwnerUid\s*:|isOwner\s*:/);
  assert.ok((page.match(/await load\(\{ silent: true \}\)/g) || []).length >= 3, 'после назначения, действий в окне и простых действий');
  assert.match(page, /if \(locked\) return/);
  assert.match(page, /await acceptOwnerTransfer\(target\.uid\)/);
  assert.match(page, /cancelOwnerTransfer\(view\.outgoing\?\.uid\)/);
  // Неповторяемая ошибка — данные перечитываются
  assert.match(page, /if \(!isRetryableAdminError\(code\)\) load\(\{ silent: true \}\)/);
});

test('подключение (Блок 2): страница — через OwnerSectionRoute; стенд E2E не входит в приложение', () => {
  assert.match(read('src/components/admin/adminSections.js'), /\{ path: 'admins', icon: 'shield', stage: 6, ready: true, ownerOnly: true \}/);
  const app = read('src/pages/admin/AdminApp.jsx');
  assert.match(app, /admins: AdminAdminsSection,/);
  assert.match(app, /<OwnerSectionRoute>\s*<AdminAdminsPage onRolesChanged=\{refresh\} \/>\s*<\/OwnerSectionRoute>/);
  // Стенд E2E открывает и отдельную страницу, и всю админ-панель
  assert.match(read('tests-e2e/admins-harness.html'), /import AdminAdminsPage from '\/src\/pages\/admin\/AdminAdminsPage\.jsx'/);
  assert.match(read('tests-e2e/admins-harness.html'), /if \(!isEmulatorMode\)/);
  assert.doesNotMatch(read('vite.config.js'), /tests-e2e|rollupOptions/);
  const { scripts } = JSON.parse(read('package.json'));
  assert.equal(scripts['test:e2e'], 'npx firebase-tools emulators:exec --only auth,firestore --project demo-aroma-donna "node --test --test-concurrency=1 tests-e2e/admins.e2e.mjs"');
  const e2e = read('tests-e2e/admins.e2e.mjs');
  assert.match(e2e, /process\.env\.VITE_USE_EMULATORS = 'true';/);
  assert.match(e2e, /process\.env\[key\] = '';/);
  assert.match(e2e, /assert\.match\(fb, \/"VITE_FIREBASE_PROJECT_ID":\\s\*""\//);
  assert.match(e2e, /assert\.equal\(process\.env\.FIRESTORE_EMULATOR_HOST, '127\.0\.0\.1:8080'/);
});
