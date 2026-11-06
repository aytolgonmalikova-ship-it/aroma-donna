// Профиль покупателя users/{uid} при входе через Google (Блок 2).
// Функции получают { db, dbApi } — authService.js передаёт настоящий Firebase, тесты — эмулятор.
//
// Правило users (firestore.rules): создать профиль может только сам пользователь, только поля
// name, email, createdAt и createdAt == request.time (serverTimestamp) — как при регистрации по паролю.
// Изменить createdAt нельзя, поэтому повторное «создание» существующего профиля правила отклонят.

export const PROFILE_NAME_MAX = 100;

/** Имя для профиля: имя из Google, иначе часть e-mail до «@»; без пробелов по краям, до 100 символов */
export function profileNameFrom(user) {
  const fromGoogle = typeof user?.displayName === 'string' ? user.displayName.trim() : '';
  const email = typeof user?.email === 'string' ? user.email : '';
  const name = fromGoogle || email.split('@')[0] || '';
  return name.slice(0, PROFILE_NAME_MAX);
}

/**
 * Профиль users/{uid} для вошедшего пользователя: если профиль уже есть — ничего не записывается
 * (данные не перезаписываются, повторный вход не создаёт дублей: ID документа — UID из Firebase Auth);
 * если нет — создаётся { name, email, createdAt: serverTimestamp() }.
 * Транзакция: чтение и создание атомарны, два одновременных входа не создадут профиль дважды.
 * Возвращает { created, profile: { name, email } }.
 */
export async function ensureUserProfile({ db, dbApi }, user) {
  if (!user?.uid) throw new Error('no-user');
  const ref = dbApi.doc(db, 'users', user.uid);
  return dbApi.runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists()) {
      const data = snap.data();
      return {
        created: false,
        profile: {
          name: typeof data.name === 'string' && data.name.trim() ? data.name : profileNameFrom(user),
          email: typeof data.email === 'string' ? data.email : user.email || '',
        },
      };
    }
    const profile = { name: profileNameFrom(user), email: (user.email || '').trim().toLowerCase() };
    tx.set(ref, { ...profile, createdAt: dbApi.serverTimestamp() });
    return { created: true, profile };
  });
}
