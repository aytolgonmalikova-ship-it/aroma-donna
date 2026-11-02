// Проверка корзины по свежему каталогу непосредственно перед оформлением заказа.
// Каталог в Redux и корзина в localStorage могли устареть: товар скрыли или удалили,
// убрали объём, изменили цену или наличие. Заказ собирается только из данных,
// прочитанных из Firestore прямо перед сохранением. Чистые функции — проверяются тестами.
import { calcDelivery, calcDiscount } from './promo.js';

/** Причины, по которым позицию нельзя оформить */
export const CHECKOUT_PROBLEMS = ['missing', 'outOfStock', 'volumeUnavailable'];

/**
 * Позиции корзины по свежему каталогу. cartItems — записи корзины { key, id, volume, quantity },
 * seenLines — строки, которые покупатель видел на странице (selectCartItems: product, price, volumeAvailable).
 * status:
 * - missing — товара нет на витрине (скрыт или удалён: посетитель их не различает);
 * - outOfStock — нет в наличии;
 * - volumeUnavailable — выбранного объёма больше нет (другой объём НЕ подставляется);
 * - priceChanged — цена не совпадает с той, что видел покупатель (или он её не видел);
 * - ok — всё совпадает.
 * Название — из свежего товара, а если его нет — из того, что видел покупатель.
 */
export function verifyCartLines(cartItems, seenLines, freshCatalog) {
  const byId = new Map(freshCatalog.map((p) => [p.id, p]));
  const seen = new Map(seenLines.map((l) => [l.key, l]));
  return cartItems.map((item) => {
    const was = seen.get(item.key);
    const base = {
      key: item.key,
      id: item.id,
      volume: item.volume,
      quantity: item.quantity,
      name: was?.product?.name || item.id,
      oldPrice: was?.volumeAvailable ? was.price : null,
      price: null,
      lineTotal: 0,
    };
    const product = byId.get(item.id);
    if (!product) return { ...base, status: 'missing' };
    const named = { ...base, name: product.name, product };
    if (product.availability === 'outOfStock') return { ...named, status: 'outOfStock' };
    const variant = product.volumes.find((v) => v.ml === item.volume);
    if (!variant) return { ...named, status: 'volumeUnavailable' };
    return {
      ...named,
      price: variant.price,
      lineTotal: variant.price * item.quantity,
      status: base.oldPrice === variant.price ? 'ok' : 'priceChanged',
    };
  });
}

/** Суммы заказа по проверенным позициям — так же, как selectCartTotals и CheckoutPage */
export function checkoutTotals(lines, promoCode, deliveryMethod) {
  const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);
  const discount = calcDiscount(subtotal, promoCode);
  const total = subtotal - discount;
  const delivery = calcDelivery(deliveryMethod, total);
  return { subtotal, discount, total, delivery, grandTotal: total + delivery };
}

/**
 * Итог проверки перед оформлением. Возвращает { status, lines, problems, priceChanges, totals }:
 * - unverified — каталог витрины переключился с Firestore на резервный (демо): по нему проверять
 *   и оформлять нельзя, покупатель видит ошибку и повторяет позже;
 * - blocked — есть позиции из CHECKOUT_PROBLEMS: заказ не оформляется;
 * - confirm — цены или итоговая сумма изменились: показать новые и запросить повторное подтверждение;
 * - ok — можно сохранять заказ из lines и totals.
 * fresh — результат fetchProductsApi ({ items, source }), expectedSource — источник каталога в Redux.
 */
export function reviewCheckout({ cartItems, seenLines, seenGrandTotal, fresh, expectedSource, promoCode, deliveryMethod }) {
  if (expectedSource === 'firestore' && fresh.source !== 'firestore') {
    return { status: 'unverified', lines: [], problems: [], priceChanges: [], totals: null };
  }
  const lines = verifyCartLines(cartItems, seenLines, fresh.items);
  const problems = lines.filter((l) => CHECKOUT_PROBLEMS.includes(l.status));
  const priceChanges = lines.filter((l) => l.status === 'priceChanged');
  // У недоступных позиций lineTotal = 0 — в сумму они не входят
  const totals = checkoutTotals(lines, promoCode, deliveryMethod);
  let status = 'ok';
  if (problems.length) status = 'blocked';
  else if (priceChanges.length || totals.grandTotal !== seenGrandTotal) status = 'confirm';
  return { status, lines, problems, priceChanges, totals };
}

/**
 * Объект заказа из проверенных позиций. Структура та же, что и раньше (история заказов не меняется):
 * в позиции — копия названия, бренда, объёма и цены на момент заказа.
 */
export function buildOrder({ id, createdAt, user, lines, totals, promoCode, values, paymentStatus }) {
  return {
    id,
    createdAt,
    userId: user?.uid || null,
    items: lines.map((l) => ({
      id: l.product.id,
      name: l.product.name,
      brand: l.product.brand,
      volume: l.volume,
      price: l.price,
      quantity: l.quantity,
    })),
    subtotal: totals.subtotal,
    discount: totals.discount,
    promoCode: totals.discount > 0 ? promoCode : null,
    delivery: totals.delivery,
    total: totals.grandTotal,
    customer: {
      name: values.name.trim(),
      lastName: values.lastName.trim(),
      phone: values.phone.trim(),
      email: values.email.trim(),
    },
    shipping: {
      method: values.delivery,
      region: values.delivery === 'pickup' ? null : values.region,
      city: values.delivery === 'pickup' ? null : values.city,
      address: values.delivery === 'pickup' ? null : values.address.trim(),
      comment: values.comment.trim(),
    },
    payment: values.payment,
    paymentStatus, // 'paidDemo' — «Оплачен (DEMO)», 'awaitingPayment' — «Ожидает оплаты»
  };
}
