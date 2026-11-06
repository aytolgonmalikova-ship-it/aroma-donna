// Интеграционные тесты входа через Google и восстановления пароля (Блок 2) на Firebase Auth Emulator
// и Firestore Emulator с настоящими правилами firestore.rules.
//
// Вход через Google — signInWithCredential с тестовым токеном Google, который принимает эмулятор Auth.
// Это проверка поведения эмулятора, а НЕ настоящего Google OAuth: всплывающее окно Google и настройки
// провайдера в Firebase Console проверяются вручную (docs/GOOGLE_AUTH.md).
//
// Запуск: npm run test:rules (эмуляторы Auth и Firestore, проект demo-aroma-donna — только локально).
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteApp, initializeApp } from 'firebase/app';
import * as authApi from 'firebase/auth';
import * as dbApi from 'firebase/firestore';
import { completeGoogleSignIn } from '../src/services/googleAuthFlow.js';
import { sendPasswordReset } from '../src/services/passwordReset.js';

const PROJECT_ID = 'demo-aroma-donna';
const AUTH_HOST = '127.0.0.1:9099';
let env;
let app;
let fb;

before(async () => {
  // Только эмуляторы этого demo-проекта
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, AUTH_HOST, 'запускайте через npm run test:rules');
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'запускайте через npm run test:rules');
  assert.ok(PROJECT_ID.startsWith('demo-'));
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
  });
  app = initializeApp({ apiKey: 'demo-key', authDomain: `${PROJECT_ID}.firebaseapp.com`, projectId: PROJECT_ID, appId: 'demo-app' }, 'auth-flows');
  const auth = authApi.getAuth(app);
  authApi.connectAuthEmulator(auth, `http://${AUTH_HOST}`, { disableWarnings: true });
  const db = dbApi.getFirestore(app);
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  dbApi.connectFirestoreEmulator(db, host, Number(port));
  fb = { auth, db, authApi, dbApi };
});

beforeEach(async () => {
  await authApi.signOut(fb.auth).catch(() => {});
  await env.clearFirestore();
  await fetch(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT_ID}/accounts`, { method: 'DELETE' });
});

after(async () => {
  await authApi.signOut(fb.auth).catch(() => {});
  await deleteApp(app);
  await env?.cleanup();
});

// ---------- Вспомогательное ----------

/** Вход через Google в эмуляторе: тестовый токен (sub — постоянный ID аккаунта Google) */
const google = (sub, email, name = 'Google User') => () =>
  authApi.signInWithCredential(fb.auth, authApi.GoogleAuthProvider.credential(JSON.stringify({ sub, email, email_verified: true, name })));

/** Пользователи Auth с этим e-mail (служебный запрос эмулятора): [{ uid, providers }] */
async function authUsers(email) {
  const res = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:query`, {
    method: 'POST',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ returnUserInfo: true }),
  });
  const { userInfo = [] } = await res.json();
  return userInfo
    .filter((u) => !email || u.email === email)
    .map((u) => ({ uid: u.localId, providers: (u.providerUserInfo || []).map((p) => p.providerId).sort() }));
}

async function raw(fn) {
  let out;
  await env.withSecurityRulesDisabled(async (ctx) => {
    out = await fn(ctx.firestore());
  });
  return out;
}
const readDoc = (path) => raw(async (db) => {
  const snap = await dbApi.getDoc(dbApi.doc(db, ...path.split('/')));
  return snap.exists() ? snap.data() : null;
});
const usersCount = () => raw(async (db) => (await dbApi.getDocs(dbApi.collection(db, 'users'))).size);

/** Регистрация по паролю так же, как в authService.register (профиль — по правилу users) */
async function registerWithPassword(email, password, name) {
  const cred = await authApi.createUserWithEmailAndPassword(fb.auth, email, password);
  await dbApi.setDoc(dbApi.doc(fb.db, 'users', cred.user.uid), { name, email, createdAt: dbApi.serverTimestamp() });
  await raw((db) =>
    dbApi.setDoc(dbApi.doc(db, 'users', cred.user.uid, 'orders', 'order-1'), { id: 'order-1', userId: cred.user.uid, total: 5900, items: [{ id: 'rose', qty: 1 }], status: 'new' }),
  );
  await authApi.signOut(fb.auth);
  return cred.user.uid;
}

/** Последняя ссылка для смены пароля, «отправленная» эмулятором на этот адрес */
async function resetCodeFor(email) {
  const res = await fetch(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT_ID}/oobCodes`);
  const { oobCodes = [] } = await res.json();
  return oobCodes.filter((c) => c.email === email && c.requestType === 'PASSWORD_RESET').at(-1)?.oobCode ?? null;
}

// ---------- Вход через Google ----------

describe('вход через Google (эмулятор Auth, signInWithCredential)', () => {
  test('новый пользователь: аккаунт Google и профиль users/{uid} по правилам', async () => {
    const res = await completeGoogleSignIn(fb, google('sub-1', 'aigerim.g@gmail.com', 'Айгерим'));
    assert.equal(res.created, true);
    assert.deepEqual(await authUsers('aigerim.g@gmail.com'), [{ uid: res.user.uid, providers: ['google.com'] }]);
    const profile = await readDoc(`users/${res.user.uid}`);
    assert.deepEqual([profile.name, profile.email], ['Айгерим', 'aigerim.g@gmail.com']);
    assert.ok(profile.createdAt instanceof dbApi.Timestamp);
  });

  test('повторный вход тем же аккаунтом Google: тот же UID, без дублей, профиль не меняется', async () => {
    const first = await completeGoogleSignIn(fb, google('sub-1', 'aigerim.g@gmail.com', 'Айгерим'));
    const before = await readDoc(`users/${first.user.uid}`);
    await authApi.signOut(fb.auth);
    const again = await completeGoogleSignIn(fb, google('sub-1', 'aigerim.g@gmail.com', 'Новое имя в Google'));
    assert.equal(again.user.uid, first.user.uid);
    assert.equal(again.created, false);
    assert.deepEqual(await readDoc(`users/${first.user.uid}`), before, 'профиль не перезаписан');
    assert.equal((await authUsers()).length, 1);
    assert.equal(await usersCount(), 1);
  });

  test('Google с e-mail аккаунта с паролем: тот же UID, профиль и заказы; второго аккаунта нет', async () => {
    const uid = await registerWithPassword('buyer@gmail.com', 'old-secret-1', 'Покупатель');
    const res = await completeGoogleSignIn(fb, google('sub-buyer', 'buyer@gmail.com', 'Имя из Google'));
    assert.equal(res.user.uid, uid, 'тот же пользователь');
    assert.equal(res.created, false);
    assert.equal((await readDoc(`users/${uid}`)).name, 'Покупатель', 'профиль не перезаписан');
    assert.ok(await readDoc(`users/${uid}/orders/order-1`), 'заказ на месте');
    assert.equal((await authUsers()).length, 1);
    assert.equal(await usersCount(), 1);
    // Поведение Firebase (один аккаунт на e-mail, адрес не подтверждён): остаётся только Google,
    // старый пароль больше не подходит — для этого и нужно «Забыли пароль?»
    assert.deepEqual((await authUsers('buyer@gmail.com'))[0].providers, ['google.com']);
    await authApi.signOut(fb.auth);
    await assert.rejects(authApi.signInWithEmailAndPassword(fb.auth, 'buyer@gmail.com', 'old-secret-1'), (err) => err.code === 'auth/wrong-password');
  });

  test('профиль не удалось сохранить (правила отклонили): выход из аккаунта, понятный код ошибки', async () => {
    // Чужой профиль: вход прошёл, но записать users/{другой uid} правила не дают
    const signIn = async () => {
      const cred = await google('sub-x', 'x@gmail.com')();
      return { user: { ...cred.user, uid: 'someone-else', email: cred.user.email, displayName: cred.user.displayName } };
    };
    await assert.rejects(completeGoogleSignIn(fb, signIn), (err) => err.code === 'profile-failed');
    assert.equal(fb.auth.currentUser, null, 'вышли из аккаунта');
    assert.equal(await readDoc('users/someone-else'), null);
  });
});

// ---------- Восстановление пароля ----------

describe('восстановление пароля (эмулятор Auth, sendPasswordResetEmail)', () => {
  test('ссылка из письма меняет пароль: тот же UID, профиль и заказы не меняются, нового пользователя нет', async () => {
    const uid = await registerWithPassword('reset@test.local', 'old-secret-1', 'Покупатель');
    const profileBefore = await readDoc(`users/${uid}`);
    assert.deepEqual(await sendPasswordReset(fb, ' Reset@Test.Local '), { email: 'reset@test.local' });
    const code = await resetCodeFor('reset@test.local');
    assert.ok(code, 'эмулятор «отправил» письмо со ссылкой');
    await authApi.confirmPasswordReset(fb.auth, code, 'new-secret-2');
    const cred = await authApi.signInWithEmailAndPassword(fb.auth, 'reset@test.local', 'new-secret-2');
    assert.equal(cred.user.uid, uid, 'тот же пользователь');
    await assert.rejects(authApi.signInWithEmailAndPassword(fb.auth, 'reset@test.local', 'old-secret-1'));
    assert.deepEqual(await readDoc(`users/${uid}`), profileBefore, 'профиль не изменён');
    assert.ok(await readDoc(`users/${uid}/orders/order-1`), 'заказ на месте');
    assert.equal((await authUsers()).length, 1);
    assert.equal(await usersCount(), 1);
  });

  test('после входа через Google пароль возвращается через «Забыли пароль?»; затем работают оба способа — один аккаунт', async () => {
    const uid = await registerWithPassword('buyer@gmail.com', 'old-secret-1', 'Покупатель');
    const providers = async () => (await authUsers('buyer@gmail.com'))[0].providers;
    // 1) Google «забирает» аккаунт с неподтверждённым адресом: остаётся только Google
    await completeGoogleSignIn(fb, google('sub-buyer', 'buyer@gmail.com'));
    await authApi.signOut(fb.auth);
    assert.deepEqual(await providers(), ['google.com']);
    // 2) Восстановление пароля: вход по паролю снова есть (эмулятор показывает только password)
    await sendPasswordReset(fb, 'buyer@gmail.com');
    await authApi.confirmPasswordReset(fb.auth, await resetCodeFor('buyer@gmail.com'), 'new-secret-2');
    assert.deepEqual(await providers(), ['password']);
    assert.equal((await authApi.signInWithEmailAndPassword(fb.auth, 'buyer@gmail.com', 'new-secret-2')).user.uid, uid);
    await authApi.signOut(fb.auth);
    // 3) Снова Google: адрес уже подтверждён письмом — Google добавляется, пароль сохраняется
    const again = await completeGoogleSignIn(fb, google('sub-buyer', 'buyer@gmail.com'));
    assert.equal(again.user.uid, uid);
    assert.equal(again.created, false);
    await authApi.signOut(fb.auth);
    assert.deepEqual(await providers(), ['google.com', 'password'], 'оба способа входа');
    assert.equal((await authApi.signInWithEmailAndPassword(fb.auth, 'buyer@gmail.com', 'new-secret-2')).user.uid, uid);
    // На всех шагах — один пользователь, профиль и заказ прежние
    assert.equal((await authUsers()).length, 1);
    assert.equal((await readDoc(`users/${uid}`)).name, 'Покупатель');
    assert.ok(await readDoc(`users/${uid}/orders/order-1`));
    assert.equal(await usersCount(), 1);
  });

  test('неизвестный e-mail: тот же ответ, письма нет, аккаунт и профиль не создаются', async () => {
    assert.deepEqual(await sendPasswordReset(fb, 'nobody@test.local'), { email: 'nobody@test.local' });
    assert.equal(await resetCodeFor('nobody@test.local'), null);
    assert.deepEqual(await authUsers(), []);
    assert.equal(await usersCount(), 0);
  });
});
