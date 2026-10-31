// Форматирование цен и дат. Валюта магазина — кыргызский сом (KGS).

const LOCALES = { ru: 'ru-RU', ky: 'ky-KG', en: 'en-US' };

/** 5900 → «5 900 KGS» */
export function formatPrice(value) {
  const number = Math.round(Number(value) || 0);
  // Пробел как разделитель тысяч одинаково понятен на всех трёх языках
  const grouped = String(number).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
  return `${grouped}\u00a0KGS`;
}

/** ISO-дата → «28.10.2026, 15:40» в формате выбранного языка */
export function formatDate(iso, lang = 'ru') {
  try {
    return new Intl.DateTimeFormat(LOCALES[lang] || 'ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/** Возвращает текст на нужном языке из объекта { ru, ky, en } */
export function localized(value, lang) {
  if (!value || typeof value === 'string') return value || '';
  return value[lang] || value.ru || '';
}

/** Короткий уникальный номер заказа: AD-251028-4F7K */
export function createOrderId() {
  const d = new Date();
  const date = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `AD-${date}-${rand}`;
}
