// Тесты интерфейсной основы раздела «Администраторы» (этап A5): переводы на ru, ky, en,
// коды ошибок сервиса, чистые функции utils/adminAdmins.js, компоненты (по исходному тексту
// и настоящей отрисовкой через react-dom/server), стили и границы этапа. Запуск: npm test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ADMIN_ERROR_CODES,
  ADMIN_ROLES,
  adminDisplayName,
  adminErrorKey,
  adminGrantedBy,
  adminMentionName,
  adminRoleOf,
  isRetryableAdminError,
  revokeBlockReason,
  shortUid,
} from '../src/utils/adminAdmins.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const get = (obj, key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const keysOf = (obj, prefix = '') =>
  Object.entries(obj).flatMap(([k, v]) => (v && typeof v === 'object' ? keysOf(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
const dicts = Object.fromEntries(['ru', 'ky', 'en'].map((l) => [l, JSON.parse(read(`src/locales/${l}/translation.json`))]));
const COMPONENTS = ['AdminRoleBadge', 'AdminMemberCard', 'OwnerTransferNotice', 'AdminConfirmDialog'].map(
  (n) => `src/components/admin/${n}.jsx`,
);
const LONG_UID = 'A'.repeat(64) + 'b'.repeat(64); // 128 символов — максимум UID
const LONG_LABEL = `Подпись-${'x'.repeat(92)}`; // 100 символов — максимум подписи

// ---------- Переводы ----------

test('переводы admin.admins: одинаковая структура на ru, ky, en, без пустых строк и с одинаковыми подстановками', () => {
  const ruKeys = keysOf(dicts.ru.admin.admins).sort();
  assert.ok(ruKeys.length > 100, `ключей: ${ruKeys.length}`);
  const ph = (s) => (s.match(/\{\{\w+\}\}/g) || []).sort();
  for (const [lang, dict] of Object.entries(dicts)) {
    const block = dict.admin.admins;
    assert.ok(block, lang);
    assert.deepEqual(keysOf(block).sort(), ruKeys, lang);
    for (const k of ruKeys) {
      const v = get(block, k);
      assert.equal(typeof v, 'string', `${lang}: ${k}`);
      assert.ok(v.trim(), `${lang}: ${k} пустой`);
      assert.deepEqual(ph(v), ph(get(dicts.ru.admin.admins, k)), `${lang}: ${k}`);
    }
    // Ключи других разделов не тронуты: название пункта меню прежнее
    assert.ok(dict.admin.nav.admins, lang);
  }
  // Переводы — не копии русского: кыргызский и английский отличаются
  for (const k of ['subtitle', 'roles.owner', 'revoke.title', 'transfer.offerTitle', 'errors.not-owner']) {
    assert.notEqual(get(dicts.ky.admin.admins, k), get(dicts.ru.admin.admins, k), `ky ${k}`);
    assert.notEqual(get(dicts.en.admin.admins, k), get(dicts.ru.admin.admins, k), `en ${k}`);
  }
});

test('переводы admin.admins: роли, список, UID, добавление, отзыв, передача роли, пустой список, загрузка, доступ', () => {
  for (const [lang, dict] of Object.entries(dicts)) {
    const b = dict.admin.admins;
    for (const role of ADMIN_ROLES) assert.ok(b.roles[role] && b.roleHint[role], `${lang}: ${role}`);
    for (const k of ['title', 'empty', 'emptyText', 'noLabel', 'you', 'legacy', 'grantedAtLabel', 'grantedByLabel']) assert.ok(b.list[k], `${lang}: list.${k}`);
    for (const k of ['label', 'fieldLabel', 'hint', 'placeholder', 'invalid']) assert.ok(b.uid[k], `${lang}: uid.${k}`);
    for (const k of ['title', 'text', 'submit', 'submitting', 'done']) assert.ok(b.grant[k], `${lang}: grant.${k}`);
    for (const k of ['action', 'title', 'text', 'confirmCheck', 'confirm', 'confirming', 'done']) assert.ok(b.revoke[k], `${lang}: revoke.${k}`);
    for (const k of ['self', 'owner', 'pending']) assert.ok(b.revoke.blocked[k], `${lang}: revoke.blocked.${k}`);
    for (const k of ['offerTitle', 'offerConfirm', 'outgoingTitle', 'incomingTitle', 'acceptAction', 'acceptTitle', 'cancelAction', 'declineAction', 'cancelDone', 'declineDone', 'acceptDone']) {
      assert.ok(b.transfer[k], `${lang}: transfer.${k}`);
    }
    for (const k of ['loading', 'refresh', 'refreshing', 'subtitle', 'ownerOnlyNote']) assert.ok(b[k], `${lang}: ${k}`);
    assert.ok(b.access.ownerOnlyTitle && b.access.ownerOnlyText, lang);
    // Имя второй стороны подставляется туда, где о ней речь
    for (const k of ['revoke.text', 'revoke.confirmCheck', 'revoke.done', 'transfer.offerText', 'transfer.outgoingText', 'transfer.incomingText', 'transfer.acceptText', 'grant.done']) {
      assert.match(get(b, k), /\{\{name\}\}/, `${lang}: ${k}`);
    }
  }
});

test('коды ошибок: каждый код adminAdminsStore.js и общие коды переведены на три языка', () => {
  const store = read('src/services/adminAdminsStore.js');
  const thrown = new Set([...store.matchAll(/AdminError\('([a-z-]+)'/g)].map((m) => m[1]));
  // Код отказа при чтении adminConfig передаётся в readConfig вторым аргументом
  for (const m of store.matchAll(/, '([a-z-]+)'\);/g)) thrown.add(m[1]);
  thrown.delete('no-access'); // внутренний: fetchOwnerStatus превращает его в access: 'none'
  for (const code of thrown) assert.ok(ADMIN_ERROR_CODES.includes(code), `нет в ADMIN_ERROR_CODES: ${code}`);
  // Общие коды toAdminError (adminErrors.js)
  for (const code of ['denied', 'network', 'not-configured', 'failed']) assert.ok(ADMIN_ERROR_CODES.includes(code), code);
  assert.deepEqual(new Set(ADMIN_ERROR_CODES), new Set([...thrown, 'denied', 'network', 'not-configured', 'failed']));
  for (const [lang, dict] of Object.entries(dicts)) {
    assert.deepEqual(Object.keys(dict.admin.admins.errors).sort(), [...ADMIN_ERROR_CODES].sort(), lang);
  }
  assert.equal(adminErrorKey('offer-stale'), 'admin.admins.errors.offer-stale');
  assert.equal(adminErrorKey('что-то-новое'), 'admin.admins.errors.failed');
  assert.equal(adminErrorKey(undefined), 'admin.admins.errors.failed');
});

test('компоненты: все ключи переводов, которые они используют, есть на ru, ky, en', () => {
  const src = COMPONENTS.map(read).join('\n');
  const keys = new Set([...src.matchAll(/\bt\('([a-zA-Z0-9_.-]+)'/g)].map((m) => m[1]));
  // Ключи окна подтверждения (KINDS) и шаблонные ключи
  for (const m of read('src/components/admin/AdminConfirmDialog.jsx').matchAll(/'((?:revoke|transfer|uid|dialog)\.[a-zA-Z.]+)'/g)) {
    keys.add(`admin.admins.${m[1]}`);
  }
  for (const role of ADMIN_ROLES) keys.add(`admin.admins.roles.${role}`).add(`admin.admins.roleHint.${role}`);
  for (const d of ['outgoing', 'incoming']) keys.add(`admin.admins.transfer.${d}Title`).add(`admin.admins.transfer.${d}Text`);
  for (const code of ADMIN_ERROR_CODES) keys.add(adminErrorKey(code));
  assert.ok(keys.size > 50, `ключей: ${keys.size}`);
  for (const [lang, dict] of Object.entries(dicts)) {
    assert.deepEqual([...keys].filter((k) => typeof get(dict, k) !== 'string'), [], lang);
  }
});

// ---------- Чистые функции ----------

test('adminRoleOf, adminDisplayName, shortUid, adminMentionName: пустые и длинные значения', () => {
  assert.equal(adminRoleOf({ isOwner: true, isPendingOwner: true }), 'owner');
  assert.equal(adminRoleOf({ isPendingOwner: true }), 'pending');
  for (const a of [{}, null, undefined, { isOwner: 'да' }]) assert.equal(adminRoleOf(a), a?.isOwner ? 'owner' : 'admin');
  assert.equal(adminDisplayName({ label: '  Сестра ' }), 'Сестра');
  for (const label of ['', '   ', null, undefined, 42]) assert.equal(adminDisplayName({ label }), null);
  assert.equal(adminDisplayName({ label: LONG_LABEL }), LONG_LABEL, 'длинная подпись не обрезается');
  assert.equal(shortUid(''), '');
  assert.equal(shortUid(undefined), '');
  assert.equal(shortUid('short-uid'), 'short-uid');
  assert.equal(shortUid(LONG_UID), 'AAAAAA…bbbb');
  assert.equal(adminMentionName({ uid: LONG_UID, label: ' ' }), 'AAAAAA…bbbb');
  assert.equal(adminMentionName({ uid: '', label: '' }), '—');
  assert.equal(adminMentionName({ uid: LONG_UID, label: 'Менеджер' }), 'Менеджер');
});

test('adminGrantedBy и revokeBlockReason — как в adminAdminsStore.js и firestore.rules', () => {
  assert.deepEqual(adminGrantedBy({ grantedBy: 'console' }, 'me'), { kind: 'console' });
  assert.deepEqual(adminGrantedBy({ grantedBy: 'me' }, 'me'), { kind: 'you' });
  assert.deepEqual(adminGrantedBy({ grantedBy: LONG_UID }, 'me'), { kind: 'uid', uid: LONG_UID });
  for (const a of [{}, { grantedBy: '' }, { grantedBy: 5 }, null]) assert.equal(adminGrantedBy(a, 'me'), null);
  assert.equal(revokeBlockReason({ uid: 'me', isOwner: true }, 'me'), 'self');
  assert.equal(revokeBlockReason({ uid: 'x', isOwner: true }, 'me'), 'owner');
  assert.equal(revokeBlockReason({ uid: 'x', isPendingOwner: true }, 'me'), 'pending');
  assert.equal(revokeBlockReason({ uid: 'x' }, 'me'), null);
  assert.equal(revokeBlockReason({ uid: '' }, 'me'), 'self', 'без UID — ничего не отзывается');
  assert.equal(isRetryableAdminError('network'), true);
  assert.equal(isRetryableAdminError('failed'), true);
  for (const code of ['offer-stale', 'no-offer', 'denied', 'not-owner', undefined]) assert.equal(isRetryableAdminError(code), false, String(code));
});

// ---------- Компоненты: исходный текст ----------

test('компоненты: обычный текст (без HTML), действия только переданные снаружи, доступное окно подтверждения', () => {
  for (const file of COMPONENTS) assert.doesNotMatch(read(file), /dangerouslySetInnerHTML|innerHTML/, file);
  const card = read('src/components/admin/AdminMemberCard.jsx');
  assert.match(card, /\{children && <div className="admin-member__actions">\{children\}<\/div>\}/);
  assert.doesNotMatch(card, /<button/);
  assert.match(card, /<code className="admin-member__uid">\{admin\?\.uid \|\| '—'\}<\/code>/);
  const notice = read('src/components/admin/OwnerTransferNotice.jsx');
  assert.match(notice, /\{children && <div className="admin-transfer__actions">\{children\}<\/div>\}/);
  assert.doesNotMatch(notice, /<button/);
  const dialog = read('src/components/admin/AdminConfirmDialog.jsx');
  for (const part of [
    /role="alertdialog"/,
    /aria-modal="true"/,
    /aria-labelledby="admin-confirm-title"/,
    /cancelRef\.current\?\.focus\(\)/,
    /e\.key === 'Escape'/,
    /if \(!busy\) onCancel\(\)/,
    /const outside = !dialogRef\.current\.contains\(document\.activeElement\)/,
    /errorRef\.current\.focus\(\{ preventScroll: true \}\)/,
    /const blockedByError = Boolean\(error\) && !isRetryableAdminError\(error\);/,
    /const canConfirm = understood && !busy && !blockedByError;/,
    /disabled=\{!canConfirm\}/,
    /if \(canConfirm\) onConfirm\(\)/,
  ]) {
    assert.match(dialog, part);
  }
});

// ---------- Компоненты: настоящая отрисовка (react-dom/server) ----------

test('отрисовка: карточки, метки, блок передачи и окно — длинные и пустые UID, длинные подписи, ошибки, три языка', async () => {
  const esbuild = await import('esbuild');
  const root = new URL('..', import.meta.url).pathname;
  const dir = mkdtempSync(join(tmpdir(), 'aroma-a5-'));
  try {
    const entry = join(dir, 'entry.jsx');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(
      entry,
      `import { renderToStaticMarkup } from 'react-dom/server';
       import i18n from '${root}src/i18n.js';
       import AdminRoleBadge from '${root}src/components/admin/AdminRoleBadge.jsx';
       import AdminMemberCard from '${root}src/components/admin/AdminMemberCard.jsx';
       import OwnerTransferNotice from '${root}src/components/admin/OwnerTransferNotice.jsx';
       import AdminConfirmDialog from '${root}src/components/admin/AdminConfirmDialog.jsx';
       export { i18n };
       export const html = (el) => renderToStaticMarkup(el);
       export { AdminRoleBadge, AdminMemberCard, OwnerTransferNotice, AdminConfirmDialog };`,
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
      nodePaths: [join(root, 'node_modules')],
      define: { 'import.meta.env': '{}' },
      // i18n.js при загрузке пишет язык в <html> и читает localStorage — в node их нет
      banner: {
        js: "globalThis.document ??= { documentElement: { setAttribute() {} } }; globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} }; import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
    });
    const m = await import(pathToFileURL(outfile).href);
    const { createElement: h } = await import('react');
    const owner = { uid: 'ownerUID1234567890', label: 'Владелец', grantedAt: '2026-11-01T10:00:00.000Z', grantedBy: 'console', legacy: false, isOwner: true, isPendingOwner: false };
    const pending = { uid: LONG_UID, label: LONG_LABEL, grantedAt: null, grantedBy: 'ownerUID1234567890', legacy: false, isOwner: false, isPendingOwner: true };
    const empty = { uid: '', label: '  ', grantedAt: null, grantedBy: null, legacy: true, isOwner: false, isPendingOwner: false };
    const xss = { uid: 'x1', label: '<img src=x onerror=alert(1)>', grantedAt: null, grantedBy: LONG_UID, legacy: false, isOwner: false, isPendingOwner: false };

    for (const lang of ['ru', 'ky', 'en']) {
      await m.i18n.changeLanguage(lang);
      const t = dicts[lang].admin.admins;
      const all = [
        m.html(h(m.AdminMemberCard, { admin: owner, currentUid: owner.uid })),
        m.html(h(m.AdminMemberCard, { admin: pending, currentUid: owner.uid })),
        m.html(h(m.AdminMemberCard, { admin: empty, currentUid: owner.uid })),
        m.html(h(m.OwnerTransferNotice, { direction: 'outgoing', name: LONG_LABEL, uid: LONG_UID })),
        m.html(h(m.OwnerTransferNotice, { direction: 'incoming', name: 'Владелец', uid: owner.uid })),
        ...['revoke', 'offer', 'accept'].map((kind) => m.html(h(m.AdminConfirmDialog, { kind, name: LONG_LABEL, uid: LONG_UID, onConfirm() {}, onCancel() {} }))),
      ].join('\n');
      assert.doesNotMatch(all, /admin\.admins\./, `${lang}: непереведённые ключи`);
      assert.ok(all.includes(t.roles.owner) && all.includes(t.roles.pending), lang);
      assert.ok(all.includes(t.list.you) && all.includes(t.list.noLabel) && all.includes(t.list.legacy), lang);
      assert.ok(all.includes(t.revoke.title) && all.includes(t.transfer.offerTitle) && all.includes(t.transfer.acceptTitle), lang);
    }
    await m.i18n.changeLanguage('ru');

    // Длинный UID и подпись выводятся целиком; пустой UID — прочерк, пустая подпись — «Без подписи»
    const longCard = m.html(h(m.AdminMemberCard, { admin: pending, currentUid: owner.uid }));
    assert.ok(longCard.includes(`<code class="admin-member__uid">${LONG_UID}</code>`));
    assert.ok(longCard.includes(LONG_LABEL));
    assert.ok(longCard.includes('admin-badge--role-pending'));
    assert.ok(longCard.includes('Вами'), 'доступ кандидату выдал вошедший владелец');
    const emptyCard = m.html(h(m.AdminMemberCard, { admin: empty, currentUid: owner.uid }));
    assert.ok(emptyCard.includes('<code class="admin-member__uid">—</code>'));
    assert.ok(emptyCard.includes('admin-member__name is-empty">Без подписи'));
    assert.ok(emptyCard.includes('Старая запись'));
    assert.ok(!emptyCard.includes('Кем выдан'), 'неизвестно, кем выдан — строки нет');
    // HTML в подписи — обычный текст
    const xssCard = m.html(h(m.AdminMemberCard, { admin: xss, currentUid: owner.uid }));
    assert.ok(xssCard.includes('&lt;img src=x onerror=alert(1)&gt;') && !xssCard.includes('<img'));
    assert.ok(xssCard.includes(`Администратором с UID ${LONG_UID}`), 'выдан другим администратором — его полный UID');
    // Действия — только переданные
    assert.ok(!m.html(h(m.AdminMemberCard, { admin: owner, currentUid: owner.uid })).includes('admin-member__actions'));
    const withAction = m.html(h(m.AdminMemberCard, { admin: owner, currentUid: owner.uid }, h('button', { type: 'button' }, 'Действие')));
    assert.ok(withAction.includes('admin-member__actions') && withAction.includes('Действие'));
    // Метка и блок: неизвестные значения — ничего
    assert.equal(m.html(h(m.AdminRoleBadge, { role: 'superadmin' })), '');
    assert.equal(m.html(h(m.OwnerTransferNotice, { direction: 'sideways', name: 'x' })), '');
    assert.ok(m.html(h(m.AdminRoleBadge, { role: 'owner' })).includes('Главный администратор'));
    // Окно: подтверждение выключено, пока не отмечен флажок; ошибки — понятным текстом
    const dlg = m.html(h(m.AdminConfirmDialog, { kind: 'revoke', name: LONG_LABEL, uid: LONG_UID, onConfirm() {}, onCancel() {} }));
    assert.match(dlg, /role="alertdialog"/);
    assert.match(dlg, /<button type="submit" class="btn admin-delete-dialog__confirm" disabled=""/);
    assert.ok(dlg.includes(LONG_UID) && dlg.includes(`Я понимаю, что ${LONG_LABEL} потеряет доступ`));
    const stale = m.html(h(m.AdminConfirmDialog, { kind: 'accept', name: 'Владелец', error: 'offer-stale', onConfirm() {}, onCancel() {} }));
    assert.ok(stale.includes(dicts.ru.admin.admins.errors['offer-stale']));
    const unknown = m.html(h(m.AdminConfirmDialog, { kind: 'offer', name: 'X', error: 'что-то-новое', onConfirm() {}, onCancel() {} }));
    assert.ok(unknown.includes(dicts.ru.admin.admins.errors.failed));
    assert.equal(m.html(h(m.AdminConfirmDialog, { kind: 'drop-database', onConfirm() {}, onCancel() {} })), '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- Стили и границы этапа ----------

test('стили: классы компонентов есть, цвета — переменные темы, без @media, UID и подписи переносятся', () => {
  const css = ['admin', 'pages', 'components', 'base', 'layout'].map((f) => read(`src/styles/${f}.css`)).join('\n');
  const src = COMPONENTS.map(read).join('\n');
  const classes = new Set(
    [...src.matchAll(/className=\{?[`"]([^`"]+)[`"]/g)]
      .flatMap((m) => m[1].replace(/\$\{[^}]*\}/g, ' ').split(/\s+/))
      .filter((c) => /^[a-z][a-z0-9_-]*$/.test(c) && !c.endsWith('-') && !c.endsWith('--')),
  );
  for (const role of ADMIN_ROLES) classes.add(`admin-badge--role-${role}`);
  ['admin-member--owner', 'admin-member--pending', 'admin-transfer--incoming', 'admin-confirm-dialog--offer', 'admin-confirm-dialog--accept'].forEach((c) => classes.add(c));
  classes.delete('admin-delete-dialog__overlay'); // метка фона окна, как у окон удаления (оформление — payment-modal-overlay)
  classes.delete('is-empty');
  const missing = [...classes].filter((c) => !new RegExp(`\\.${c}(?![a-z0-9_-])`).test(css));
  assert.deepEqual(missing, []);
  const admin = read('src/styles/admin.css');
  const block = admin.slice(admin.indexOf('/* ---------- Администраторы: основа раздела (этап A5) ---------- */'));
  assert.ok(block.length > 1500);
  assert.doesNotMatch(block, /#[0-9a-f]{3,8}\b|rgba?\(/i, 'цвета — только переменные (светлая и тёмная темы)');
  const rulesOnly = block.replace(/\/\*[\s\S]*?\*\//g, ''); // без комментариев
  assert.doesNotMatch(rulesOnly, /@media\s*\(/, 'общая адаптивная вёрстка не меняется');
  assert.doesNotMatch(rulesOnly, /#[0-9a-f]{3,8}\b|rgba?\(/i);
  assert.match(block, /\.admin-member__uid,\s*\.admin-transfer__uid code \{[^}]*word-break: break-all;[^}]*overflow-wrap: anywhere;/);
  assert.match(block, /\.admin-member__name \{[^}]*overflow-wrap: anywhere;/);
  assert.match(block, /\.admin-confirm-dialog \.admin-review-delete__check span,/);
  assert.match(block, /\.admin-confirm-dialog \.admin-delete-dialog__actions \{\s*flex-wrap: nowrap;/);
  const dark = read('src/styles/variables.css').slice(read('src/styles/variables.css').indexOf("[data-theme='dark']"));
  for (const v of ['--gold', '--gold-soft', '--info', '--info-bg', '--surface-2', '--rose-soft', '--warning', '--warning-bg', '--border-strong']) {
    assert.match(dark, new RegExp(`${v}:`), `dark ${v}`);
  }
});

test('компоненты A5: без обращений к сервису; используются только разделом «Администраторы» и главной (уведомление)', () => {
  for (const file of COMPONENTS) assert.doesNotMatch(read(file), /services\//, `${file}: сервис не подключён`);
  // Другие разделы компоненты администраторов не используют
  for (const page of ['AdminApp', 'AdminSectionPage', 'AdminReviewsPage', 'AdminProductsPage', 'AdminOrdersPage', 'AdminCustomersPage']) {
    assert.doesNotMatch(read(`src/pages/admin/${page}.jsx`), /AdminMemberCard|AdminConfirmDialog|OwnerTransferNotice|AdminRoleBadge/, page);
  }
  // На главной — только уведомление кандидату о предложении (Блок 2)
  const dash = read('src/pages/admin/AdminDashboardPage.jsx');
  assert.doesNotMatch(dash, /AdminMemberCard|AdminConfirmDialog|AdminRoleBadge/);
  assert.match(dash, /\{access === 'pending' && \(\s*<OwnerTransferNotice direction="incoming"/);
});
