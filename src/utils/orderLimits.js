// Общие ограничения заказа (C3.3, этап 1). Модуль без React и браузерных API — его будут использовать
// и форма оформления, и серверная проверка заказа (следующие этапы), чтобы ограничения не расходились.
// Значения согласованы с текущим поведением сайта:
// - количество одного товара — та же константа, что в корзине (src/utils/cart.js, MAX_QUANTITY);
// - комментарий — как maxLength поля «Комментарий» в CheckoutForm.jsx;
// - минимальные длины — как в validateCheckout (src/utils/validation.js);
// - максимальные длины выбраны с запасом, чтобы не отклонять настоящие заказы.
import { MAX_QUANTITY } from './cart.js';

export const ORDER_LIMITS = Object.freeze({
  /** Позиций (строк корзины) в одном заказе */
  maxLines: 20,
  /** Штук одного товара одного объёма в позиции */
  maxQuantity: MAX_QUANTITY,
  nameMin: 2,
  nameMax: 100,
  lastNameMin: 2,
  lastNameMax: 100,
  emailMax: 254,
  addressMin: 5,
  addressMax: 300,
  commentMax: 300,
  promoCodeMax: 32,
});

/** Количество одной позиции: целое от 1 до maxQuantity */
export const isValidOrderQuantity = (quantity) =>
  Number.isInteger(quantity) && quantity >= 1 && quantity <= ORDER_LIMITS.maxQuantity;

/** Число позиций в заказе: от 1 до maxLines */
export const isValidOrderLineCount = (count) => Number.isInteger(count) && count >= 1 && count <= ORDER_LIMITS.maxLines;

/** Длина строки (после обрезки пробелов по краям) в пределах [min, max] */
export function isWithinLength(value, max, min = 0) {
  if (typeof value !== 'string') return false;
  const length = value.trim().length;
  return length >= min && length <= max;
}
