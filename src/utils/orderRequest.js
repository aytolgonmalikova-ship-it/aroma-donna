// Запрос оформления заказа к серверу /api/order (C3.3, этап 4) — чистые функции, без React и Firebase.
// Браузер отправляет только «намерение»: позиции (товар, объём, количество), промокод, способы доставки
// и оплаты, данные покупателя, согласие и сумму, которую он видел (expectedTotal — для сравнения,
// а не как доверенное значение). Схема совпадает с серверной проверкой parseOrderRequest:
// любое другое поле сервер отклоняет (400). Цены, итог, статусы, номер и дату определяет сервер.

/**
 * Тело запроса без requestId и guestSessionId (их добавляет orderService).
 * lines — проверенные позиции [{ id, volume, quantity }], values — данные формы CheckoutForm.
 */
export function buildOrderRequest({ lines, promoCode, deliveryMethod, values, expectedTotal }) {
  return {
    items: lines.map((l) => ({ productId: l.id, volume: l.volume, quantity: l.quantity })),
    promoCode: promoCode || null,
    deliveryMethod,
    paymentMethod: values.payment,
    customer: { name: values.name, lastName: values.lastName, phone: values.phone, email: values.email },
    shipping: { region: values.region, city: values.city, address: values.address, comment: values.comment || '' },
    agree: values.agree === true,
    expectedTotal,
  };
}

/** Ключ содержимого попытки: тот же ключ — тот же requestId (повтор после сбоя сети не создаёт второй заказ) */
export const requestContentKey = (request) => JSON.stringify(request);

/**
 * requestId для попытки: прежний, если содержимое не изменилось; новый — если изменилось.
 * attempt — { key, requestId } | null. Возвращает { key, requestId }.
 */
export function nextAttempt(attempt, request, newId) {
  const key = requestContentKey(request);
  if (attempt && attempt.key === key) return attempt;
  return { key, requestId: newId() };
}

/**
 * Ответ 409 сервера → итог проверки в формате окна CheckoutReviewNotice (как у reviewCheckout):
 * - items_unavailable — blocked: недоступные позиции с причиной;
 * - total_changed — confirm: актуальные цены и сумма сервера.
 * seenLines — строки корзины, которые видел покупатель (selectCartItems). null — это не такой ответ.
 */
export function reviewFromServer(error, seenLines) {
  const seen = new Map(seenLines.map((l) => [`${l.id}__${l.volume}`, l]));
  if (error?.code === 'items_unavailable' && Array.isArray(error.details?.problems)) {
    const problems = error.details.problems.map((p) => {
      const key = `${p.productId}__${p.volume}`;
      const was = seen.get(key);
      return { key, id: p.productId, volume: p.volume, quantity: was?.quantity || 1, name: was?.product?.name || p.productId, status: p.reason };
    });
    return { status: 'blocked', lines: [], problems, priceChanges: [], totals: null, source: 'server' };
  }
  if (error?.code === 'total_changed' && Array.isArray(error.details?.lines) && error.details.totals) {
    const lines = error.details.lines.map((l) => {
      const key = `${l.productId}__${l.volume}`;
      const was = seen.get(key);
      const oldPrice = was?.volumeAvailable ? was.price : null;
      return { key, id: l.productId, volume: l.volume, quantity: l.quantity, name: l.name, oldPrice, price: l.price, lineTotal: l.lineTotal, status: oldPrice === l.price ? 'ok' : 'priceChanged' };
    });
    const changed = lines.filter((l) => l.status === 'priceChanged');
    const t = error.details.totals;
    return {
      status: 'confirm',
      lines,
      problems: [],
      // Цены не менялись, но изменилась сумма (скидка, доставка) — показываем все позиции
      priceChanges: changed.length ? changed : lines,
      totals: { subtotal: t.subtotal, discount: t.discount, delivery: t.delivery, grandTotal: t.total },
      source: 'server',
    };
  }
  return null;
}

/**
 * Ключ перевода сообщения покупателю для ошибки оформления (без внутренних подробностей сервера).
 * Возвращает { key, params }.
 */
export function checkoutErrorMessage(error) {
  const code = error?.code;
  switch (code) {
    case 'promo_invalid':
      return { key: 'checkout.errors.promoInvalid' };
    case 'promo_min_total':
      return { key: 'checkout.errors.promoMinTotal', params: { min: error.details?.minTotal } };
    case 'promo_used':
      return { key: 'checkout.errors.promoUsed' };
    case 'auth_expired':
    case 'auth_revoked':
    case 'auth_invalid':
    case 'auth_required':
      return { key: 'checkout.errors.sessionExpired' };
    case 'app_check_required':
    case 'app_check_failed':
    case 'app_check_unavailable':
      return { key: 'checkout.errors.verification' };
    case 'rate_limited':
      return { key: 'checkout.errors.rateLimited', params: { minutes: Math.max(1, Math.ceil((Number(error.retryAfter) || 60) / 60)) } };
    case 'not_configured':
      return { key: 'checkout.errors.unavailable' };
    case 'invalid_request':
    case 'too_large':
    case 'bad_json':
      return { key: 'checkout.errors.invalid' };
    case 'request_conflict':
      return { key: 'checkout.errors.conflict' };
    default:
      return { key: 'checkout.errors.network' };
  }
}

/** Безопасная сводка заказа для страницы результата: только ответ сервера (без телефона, e-mail, адреса) */
export const RECENT_ORDER_FIELDS = ['orderId', 'createdAt', 'customerType', 'items', 'subtotal', 'discount', 'promoCode', 'delivery', 'total', 'deliveryMethod', 'paymentMethod', 'paymentStatus'];
export function toRecentOrder(result) {
  const out = {};
  for (const key of RECENT_ORDER_FIELDS) if (key in result) out[key] = result[key];
  out.items = Array.isArray(result.items)
    ? result.items.map(({ productId, name, brand, volume, price, quantity }) => ({ productId, name, brand, volume, price, quantity }))
    : [];
  return out;
}
