// Регионы Кыргызстана и города, в которые доставляем (ключи переводов regions.* и cities.*).
// Общий модуль без React и браузерных API: его используют форма оформления заказа (CheckoutForm.jsx)
// и — на следующих этапах C3.3 — серверная проверка заказа. Порядок регионов и городов — порядок в форме.
export const REGIONS = {
  bishkek: ['bishkek'],
  chui: ['tokmok'],
  osh: ['osh'],
  jalalabad: ['jalalabad'],
  issykkul: ['karakol', 'cholponata'],
  naryn: ['naryn'],
  talas: ['talas'],
  batken: ['batken'],
};

/** Есть ли такой регион и такой город в нём (проверка данных, пришедших извне) */
export function isKnownRegionCity(region, city) {
  return (
    typeof region === 'string' &&
    typeof city === 'string' &&
    Object.hasOwn(REGIONS, region) &&
    REGIONS[region].includes(city)
  );
}
