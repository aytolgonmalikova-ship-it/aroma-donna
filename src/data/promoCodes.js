// ДЕМОНСТРАЦИОННЫЕ промокоды. Они работают только внутри учебного проекта
// и не являются реальными акциями магазина.
// oneTime: true — код можно использовать только в одном оформленном заказе (запоминается в localStorage).
export const PROMO_CODES = {
  AROMA10: { type: 'percent', value: 10, minTotal: 0, oneTime: false },
  DONNA500: { type: 'fixed', value: 500, minTotal: 5000, oneTime: false },
  WELCOME15: { type: 'percent', value: 15, minTotal: 3000, oneTime: true },
};
