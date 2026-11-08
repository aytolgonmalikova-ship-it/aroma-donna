// Форматирование цен и дат. Валюта магазина — кыргызский сом (KGS).

const LOCALES = { ru: 'ru-RU', ky: 'ky-KG', en: 'en-US' };

/** 5900 → «5 900 KGS» */
export function formatPrice(value) {
  const number = Math.round(Number(value) || 0);
  // Пробел как разделитель тысяч одинаково понятен на всех трёх языках
  const grouped = String(number).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
  return `${grouped}\u00a0KGS`;
}

/** Дата Firestore (Timestamp или его JSON { seconds, nanoseconds }), Date, ISO-строка или число → Date */
function toDateValue(value) {
  if (typeof value?.toDate === 'function') return value.toDate();
  if (value && typeof value === 'object' && Number.isFinite(value.seconds)) return new Date(value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6));
  return new Date(value);
}

/** ISO-дата → «28.10.2026, 15:40» в формате выбранного языка. Всегда строка: непонятная дата → «—» */
export function formatDate(iso, lang = 'ru') {
  try {
    return new Intl.DateTimeFormat(LOCALES[lang] || 'ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(toDateValue(iso));
  } catch {
    return typeof iso === 'string' ? iso : '—';
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
