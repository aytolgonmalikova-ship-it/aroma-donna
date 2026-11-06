// Заказы в админке (C3.3, этап 5): тип заказа по пути документа, ссылки, поиск, фильтр по дате и сортировка.
// Чистые функции без Firebase — их использует adminService и страница «Заказы».
//
// Пути заказов (структура хранения не меняется):
// - users/{uid}/orders/{orderId}       — покупатель с аккаунтом;
// - guests/{guestKey}/orders/{orderId} — гость (guestKey — HMAC гостевой сессии, НЕ UID пользователя).

/** Владелец заказа по пути документа: { kind: 'user' | 'guest', ownerId } или null (неизвестный путь) */
export function orderOwnerFromPath(path) {
  const parts = String(path || '').split('/');
  if (parts.length !== 4 || parts[2] !== 'orders') return null;
  if (parts[0] === 'users') return { kind: 'user', ownerId: parts[1] };
  if (parts[0] === 'guests') return { kind: 'guest', ownerId: parts[1] };
  return null;
}

/** Путь документа заказа: ['users' | 'guests', ownerId, 'orders', orderId] */
export function orderDocPath({ kind, ownerId, orderId }) {
  return [kind === 'guest' ? 'guests' : 'users', ownerId, 'orders', orderId];
}

/** Адрес карточки заказа в админке */
export function adminOrderLink(order) {
  return order.isGuest ? `/admin/orders/guest/${order.guestKey}/${order.id}` : `/admin/orders/${order.userId}/${order.id}`;
}

const digits = (v) => String(v ?? '').replace(/\D/g, '');

/** Поиск по номеру заказа, имени и фамилии, телефону (по цифрам, с кодом +996 и без) — без учёта регистра */
export function searchOrders(orders, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return orders;
  const qDigits = digits(q);
  return orders.filter((o) => {
    const name = [o.customer?.name, o.customer?.lastName].filter(Boolean).join(' ').toLowerCase();
    if (String(o.id || '').toLowerCase().includes(q) || name.includes(q)) return true;
    if (qDigits.length >= 3) {
      const phone = digits(o.customer?.phone);
      if (phone.includes(qDigits) || phone.replace(/^996/, '0').includes(qDigits)) return true;
    }
    return false;
  });
}

const dayStart = (ymd) => (/^\d{4}-\d{2}-\d{2}$/.test(ymd || '') ? new Date(`${ymd}T00:00:00`).getTime() : null);
const toMs = (v) => {
  const ms = typeof v === 'string' ? Date.parse(v) : v?.toDate ? v.toDate().getTime() : NaN;
  return Number.isFinite(ms) ? ms : null;
};

/** Фильтр по дате оформления: from и to — 'ГГГГ-ММ-ДД' (включительно, по местному времени); пусто — без границы */
export function filterOrdersByDate(orders, from, to) {
  const start = dayStart(from);
  const endDay = dayStart(to);
  const end = endDay === null ? null : endDay + 24 * 60 * 60 * 1000;
  if (start === null && end === null) return orders;
  return orders.filter((o) => {
    const ms = toMs(o.createdAt);
    if (ms === null) return false;
    return (start === null || ms >= start) && (end === null || ms < end);
  });
}

export const ORDER_SORTS = ['newest', 'oldest', 'totalDesc', 'totalAsc'];
export const isOrderSort = (v) => ORDER_SORTS.includes(v);

/** Новый отсортированный массив (исходный не меняется) */
export function sortOrders(orders, sort) {
  const by = {
    newest: (a, b) => (toMs(b.createdAt) ?? 0) - (toMs(a.createdAt) ?? 0),
    oldest: (a, b) => (toMs(a.createdAt) ?? 0) - (toMs(b.createdAt) ?? 0),
    totalDesc: (a, b) => (Number(b.total) || 0) - (Number(a.total) || 0),
    totalAsc: (a, b) => (Number(a.total) || 0) - (Number(b.total) || 0),
  }[isOrderSort(sort) ? sort : 'newest'];
  return [...orders].sort((a, b) => by(a, b) || String(a.id).localeCompare(String(b.id)));
}

/**
 * Можно ли вручную повторить уведомление в Telegram: только failed, или sending с истёкшей арендой
 * (процесс упал). Старые заказы без поля notification — нет.
 */
export function canResendNotification(notification, now = Date.now()) {
  if (!notification || typeof notification !== 'object') return false;
  if (notification.status === 'failed') return true;
  return notification.status === 'sending' && typeof notification.leaseUntil === 'number' && notification.leaseUntil <= now;
}
