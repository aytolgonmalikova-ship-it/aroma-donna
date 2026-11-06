// Тесты сервиса администраторов (этап A4) без эмулятора: проверка входных данных до обращения
// к Firebase, преобразование документов, коды ошибок (настоящие ошибки не скрываются)
// и границы этапа. Поведение с настоящими правилами — tests-emulator/adminAdminsStore.emulator.js
// (npm run test:rules). Запуск: npm test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AdminError } from '../src/services/adminErrors.js';
import {
  ADMIN_LABEL_MAX,
  acceptOwnerTransfer,
  cancelOwnerTransfer,
  declineOwnerTransfer,
  fetchAdmins,
  fetchOwnerStatus,
  grantAdmin,
  isUid,
  normalizeAdminLabel,
  offerOwnerTransfer,
  revokeAdmin,
  toAdminRecord,
  toOwnerConfig,
} from '../src/services/adminAdminsStore.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const ts = (iso) => ({ toDate: () => new Date(iso) });

/** Firebase, к которому нельзя обращаться: любой вызов — провал теста */
function untouchable() {
  const calls = [];
  const dbApi = new Proxy({}, { get: (_, name) => (...args) => { calls.push([name, args]); throw new Error(`обращение к Firebase: ${String(name)}`); } });
  return { fb: { db: {}, dbApi }, calls };
}

/** Firebase, у которого getDoc / getDocs / runTransaction отвечают заданной ошибкой */
function failing(code) {
  const err = Object.assign(new Error(code), { code });
  const reject = async () => { throw err; };
  return {
    db: {},
    dbApi: { doc: () => ({}), collection: () => ({}), getDoc: reject, getDocs: reject, runTransaction: reject, serverTimestamp: () => 'ts' },
  };
}

async function rejectsWith(promise, code) {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof AdminError, `ожидалась AdminError, получено ${err}`);
    assert.equal(err.code, code);
    return true;
  });
}

test('isUid — тот же формат, что isUid() в firestore.rules', () => {
  for (const ok of ['abc', 'A1_b-2', 'x'.repeat(128), 'admin-uid']) assert.equal(isUid(ok), true, ok);
  for (const bad of ['', 'a.b', 'a b', 'a/b', 'x'.repeat(129), null, undefined, 42]) assert.equal(isUid(bad), false, String(bad));
  const rules = read('firestore.rules');
  assert.ok(rules.includes("value.matches('^[A-Za-z0-9_-]{1,128}$')"), 'шаблон совпадает с правилами');
});

test('normalizeAdminLabel: пробелы обрезаются, пустая — без подписи, длиннее 100 или не строка — invalid-label', () => {
  assert.equal(normalizeAdminLabel('  Сестра  '), 'Сестра');
  for (const empty of [undefined, null, '', '   ']) assert.equal(normalizeAdminLabel(empty), null);
  assert.equal(normalizeAdminLabel('x'.repeat(ADMIN_LABEL_MAX)), 'x'.repeat(100));
  for (const bad of ['x'.repeat(101), 42, {}]) assert.throws(() => normalizeAdminLabel(bad), (e) => e.code === 'invalid-label');
});

test('toOwnerConfig и toAdminRecord: роль — только из adminConfig, поле role не читается; старые документы', () => {
  const cfg = toOwnerConfig({ ownerUid: 'own', pendingOwnerUid: 'cand', previousOwnerUid: null, updatedAt: ts('2026-11-05T10:00:00Z'), updatedBy: 'own' });
  assert.deepEqual(cfg, { ownerUid: 'own', pendingOwnerUid: 'cand', previousOwnerUid: null, updatedAt: '2026-11-05T10:00:00.000Z', updatedBy: 'own' });
  assert.deepEqual(toOwnerConfig({ ownerUid: 'a.b', pendingOwnerUid: 7 }), { ownerUid: null, pendingOwnerUid: null, previousOwnerUid: null, updatedAt: null, updatedBy: null });
  // role: 'owner' в документе не делает владельцем
  assert.deepEqual(toAdminRecord('x', { role: 'owner' }, cfg), { uid: 'x', label: null, grantedAt: null, grantedBy: null, legacy: true, isOwner: false, isPendingOwner: false });
  const fresh = toAdminRecord('own', { grantedAt: ts('2026-11-01T00:00:00Z'), grantedBy: 'console', label: 'Я' }, cfg);
  assert.deepEqual(fresh, { uid: 'own', label: 'Я', grantedAt: '2026-11-01T00:00:00.000Z', grantedBy: 'console', legacy: false, isOwner: true, isPendingOwner: false });
  assert.equal(toAdminRecord('cand', {}, cfg).isPendingOwner, true);
  assert.equal(toAdminRecord('own', {}, null).isOwner, false, 'без adminConfig владельца нет');
});

test('неверные входные данные отклоняются до обращения к Firebase', async () => {
  const { fb, calls } = untouchable();
  await rejectsWith(grantAdmin(fb, 'own', 'a.b'), 'invalid-uid');
  await rejectsWith(grantAdmin(fb, 'own', 'own'), 'self');
  await rejectsWith(grantAdmin(fb, 'own', 'other', { label: 'x'.repeat(101) }), 'invalid-label');
  await rejectsWith(revokeAdmin(fb, 'own', 'own'), 'self');
  await rejectsWith(revokeAdmin(fb, 'own', ''), 'invalid-uid');
  await rejectsWith(offerOwnerTransfer(fb, 'own', 'own'), 'self');
  await rejectsWith(offerOwnerTransfer(fb, 'own', 'a/b'), 'invalid-uid');
  // Нет входа (нет UID) — not-signed-in во всех операциях
  for (const call of [
    () => fetchOwnerStatus(fb, null),
    () => fetchAdmins(fb, undefined),
    () => grantAdmin(fb, '', 'other'),
    () => revokeAdmin(fb, null, 'other'),
    () => offerOwnerTransfer(fb, null, 'other'),
    () => cancelOwnerTransfer(fb, null),
    () => declineOwnerTransfer(fb, null),
    () => acceptOwnerTransfer(fb, null),
  ]) {
    await rejectsWith(call(), 'not-signed-in');
  }
  assert.deepEqual(calls, []);
});

test('отказ правил при чтении adminConfig — ожидаемый ответ; настоящие ошибки не скрываются', async () => {
  // Обычный администратор: отказ → «не владелец», а не ошибка
  assert.deepEqual(await fetchOwnerStatus(failing('permission-denied'), 'adm'), { access: 'none', config: null });
  await rejectsWith(fetchAdmins(failing('permission-denied'), 'adm'), 'not-owner');
  // Сеть и прочие ошибки остаются собой
  await rejectsWith(fetchOwnerStatus(failing('unavailable'), 'adm'), 'network');
  await rejectsWith(fetchOwnerStatus(failing('internal'), 'adm'), 'failed');
  await rejectsWith(fetchAdmins(failing('deadline-exceeded'), 'own'), 'network');
  // Отказ правил при записи (транзакция) — denied, а не «не владелец»
  await rejectsWith(grantAdmin(failing('permission-denied'), 'own', 'other'), 'denied');
  await rejectsWith(acceptOwnerTransfer(failing('permission-denied'), 'cand'), 'denied');
  await rejectsWith(revokeAdmin(failing('unavailable'), 'own', 'other'), 'network');
});

test('хранилище: изменения только транзакциями, по одному документу, время — от сервера, без поля role', () => {
  const store = read('src/services/adminAdminsStore.js');
  assert.doesNotMatch(store, /writeBatch|deleteDoc|setDoc|updateDoc|addDoc/);
  assert.equal(store.match(/dbApi\.runTransaction\(/g).length, 6, 'grant, revoke, offer, cancel, decline, accept');
  assert.equal(store.match(/tx\.delete\(/g).length, 1, 'отзыв — одного администратора');
  assert.equal(store.match(/tx\.set\(/g).length, 1);
  assert.equal(store.match(/tx\.update\(/g).length, 4);
  assert.match(store, /grantedAt: dbApi\.serverTimestamp\(\)/);
  assert.match(store, /updatedAt: dbApi\.serverTimestamp\(\), updatedBy: actorUid/);
  assert.doesNotMatch(store, /\.role\b|\['role'\]/);
  assert.doesNotMatch(store, /firebase-admin|getAuth|currentUser/);
});

test('adminService: UID вошедшего — только из Firebase Auth, интерфейс не передаёт actorUid', () => {
  const service = read('src/services/adminService.js');
  assert.match(service, /const actorUid = fb\.auth\.currentUser\?\.uid;/);
  assert.match(service, /if \(!actorUid\) throw new AdminError\('not-signed-in'\);/);
  const names = ['fetchOwnerStatus', 'fetchAdmins', 'grantAdmin', 'revokeAdmin', 'offerOwnerTransfer', 'cancelOwnerTransfer', 'declineOwnerTransfer', 'acceptOwnerTransfer'];
  for (const name of names) {
    const m = service.match(new RegExp(`export const ${name} = \\(([^)]*)\\) =>\\s*withActor\\(adminsStore\\.${name}\\b`));
    assert.ok(m, name);
    assert.doesNotMatch(m[1], /actor|uid.*uid/i, `${name}: нельзя передать UID вызывающего`);
  }
});

test('сервис подключён к разделу только через страницу (Блок 2); правила A3.1 не ослаблены', () => {
  // Раздел подключён в Блоке 2: только для главного администратора
  assert.match(read('src/components/admin/adminSections.js'), /\{ path: 'admins', icon: 'shield', stage: 6, ready: true, ownerOnly: true \}/);
  // Хранилище вызывается только через adminService (страница и useOwnerAccess), не напрямую из интерфейса
  for (const file of ['src/pages/admin/AdminApp.jsx', 'src/pages/admin/AdminAdminsPage.jsx', 'src/hooks/useOwnerAccess.jsx', 'src/layouts/AdminLayout.jsx']) {
    assert.doesNotMatch(read(file), /from '[^']*adminAdminsStore/, file);
  }
  const rules = read('firestore.rules');
  assert.ok(rules.includes('existsAfter(/databases/$(database)/documents/admins/$(after.pendingOwnerUid))'));
  assert.ok(rules.includes('adminId != adminConfigAfter().pendingOwnerUid'));
  assert.ok(rules.includes('allow update: if false;'));
});
