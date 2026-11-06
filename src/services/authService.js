/**
 * Сервис авторизации с двумя режимами:
 *
 * 1) 'firebase' — настоящая регистрация и вход через Firebase Authentication
 *    (если в .env заполнены ключи). Пароли проверяет и хранит Firebase.
 *
 * 2) 'demo' — демонстрационный режим без сервера. В браузере (localStorage) сохраняются
 *    ТОЛЬКО имя и e-mail. Пароль НЕ сохраняется и НЕ проверяется — это не настоящая
 *    защита аккаунта, о чём честно сказано на страницах входа и регистрации.
 */
import { getFirebase, isFirebaseConfigured } from './firebase';
import { loadFromStorage, saveToStorage, removeFromStorage, STORAGE_KEYS } from '../utils/storage';
import { completeGoogleSignIn, createGoogleProvider } from './googleAuthFlow';
import { sendPasswordReset } from './passwordReset';

  export const AUTH_MODE = isFirebaseConfigured ? 'firebase' : 'demo';

class AuthError extends Error {
  constructor(key) {
    super(key);
    this.key = key;
  }
}

/** Превращает ошибку Firebase или демо-режима в ключ перевода */
export function toErrorKey(error) {
  if (error?.key) return error.key;
  const map = {
    'auth/email-already-in-use': 'auth.emailInUse',
    'auth/invalid-credential': 'auth.invalidCredentials',
    'auth/wrong-password': 'auth.invalidCredentials',
    'auth/user-not-found': 'auth.invalidCredentials',
    'auth/invalid-email': 'validation.email',
    'auth/weak-password': 'validation.passwordMin',
    'auth/too-many-requests': 'auth.tooManyRequests',
    'auth/network-request-failed': 'auth.network',
    // Вход через Google (Блок 2). Отмена — не ошибка: форма её не показывает
    'auth/popup-closed-by-user': 'auth.google.cancelled',
    'auth/cancelled-popup-request': 'auth.google.cancelled',
    'auth/user-cancelled': 'auth.google.cancelled',
    'auth/popup-blocked': 'auth.google.popupBlocked',
    'auth/account-exists-with-different-credential': 'auth.google.accountExists',
    'auth/operation-not-allowed': 'auth.google.notEnabled',
    'auth/unauthorized-domain': 'auth.google.unauthorizedDomain',
    'auth/user-disabled': 'auth.google.userDisabled',
    // Профиль после входа через Google (googleAuthFlow.js)
    'profile-failed': 'auth.google.profileFailed',
    'profile-network': 'auth.network',
    // Восстановление пароля
    'auth/missing-email': 'validation.required',
  };
  return map[error?.code] || 'auth.unknown';
}

const toUser = (fbUser) =>
  fbUser
    ? {
        uid: fbUser.uid,
        name: fbUser.displayName || fbUser.email.split('@')[0],
        email: fbUser.email,
        createdAt: fbUser.metadata?.creationTime
          ? new Date(fbUser.metadata.creationTime).toISOString()
          : new Date().toISOString(),
      }
    : null;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------- Регистрация ----------------
export async function register({ name, email, password }) {
  const cleanEmail = email.trim().toLowerCase();
  if (AUTH_MODE === 'firebase') {
    const { auth, db, authApi, dbApi } = await getFirebase();
    const cred = await authApi.createUserWithEmailAndPassword(auth, cleanEmail, password);
    await authApi.updateProfile(cred.user, { displayName: name.trim() });
    // Профиль в Firestore: users/{uid}. Доступ ограничен правилами firestore.rules
    await dbApi.setDoc(dbApi.doc(db, 'users', cred.user.uid), {
      name: name.trim(),
      email: cleanEmail,
      createdAt: dbApi.serverTimestamp(),
    });
    return { ...toUser(cred.user), name: name.trim() };
  }

  await wait(400);
  const users = loadFromStorage(STORAGE_KEYS.demoUsers, []);
  if (users.some((u) => u.email === cleanEmail)) throw new AuthError('auth.emailInUse');
  const user = {
    uid: `demo-${Date.now().toString(36)}`,
    name: name.trim(),
    email: cleanEmail,
    createdAt: new Date().toISOString(),
  };
  saveToStorage(STORAGE_KEYS.demoUsers, [...users, user]); // без пароля!
  saveToStorage(STORAGE_KEYS.demoSession, user);
  return user;
}

// ---------------- Вход ----------------
export async function login({ email, password }) {
  const cleanEmail = email.trim().toLowerCase();
  if (AUTH_MODE === 'firebase') {
    const { auth, authApi } = await getFirebase();
    const cred = await authApi.signInWithEmailAndPassword(auth, cleanEmail, password);
    return toUser(cred.user);
  }

  await wait(400);
  const users = loadFromStorage(STORAGE_KEYS.demoUsers, []);
  const user = users.find((u) => u.email === cleanEmail);
  if (!user) throw new AuthError('auth.demoUserNotFound');
  saveToStorage(STORAGE_KEYS.demoSession, user);
  return user;
}

// ---------------- Вход через Google (Блок 2) ----------------
/**
 * Вход и регистрация через Google: Firebase Authentication, официальный GoogleAuthProvider, всплывающее окно.
 * Логика после входа (профиль, выход при сбое) — completeGoogleSignIn (googleAuthFlow.js).
 * Один и тот же аккаунт Google всегда даёт тот же UID — повторный вход не создаёт нового пользователя.
 * Только с Firebase: в демо-режиме Google недоступен.
 */
export async function loginWithGoogle() {
  if (AUTH_MODE !== 'firebase') throw new AuthError('auth.google.unavailable');
  const fb = await getFirebase();
  const { user, profile } = await completeGoogleSignIn(fb, () =>
    fb.authApi.signInWithPopup(fb.auth, createGoogleProvider(fb.authApi)),
  );
  return { ...toUser(user), name: profile.name };
}

// ---------------- Восстановление пароля (Блок 2) ----------------
/**
 * Письмо со ссылкой для смены пароля (sendPasswordResetEmail). Меняется только пароль существующего
 * аккаунта: UID, профиль и заказы не затрагиваются. Неизвестный e-mail — тот же ответ, что и известный.
 */
export async function requestPasswordReset(email) {
  if (AUTH_MODE !== 'firebase') throw new AuthError('auth.reset.unavailable');
  return sendPasswordReset(await getFirebase(), email);
}

// ---------------- Выход ----------------
export async function logout() {
  if (AUTH_MODE === 'firebase') {
    const { auth, authApi } = await getFirebase();
    await authApi.signOut(auth);
    return;
  }
  removeFromStorage(STORAGE_KEYS.demoSession);
}

/**
 * Подписка на изменение пользователя (вызывается один раз при запуске приложения).
 * Возвращает функцию отписки.
 */
export function subscribeToAuth(callback) {
  if (AUTH_MODE === 'firebase') {
    let unsubscribe = () => {};
    let cancelled = false;
    getFirebase()
      .then(({ auth, authApi }) => {
        if (cancelled) return;
        unsubscribe = authApi.onAuthStateChanged(auth, (fbUser) => callback(toUser(fbUser)));
      })
      .catch(() => callback(null));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }
  callback(loadFromStorage(STORAGE_KEYS.demoSession, null));
  return () => {};
}
