// Ошибки админ-панели: код для интерфейса (переводится как admin.<раздел>.errors.<code>).
// Отдельный модуль без Firebase — его используют adminService.js и adminProductsStore.js,
// и его можно проверять в тестах (node --test).

/**
 * Коды: not-configured, network, denied, failed, not-empty, invalid,
 * id-taken (товар с таким id уже есть), not-found (товара нет), conflict (товар изменили после открытия формы),
 * damaged (документ повреждён — сначала исправить в форме), not-hidden (удалить можно только скрытый товар),
 * last-visible (на витрине не останется видимых товаров — покупатели увидели бы демо-каталог).
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
