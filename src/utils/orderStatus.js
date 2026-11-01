// Статусы заказа, которые может выставить администратор.
// ВАЖНО: тот же список записан в firestore.rules (функция isValidOrderStatusChange) —
// при изменении обновите оба места.
// 'demo' — служебный статус заказов из localStorage, в Firestore его не бывает.
export const ORDER_STATUSES = ['new', 'confirmed', 'shipped', 'delivered', 'cancelled'];

export function isOrderStatus(value) {
  return ORDER_STATUSES.includes(value);
}

/** Количество заказов по каждому статусу: { all: 12, new: 3, confirmed: 0, ... } */
export function countByStatus(orders) {
  const counts = { all: orders.length };
  ORDER_STATUSES.forEach((s) => {
    counts[s] = 0;
  });
  orders.forEach((o) => {
    if (o.status in counts) counts[o.status] += 1;
  });
  return counts;
}

/** Заказы с выбранным статусом ('all' — все) */
export function filterOrdersByStatus(orders, status) {
  return status === 'all' ? orders : orders.filter((o) => o.status === status);
}
