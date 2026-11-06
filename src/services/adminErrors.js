// Ошибки админ-панели: код для интерфейса (переводится как admin.<раздел>.errors.<code>).
// Отдельный модуль без Firebase — его используют adminService.js и adminProductsStore.js,
// и его можно проверять в тестах (node --test).

/**
 * Коды: not-configured, network, denied, failed, not-empty, invalid,
 * id-taken (товар с таким id уже есть), not-found (товара нет), conflict (товар изменили после открытия формы),
 * damaged (документ повреждён — сначала исправить в форме), not-hidden (удалить можно только скрытый товар),
 * last-visible (на витрине не останется видимых товаров — покупатели увидели бы демо-каталог).
 * Отзывы (этап E, adminReviewsStore.js): not-found (отзыва нет), conflict (статус изменили в другом окне),
 * invalid (неизвестный статус), not-rejected (навсегда удалить можно только отклонённый отзыв —
 * то же требует правило delete в firestore.rules).
 * Администраторы (этап A4, adminAdminsStore.js): not-signed-in (нет входа), invalid-uid, invalid-label,
 * not-owner (управлять администраторами может только главный администратор), self (нельзя назначить,
 * отозвать или предложить роль себе), user-not-found (нет профиля users/{uid}), already-admin,
 * not-admin (у пользователя нет прав администратора), owner-protected (нельзя отозвать доступ владельца),
 * pending-owner (кандидату предложена роль — сначала отменить предложение), offer-exists (предложение уже есть),
 * no-offer (действующего предложения нет), offer-stale (предложение изменилось после загрузки экрана),
 * candidate-not-admin (роль можно предложить только администратору). denied — отказ правил Firestore.
 */
export class AdminError extends Error {
  constructor(code, cause) {
    super(code);
    this.code = code;
    this.cause = cause;
  }
}

/** Любая ошибка (Firebase, сеть, AdminError) → AdminError с кодом для интерфейса */
export function toAdminError(err) {
  if (err instanceof AdminError) return err;
  if (err?.message === 'firebase-not-configured') return new AdminError('not-configured', err);
  if (err?.code === 'unavailable' || err?.code === 'deadline-exceeded') return new AdminError('network', err);
  if (err?.code === 'permission-denied') return new AdminError('denied', err);
  return new AdminError('failed', err);
}
