// Тесты входа через Google и восстановления пароля (Блок 2) без эмулятора и без настоящего Google:
// логика после входа (googleAuthFlow.js) и письмо для смены пароля (passwordReset.js) — на контролируемой
// подмене Firebase Auth; ключи ошибок, состояние Redux, страница входа и формы — отрисовкой react-dom/server.
// С эмулятором Auth — tests-emulator/authFlows.emulator.js (npm run test:rules).
// Настоящий Google OAuth здесь не проверяется — это ручная проверка (docs/GOOGLE_AUTH.md). Запуск: npm test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PROFILE_NAME_MAX, profileNameFrom } from '../src/services/userProfileStore.js';
import { GoogleProfileError, completeGoogleSignIn, createGoogleProvider } from '../src/services/googleAuthFlow.js';
import { sendPasswordReset } from '../src/services/passwordReset.js';
import { validatePasswordReset } from '../src/utils/validation.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const get = (obj, key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const dicts = Object.fromEntries(['ru', 'ky', 'en'].map((l) => [l, JSON.parse(read(`src/locales/${l}/translation.json`))]));
const ROOT = new URL('..', import.meta.url).pathname;

// authService.js, userSlice.js и страницы импортируют модули без расширений (как принято у Vite) —
// для node собираем их через esbuild (уже есть у Vite) во временную папку, которая сразу удаляется
async function loadBundle() {
  const esbuild = await import('esbuild');
  const dir = mkdtempSync(join(tmpdir(), 'aroma-google-'));
  try {
    const entry = join(dir, 'entry.jsx');
    writeFileSync(
      entry,
      `import { renderToStaticMarkup } from 'react-dom/server';
       import { MemoryRouter } from 'react-router-dom';
       import { Provider } from 'react-redux';
       import { configureStore } from '@reduxjs/toolkit';
       import i18n from '${ROOT}src/i18n.js';
       import AuthPage from '${ROOT}src/pages/AuthPage.jsx';
       import ForgotPasswordPage from '${ROOT}src/pages/ForgotPasswordPage.jsx';
       import GoogleSignInButton from '${ROOT}src/components/forms/GoogleSignInButton.jsx';
       export { AUTH_MODE, loginWithGoogle, requestPasswordReset, toErrorKey } from '${ROOT}src/services/authService.js';
       export { default as reducer, loginUser, loginWithGoogleUser } from '${ROOT}src/features/user/userSlice.js';
       export { i18n };
       const html = (user, el) => {
         const store = configureStore({ reducer: () => ({ user: { error: null, status: 'idle', current: null, mode: 'firebase', ...user }, notifications: { list: [] } }) });
         return renderToStaticMarkup(<Provider store={store}><MemoryRouter>{el}</MemoryRouter></Provider>);
       };
       export const authPage = (user, mode = 'login') => html(user, <AuthPage mode={mode} />);
       export const forgotPage = (user) => html(user, <ForgotPasswordPage />);
       export const googleButton = (status) => html({ status }, <GoogleSignInButton />);`,
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

// ---------- Контролируемая подмена Firebase ----------

const fbError = (code) => Object.assign(new Error(code), { code });

/**
 * Firebase Auth и Firestore в памяти: signIn — исход входа (пользователь или ошибка),
 * users — существующие профили, writeError — ошибка записи профиля.
 */
function fakeFirebase({ users = {}, writeError = null } = {}) {
  const docs = new Map(Object.entries(users));
  const log = { signOut: 0, writes: [], resetEmails: [] };
  const fb = {
    auth: { name: 'auth' },
    db: { name: 'db' },
    log,
    docs,
    authApi: {
      GoogleAuthProvider: class {
        setCustomParameters(p) {
          this.params = p;
        }
      },
      signOut: async () => {
        log.signOut += 1;
      },
      sendPasswordResetEmail: async (auth, email) => {
        log.resetEmails.push(email);
        if (fb.resetError) throw fbError(fb.resetError);
      },
    },
    dbApi: {
      doc: (db, col, id) => ({ col, id }),
      serverTimestamp: () => 'SERVER_TIME',
      runTransaction: async (db, fn) => {
        const writes = [];
        const result = await fn({
          get: async (ref) => ({ exists: () => docs.has(ref.id), data: () => ({ ...docs.get(ref.id) }) }),
          set: (ref, data) => writes.push([ref.id, data]),
        });
        if (writes.length && writeError) throw fbError(writeError);
        for (const [id, data] of writes) {
          docs.set(id, data);
          log.writes.push([id, data]);
        }
        return result;
      },
    },
  };
  return fb;
}
const googleUser = (extra = {}) => ({ user: { uid: 'g-uid', email: 'Aigerim@Gmail.com', displayName: 'Айгерим', ...extra } });

// ---------- Логика после входа через Google ----------

test('Google: новый пользователь — профиль создан один раз, выхода нет', async () => {
  const fb = fakeFirebase();
  const res = await completeGoogleSignIn(fb, async () => googleUser());
  assert.equal(res.created, true);
  assert.deepEqual(res.profile, { name: 'Айгерим', email: 'aigerim@gmail.com' });
  assert.deepEqual(fb.log.writes, [['g-uid', { name: 'Айгерим', email: 'aigerim@gmail.com', createdAt: 'SERVER_TIME' }]]);
  assert.equal(fb.log.signOut, 0);
});

test('Google: повторный вход (профиль есть) — ничего не записывается, данные прежние', async () => {
  const existing = { name: 'Покупатель', email: 'aigerim@gmail.com', createdAt: 'T0' };
  const fb = fakeFirebase({ users: { 'g-uid': existing } });
  const res = await completeGoogleSignIn(fb, async () => googleUser({ displayName: 'Другое имя из Google' }));
  assert.equal(res.created, false);
  assert.deepEqual(res.profile, { name: 'Покупатель', email: 'aigerim@gmail.com' });
  assert.deepEqual(fb.log.writes, [], 'профиль не перезаписан');
  assert.deepEqual(fb.docs.get('g-uid'), existing);
});

test('Google: отмена, заблокированное окно, сеть, конфликт аккаунтов — ошибка как есть, профиль не трогается', async () => {
  for (const [code, key] of [
    ['auth/popup-closed-by-user', 'auth.google.cancelled'],
    ['auth/cancelled-popup-request', 'auth.google.cancelled'],
    ['auth/popup-blocked', 'auth.google.popupBlocked'],
    ['auth/network-request-failed', 'auth.network'],
    ['auth/account-exists-with-different-credential', 'auth.google.accountExists'],
    ['auth/operation-not-allowed', 'auth.google.notEnabled'],
    ['auth/unauthorized-domain', 'auth.google.unauthorizedDomain'],
  ]) {
    const fb = fakeFirebase();
    await assert.rejects(
      completeGoogleSignIn(fb, async () => {
        throw fbError(code);
      }),
      (err) => err.code === code && app.toErrorKey(err) === key,
      code,
    );
    assert.deepEqual(fb.log.writes, [], code);
    assert.equal(fb.log.signOut, 0, `${code}: вход не состоялся — выходить не из чего`);
  }
});

test('Google: профиль не сохранился — выход из аккаунта и понятная ошибка (без «полувхода»)', async () => {
  const denied = fakeFirebase({ writeError: 'permission-denied' });
  await assert.rejects(completeGoogleSignIn(denied, async () => googleUser()), (err) => {
    assert.ok(err instanceof GoogleProfileError);
    assert.equal(err.code, 'profile-failed');
    assert.equal(app.toErrorKey(err), 'auth.google.profileFailed');
    return true;
  });
  assert.equal(denied.log.signOut, 1);
  const offline = fakeFirebase({ writeError: 'unavailable' });
  await assert.rejects(completeGoogleSignIn(offline, async () => googleUser()), (err) => app.toErrorKey(err) === 'auth.network');
  assert.equal(offline.log.signOut, 1);
});

test('createGoogleProvider: официальный GoogleAuthProvider с выбором аккаунта', () => {
  const fb = fakeFirebase();
  const provider = createGoogleProvider(fb.authApi);
  assert.ok(provider instanceof fb.authApi.GoogleAuthProvider);
  assert.deepEqual(provider.params, { prompt: 'select_account' });
  const svc = read('src/services/authService.js');
  assert.match(svc, /completeGoogleSignIn\(fb, \(\) =>\s*fb\.authApi\.signInWithPopup\(fb\.auth, createGoogleProvider\(fb\.authApi\)\),?\s*\)/);
});

test('profileNameFrom: имя из Google, иначе часть e-mail; пробелы по краям; не длиннее 100', () => {
  assert.equal(profileNameFrom({ displayName: '  Айгерим  ', email: 'a@gmail.com' }), 'Айгерим');
  assert.equal(profileNameFrom({ displayName: '', email: 'aigerim.k@gmail.com' }), 'aigerim.k');
  assert.equal(profileNameFrom({}), '');
  assert.equal(profileNameFrom({ displayName: 'Я'.repeat(150) }).length, PROFILE_NAME_MAX);
});

// ---------- Восстановление пароля ----------

test('sendPasswordReset: письмо на очищенный e-mail; неизвестный адрес — тот же ответ; ошибки — понятные', async () => {
  const fb = fakeFirebase();
  assert.deepEqual(await sendPasswordReset(fb, '  User@Test.Local '), { email: 'user@test.local' });
  assert.deepEqual(fb.log.resetEmails, ['user@test.local']);
  // Неизвестный e-mail: ответ как для известного — по форме нельзя узнать, есть ли аккаунт
  fb.resetError = 'auth/user-not-found';
  assert.deepEqual(await sendPasswordReset(fb, 'nobody@test.local'), { email: 'nobody@test.local' });
  for (const [code, key] of [
    ['auth/invalid-email', 'validation.email'],
    ['auth/missing-email', 'validation.required'],
    ['auth/too-many-requests', 'auth.tooManyRequests'],
    ['auth/network-request-failed', 'auth.network'],
  ]) {
    fb.resetError = code;
    await assert.rejects(sendPasswordReset(fb, 'user@test.local'), (err) => app.toErrorKey(err) === key, code);
  }
  // Ничего, кроме письма: профиль не создаётся, вход не выполняется
  assert.deepEqual(fb.log.writes, []);
  assert.equal(fb.log.signOut, 0);
});

test('validatePasswordReset: e-mail обязателен и проверяется по формату', () => {
  assert.deepEqual(validatePasswordReset({ email: 'user@test.local' }), {});
  assert.deepEqual(validatePasswordReset({ email: '   ' }), { email: 'validation.required' });
  assert.deepEqual(validatePasswordReset({ email: 'не-почта' }), { email: 'validation.email' });
});

test('без Firebase (демо-режим): вход через Google и восстановление пароля — понятная ошибка', async () => {
  assert.equal(app.AUTH_MODE, 'demo');
  await assert.rejects(app.loginWithGoogle(), (err) => app.toErrorKey(err) === 'auth.google.unavailable');
  await assert.rejects(app.requestPasswordReset('user@test.local'), (err) => app.toErrorKey(err) === 'auth.reset.unavailable');
});

// ---------- Redux, страница входа, формы ----------

test('Redux: вход через Google — загрузка, успех, ошибка; отмена окна — без сообщения', () => {
  const { reducer, loginUser, loginWithGoogleUser } = app;
  const start = reducer(undefined, { type: '@@init' });
  const loading = reducer(start, loginWithGoogleUser.pending('r1'));
  assert.equal(loading.status, 'loading');
  const user = { uid: 'g1', name: 'Айгерим', email: 'a@gmail.com', createdAt: '2026-11-05T00:00:00.000Z' };
  assert.deepEqual(reducer(loading, loginWithGoogleUser.fulfilled(user, 'r1')).current, user);
  const cancelled = reducer(loading, loginWithGoogleUser.rejected(null, 'r1', undefined, 'auth.google.cancelled'));
  assert.deepEqual([cancelled.status, cancelled.error], ['idle', null]);
  assert.equal(reducer(loading, loginWithGoogleUser.rejected(null, 'r1', undefined, 'auth.google.profileFailed')).error, 'auth.google.profileFailed');
  const pwd = reducer(reducer(start, loginUser.pending('r2')), loginUser.rejected(null, 'r2', undefined, 'auth.invalidCredentials'));
  assert.equal(pwd.error, 'auth.invalidCredentials');
});

test('страница входа: во время входа не уводит в кабинет; ошибка профиля видна; вошедший — в кабинет', async () => {
  const user = { uid: 'g1', name: 'Айгерим', email: 'a@gmail.com' };
  const ru = dicts.ru.auth;
  // Firebase уже сообщил о входе, профиль ещё сохраняется — страница остаётся на месте
  assert.ok(app.authPage({ current: user, status: 'loading' }).includes(ru.loginTitle));
  // Профиль не сохранился: выход (current = null) и понятное сообщение на странице
  const failed = app.authPage({ current: null, status: 'idle', error: 'auth.google.profileFailed' });
  assert.ok(failed.includes(ru.google.profileFailed) && failed.includes('role="alert"'));
  // Вход завершён — страница не показывается (переход в кабинет)
  assert.ok(!app.authPage({ current: user, status: 'idle' }).includes(ru.loginTitle));
  // Кнопка Google — только с Firebase; в демо-режиме её нет
  assert.ok(app.authPage({ status: 'idle' }).includes('google-btn'));
  assert.ok(!app.authPage({ status: 'idle', mode: 'demo' }).includes('google-btn'));
  // «Забыли пароль?» — ссылка в форме входа
  assert.match(app.authPage({ status: 'idle' }), /<a href="\/forgot-password"[^>]*>[^<]+<\/a>/);
});

test('страница «Забыли пароль?» и кнопка Google на ru, ky, en; в демо-режиме форма заблокирована', async () => {
  for (const lang of ['ru', 'ky', 'en']) {
    await app.i18n.changeLanguage(lang);
    const a = dicts[lang].auth;
    const page = app.forgotPage({});
    assert.ok(page.includes(a.reset.title) && page.includes(a.reset.submit) && page.includes(a.reset.subtitle), lang);
    assert.ok(!/auth\.(reset|google)\./.test(page), `${lang}: непереведённые ключи`);
    const btn = app.googleButton('idle');
    assert.ok(btn.includes(a.google.continue) && btn.includes(a.google.or), lang);
  }
  await app.i18n.changeLanguage('ru');
  const demo = app.forgotPage({ mode: 'demo' });
  assert.ok(demo.includes(dicts.ru.auth.reset.unavailable));
  assert.match(demo, /<button type="submit"[^>]*disabled=""/);
  assert.match(app.googleButton('loading'), /google-btn"[^>]*disabled=""/);
});

test('переводы auth.google и auth.reset: одинаковые ключи на ru, ky, en, без пустых строк', () => {
  for (const block of ['google', 'reset']) {
    const ruKeys = Object.keys(dicts.ru.auth[block]).sort();
    for (const [lang, dict] of Object.entries(dicts)) {
      assert.deepEqual(Object.keys(dict.auth[block]).sort(), ruKeys, `${lang}: ${block}`);
      for (const k of ruKeys) assert.ok(String(get(dict.auth[block], k)).trim(), `${lang}: ${block}.${k}`);
    }
  }
  for (const lang of ['ru', 'ky', 'en']) assert.match(dicts[lang].auth.reset.sentText, /\{\{email\}\}/, lang);
});

test('границы: вход и регистрация по паролю не изменились; Firestore Rules не менялись; связывания аккаунтов нет', () => {
  const svc = read('src/services/authService.js');
  assert.match(svc, /authApi\.createUserWithEmailAndPassword\(auth, cleanEmail, password\)/);
  assert.match(svc, /authApi\.signInWithEmailAndPassword\(auth, cleanEmail, password\)/);
  for (const file of ['src/services/authService.js', 'src/services/googleAuthFlow.js', 'src/services/passwordReset.js']) {
    assert.doesNotMatch(read(file), /linkWith|unlink|deleteUser|updateEmail|fetchSignInMethods/, file);
  }
  const rules = read('firestore.rules');
  assert.ok(rules.includes("&& request.resource.data.keys().hasOnly(['name', 'email', 'createdAt'])"));
  assert.ok(rules.includes('&& request.resource.data.createdAt == request.time;'));
});
