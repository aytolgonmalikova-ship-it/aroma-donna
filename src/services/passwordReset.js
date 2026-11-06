// Восстановление пароля (Блок 2): письмо со ссылкой через Firebase Authentication.
// Получает { auth, authApi } — authService.js передаёт настоящий Firebase, тесты — эмулятор.
//
// Письмо только меняет пароль существующего аккаунта: UID, профиль users/{uid} и заказы не затрагиваются,
// новый пользователь не создаётся (sendPasswordResetEmail не создаёт аккаунтов).

/**
 * Отправить письмо для смены пароля. Для неизвестного e-mail ответ такой же, как для известного:
 * по форме нельзя узнать, зарегистрирован ли адрес (защита от перебора адресов).
 * Остальные ошибки (неверный e-mail, сеть, слишком много попыток) пробрасываются.
 */
export async function sendPasswordReset({ auth, authApi }, email) {
  const cleanEmail = String(email ?? '').trim().toLowerCase();
  try {
    await authApi.sendPasswordResetEmail(auth, cleanEmail);
  } catch (err) {
    if (err?.code !== 'auth/user-not-found') throw err;
  }
  return { email: cleanEmail };
}
