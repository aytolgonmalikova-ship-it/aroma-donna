/**
 * Административная часть магазина.
 *
 * Администратор — пользователь Firebase Authentication, для которого существует
 * документ admins/{uid}. Документ создаётся только вручную в Firebase Console
 * (или в будущем серверным API с Firebase Admin SDK) — из браузера его записать нельзя.
 *
 * Проверка здесь нужна только интерфейсу (показать или скрыть админ-панель).
 * Настоящая защита данных — функция isAdmin() в правилах firestore.rules.
 *
 * В демо-режиме (без Firebase) админ-панель недоступна: проверить роль на сервере нельзя.
 */
import { getFirebase, isFirebaseConfigured } from './firebase';

export const isAdminAvailable = isFirebaseConfigured;

/** Ошибка с кодом для интерфейса: not-configured, network, failed */
export class AdminError extends Error {
  constructor(code, cause) {
    super(code);
    this.code = code;
    this.cause = cause;
  }
}

function toAdminError(err) {
  if (err instanceof AdminError) return err;
  if (err?.message === 'firebase-not-configured') return new AdminError('not-configured', err);
  if (err?.code === 'unavailable' || err?.code === 'deadline-exceeded') return new AdminError('network', err);
  return new AdminError('failed', err);
}

/**
 * Есть ли у пользователя роль администратора.
 * Правила разрешают прочитать только свой документ admins/{uid}, поэтому
 * для обычного покупателя ответ просто «документа нет» → false.
 */
export async function checkIsAdmin(uid) {
  if (!uid) return false;
  try {
    const { db, dbApi } = await getFirebase();
    const snap = await dbApi.getDoc(dbApi.doc(db, 'admins', uid));
    return snap.exists();
  } catch (err) {
    // permission-denied — например, сессия устарела: считаем, что прав нет
    if (err?.code === 'permission-denied') return false;
    throw toAdminError(err);
  }
}
