// Вход через Google (Блок 2): логика после входа в Firebase Auth — отдельно от способа входа.
// В приложении способ — всплывающее окно Google (authService.loginWithGoogle → signInWithPopup);
// в тестах — signInWithCredential на эмуляторе или подмена. Поведение после входа одинаковое.

import { ensureUserProfile } from './userProfileStore.js';

/** Официальный провайдер Google с выбором аккаунта, если их несколько */
export function createGoogleProvider(authApi) {
  const provider = new authApi.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return provider;
}

/** Ошибка сохранения профиля после входа: code — 'profile-failed' или 'profile-network' */
export class GoogleProfileError extends Error {
  constructor(code, cause) {
    super(code);
    this.code = code;
    this.cause = cause;
  }
}

/**
 * Войти и подготовить профиль:
 * 1) signIn() — вход в Firebase Auth (окно Google; ошибки и отмену пробрасывает как есть);
 * 2) профиль users/{uid} — создаётся, только если его нет; существующий не перезаписывается;
 * 3) не удалось сохранить профиль — выход из аккаунта (без «полувхода») и GoogleProfileError.
 * UID берётся из Firebase Auth: повторный вход тем же аккаунтом Google не создаёт нового пользователя.
 * Возвращает { user, profile, created }.
 */
export async function completeGoogleSignIn({ auth, db, authApi, dbApi }, signIn) {
  const cred = await signIn();
  try {
    const { profile, created } = await ensureUserProfile({ db, dbApi }, cred.user);
    return { user: cred.user, profile, created };
  } catch (err) {
    await authApi.signOut(auth).catch(() => {});
    const network = err?.code === 'unavailable' || err?.code === 'deadline-exceeded';
    throw new GoogleProfileError(network ? 'profile-network' : 'profile-failed', err);
  }
}
