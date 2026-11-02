// Расчёт скидки по ДЕМОНСТРАЦИОННЫМ промокодам и стоимости доставки.
import { PROMO_CODES } from '../data/promoCodes.js';

export const DELIVERY_METHODS = {
  courier: { price: 300, freeFrom: 7000 }, // курьер по Бишкеку
  pickup: { price: 0, freeFrom: 0 }, // самовывоз из бутика
  regions: { price: 450, freeFrom: 12000 }, // доставка по регионам КР
};

/**
 * Проверка промокода.
 * Возвращает { ok: true, promo } или { ok: false, error: 'ключ перевода', params }.
 */
export function checkPromoCode(rawCode, { subtotal, appliedCode, usedCodes }) {
  const code = rawCode.trim().toUpperCase();
  if (!code) return { ok: false, error: 'promo.errorEmpty' };
  const promo = PROMO_CODES[code];
  if (!promo) return { ok: false, error: 'promo.errorInvalid' };
  if (appliedCode === code) return { ok: false, error: 'promo.errorAlreadyApplied' };
  if (promo.oneTime && usedCodes.includes(code)) return { ok: false, error: 'promo.errorUsed' };
  if (subtotal < promo.minTotal) {
    return { ok: false, error: 'promo.errorMinTotal', params: { min: promo.minTotal } };
  }
  return { ok: true, promo: { code, ...promo } };
}

export function calcDiscount(subtotal, promoCode) {
  const promo = promoCode ? PROMO_CODES[promoCode] : null;
  if (!promo || subtotal < promo.minTotal) return 0;
  if (promo.type === 'percent') return Math.round((subtotal * promo.value) / 100);
  return Math.min(promo.value, subtotal);
}

export function calcDelivery(method, amountAfterDiscount) {
  const m = DELIVERY_METHODS[method];
  if (!m) return 0;
  if (m.freeFrom && amountAfterDiscount >= m.freeFrom) return 0;
  return m.price;
}
