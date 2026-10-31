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
