// Безопасная работа с localStorage.
// В приватном режиме браузера или при переполнении localStorage может выбросить ошибку,
// поэтому все обращения обёрнуты в try/catch — приложение не должно «падать».

export const STORAGE_KEYS = {
  cart: 'aroma_cart',
  favorites: 'aroma_favorites',
  theme: 'aroma_theme',
  language: 'aroma_language',
  demoUsers: 'aroma_demo_users', // только имя и e-mail, БЕЗ паролей
  demoSession: 'aroma_demo_session',
  demoOrders: 'aroma_demo_orders',
  usedPromoCodes: 'aroma_used_promo_codes',
  lastReviewAt: 'aroma_last_review_at', // время последнего отзыва (защита от частой отправки)
};

export function loadFromStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function saveToStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Хранилище недоступно — просто не сохраняем
  }
}

export function removeFromStorage(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // ничего не делаем
  }
}
