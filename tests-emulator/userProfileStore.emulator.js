// Тесты профиля покупателя при входе через Google (Блок 2, src/services/userProfileStore.js)
// на Firebase Emulator с настоящими правилами firestore.rules (правило users не менялось).
// Запуск: npm run test:rules (проект demo-aroma-donna существует только в эмуляторе).
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertFails, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import * as dbApi from 'firebase/firestore';
import { ensureUserProfile, PROFILE_NAME_MAX } from '../src/services/userProfileStore.js';

const PROJECT_ID = 'demo-aroma-donna';
let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
  });
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'запускайте через npm run test:rules');
  assert.ok(PROJECT_ID.startsWith('demo-'));
});
beforeEach(async () => env.clearFirestore());
after(async () => env?.cleanup());

const as = (uid) => ({ db: env.authenticatedContext(uid).firestore(), dbApi });
const googleUser = (uid, extra = {}) => ({ uid, email: `${uid}@gmail.com`, displayName: 'Айгерим', ...extra });
async function readRaw(path) {
  let data;
  await env.withSecurityRulesDisabled(async (ctx) => {
    const snap = await dbApi.getDoc(dbApi.doc(ctx.firestore(), ...path.split('/')));
    data = snap.exists() ? snap.data() : null;
  });
  return data;
}
async function countUsers() {
  let n;
  await env.withSecurityRulesDisabled(async (ctx) => {
    n = (await dbApi.getDocs(dbApi.collection(ctx.firestore(), 'users'))).size;
  });
  return n;
}

describe('профиль при входе через Google', () => {
  test('новый пользователь: профиль { name, email, createdAt } создаётся по правилу users', async () => {
    const res = await ensureUserProfile(as('g1'), googleUser('g1', { email: 'Aigerim.Test@Gmail.com' }));
    assert.deepEqual(res, { created: true, profile: { name: 'Айгерим', email: 'aigerim.test@gmail.com' } });
    const saved = await readRaw('users/g1');
    assert.deepEqual(Object.keys(saved).sort(), ['createdAt', 'email', 'name']);
    assert.ok(saved.createdAt instanceof dbApi.Timestamp, 'время ставит сервер');
  });

  test('повторный вход: профиль не перезаписывается и не дублируется (имя в Google сменилось)', async () => {
    await ensureUserProfile(as('g1'), googleUser('g1'));
    const before = await readRaw('users/g1');
    const res = await ensureUserProfile(as('g1'), googleUser('g1', { displayName: 'Другое имя' }));
    assert.deepEqual(res, { created: false, profile: { name: 'Айгерим', email: 'g1@gmail.com' } });
    assert.deepEqual(await readRaw('users/g1'), before);
    assert.equal(await countUsers(), 1);
  });

  test('существующий профиль от регистрации по паролю сохраняется как есть', async () => {
    await env.withSecurityRulesDisabled((ctx) =>
      dbApi.setDoc(dbApi.doc(ctx.firestore(), 'users', 'p1'), { name: 'Покупатель', email: 'p1@gmail.com', createdAt: dbApi.Timestamp.fromDate(new Date('2026-10-01T00:00:00Z')) }),
    );
    const res = await ensureUserProfile(as('p1'), googleUser('p1', { displayName: 'Google Name' }));
    assert.deepEqual(res, { created: false, profile: { name: 'Покупатель', email: 'p1@gmail.com' } });
    assert.equal((await readRaw('users/p1')).name, 'Покупатель');
    assert.equal(await countUsers(), 1);
  });

  test('одновременные входы одного пользователя: профиль один, создан один раз', async () => {
    const results = await Promise.all([ensureUserProfile(as('g2'), googleUser('g2')), ensureUserProfile(as('g2'), googleUser('g2'))]);
    assert.deepEqual(results.map((r) => r.created).sort(), [false, true]);
    assert.equal(await countUsers(), 1);
  });

  test('имя: без имени в Google — часть e-mail; длинное — до 100 символов', async () => {
    assert.equal((await ensureUserProfile(as('g3'), googleUser('g3', { displayName: '   ' }))).profile.name, 'g3');
    assert.equal((await ensureUserProfile(as('g4'), googleUser('g4', { displayName: 'Я'.repeat(150) }))).profile.name.length, PROFILE_NAME_MAX);
  });

  test('чужой профиль создать нельзя: правила users отклоняют (вошедший — другой пользователь)', async () => {
    await assert.rejects(ensureUserProfile(as('attacker'), googleUser('victim')), (err) => err?.code === 'permission-denied');
    assert.equal(await readRaw('users/victim'), null);
    // Гость — тоже нет
    await assertFails(dbApi.setDoc(dbApi.doc(env.unauthenticatedContext().firestore(), 'users', 'victim'), { name: 'x', email: 'x', createdAt: dbApi.serverTimestamp() }));
  });
});
