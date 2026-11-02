// Покупатели для админ-панели: объединение профилей users/{uid} с их заказами,
// статистика, поиск и сортировка. Чистые функции без Firebase — проверяются в tests/customers.test.js.

// Варианты сортировки списка покупателей (первый — по умолчанию)
export const CUSTOMER_SORTS = ['registered', 'lastOrder', 'spent', 'orders', 'name'];

export function isCustomerSort(value) {
  return CUSTOMER_SORTS.includes(value);
}

/** Дата (ISO-строка или Date) → миллисекунды; нет даты — 0 */
const toMs = (value) => {
  const ms = value ? new Date(value).getTime() : 0;
  return Number.isNaN(ms) ? 0 : ms;
};

/** Отменённые заказы не входят в сумму покупок */
const countsInSpent = (order) => order.status !== 'cancelled';

/**
 * Список покупателей: профили + статистика по заказам.
 *
 * profiles — [{ uid, name, email, createdAt }] из users/{uid};
 * orders   — заказы из админки (у каждого есть userId — uid владельца).
 *
 * Покупатель с заказами, но без профиля (старый или сбойный аккаунт), тоже попадает
 * в список: имя и e-mail берутся из последнего заказа, hasProfile = false.
 */
export function buildCustomers(profiles, orders) {
  const map = new Map();

  profiles.forEach((p) => {
    if (!p?.uid) return;
    map.set(p.uid, {
      uid: p.uid,
      name: p.name || '',
      email: p.email || '',
      createdAt: p.createdAt || null,
      hasProfile: true,
      orders: [],
    });
  });

  orders.forEach((order) => {
    if (!order?.userId) return;
    if (!map.has(order.userId)) {
      map.set(order.userId, {
        uid: order.userId,
        name: '',
        email: '',
        createdAt: null,
        hasProfile: false,
        orders: [],
      });
    }
    map.get(order.userId).orders.push(order);
  });

  return [...map.values()].map((c) => {
    const sorted = [...c.orders].sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt));
    const last = sorted[0];
    const fromOrder = last?.customer || {};
    return {
      ...c,
      name: c.name || [fromOrder.name, fromOrder.lastName].filter(Boolean).join(' '),
      email: c.email || fromOrder.email || '',
      // Телефона в профиле нет — берём из последнего заказа
      phone: sorted.find((o) => o.customer?.phone)?.customer.phone || '',
      orders: sorted,
      ordersCount: sorted.length,
      totalSpent: sorted.filter(countsInSpent).reduce((sum, o) => sum + (Number(o.total) || 0), 0),
      lastOrderAt: last?.createdAt || null,
    };
  });
}

/** Поиск по имени и e-mail без учёта регистра */
export function filterCustomers(customers, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return customers;
  return customers.filter((c) => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q));
}

/** Новый отсортированный массив; неизвестный ключ — сортировка по дате регистрации */
export function sortCustomers(customers, sort, lang = 'ru') {
  const byName = (a, b) => (a.name || a.email).localeCompare(b.name || b.email, lang);
  const compare = {
    registered: (a, b) => toMs(b.createdAt) - toMs(a.createdAt),
    lastOrder: (a, b) => toMs(b.lastOrderAt) - toMs(a.lastOrderAt),
    spent: (a, b) => b.totalSpent - a.totalSpent,
    orders: (a, b) => b.ordersCount - a.ordersCount,
    name: byName,
  }[isCustomerSort(sort) ? sort : CUSTOMER_SORTS[0]];
  return [...customers].sort((a, b) => compare(a, b) || byName(a, b));
}

/** Сокращённый uid для показа: «aB3dEf…9xYz» */
export function shortUid(uid) {
  const s = String(uid || '');
  return s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s;
}
