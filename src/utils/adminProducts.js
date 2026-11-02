// Список товаров в админ-панели (этап 5б): поиск, фильтры, сортировка и параметры адреса.
// Все товары (и скрытые) уже загружены, поэтому всё считается в браузере — новые индексы Firestore не нужны.
// Чистые функции — проверяются в tests/adminProducts.test.js.

import { CATEGORIES, FAMILIES } from '../data/products.js';
import { AVAILABILITIES } from './products.js';

// Варианты сортировки (первый — по умолчанию): недавно изменённые, название, цена ↑, цена ↓
export const PRODUCT_SORTS = ['updated', 'name', 'priceAsc', 'priceDesc'];

/** Фильтры по умолчанию. Пустая строка — «все» */
export const DEFAULT_PRODUCT_FILTERS = { q: '', gender: '', family: '', stock: '', sort: PRODUCT_SORTS[0] };

/** Дата (ISO-строка) → миллисекунды; нет даты — 0 */
const toMs = (value) => {
  const ms = value ? new Date(value).getTime() : 0;
  return Number.isNaN(ms) ? 0 : ms;
};

/** Поиск по названию, бренду и id — без учёта регистра и пробелов по краям */
export function matchesProductQuery(product, query) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return true;
  return [product.name, product.brand, product.id].some((v) => String(v ?? '').toLowerCase().includes(q));
}

/** Фильтры: gender — пол (category), family — семейство ароматов, stock — наличие */
export function filterAdminProducts(products, filters) {
  const { q = '', gender = '', family = '', stock = '' } = filters;
  return products.filter(
    (p) =>
      matchesProductQuery(p, q) &&
      (!gender || p.category === gender) &&
      (!family || p.fragranceFamily === family) &&
      (!stock || p.availability === stock),
  );
}

/**
 * Сортировка (новый массив, исходный не меняется).
 * updated — сначала недавно изменённые, товары без даты — в конце;
 * при равенстве — по названию.
 */
export function sortAdminProducts(products, sort, lang = 'ru') {
  const byName = (a, b) => String(a.name).localeCompare(String(b.name), lang);
  const list = [...products];
  switch (sort) {
    case 'name':
      return list.sort(byName);
    case 'priceAsc':
      return list.sort((a, b) => a.price - b.price || byName(a, b));
    case 'priceDesc':
      return list.sort((a, b) => b.price - a.price || byName(a, b));
    case 'updated':
    default:
      return list.sort((a, b) => toMs(b.updatedAt) - toMs(a.updatedAt) || byName(a, b));
  }
}

/**
 * Параметры адреса (?q=&gender=&family=&stock=&sort=) → фильтры.
 * Неизвестные значения заменяются значениями по умолчанию — ссылка с ошибкой не ломает список.
 */
export function parseProductListParams(params) {
  const pick = (key, list) => {
    const v = params.get(key);
    return list.includes(v) ? v : DEFAULT_PRODUCT_FILTERS[key];
  };
  return {
    q: params.get('q') || '',
    gender: pick('gender', CATEGORIES),
    family: pick('family', FAMILIES),
    stock: pick('stock', AVAILABILITIES),
    sort: pick('sort', PRODUCT_SORTS),
  };
}

/**
 * Фильтры → параметры адреса (значения по умолчанию не пишутся).
 * Поиск сохраняется как введён (поле читает его из адреса — иначе пробел между словами
 * пропадал бы при вводе); запрос из одних пробелов в адрес не пишется.
 */
export function toProductListParams(filters) {
  const params = new URLSearchParams();
  Object.keys(DEFAULT_PRODUCT_FILTERS).forEach((key) => {
    const value = filters[key];
    const empty = key === 'q' ? !String(value ?? '').trim() : !value || value === DEFAULT_PRODUCT_FILTERS[key];
    if (!empty) params.set(key, value);
  });
  return params;
}

/** Активных фильтров (без поиска и сортировки) — для кнопки «Сбросить» */
export const countActiveProductFilters = (filters) => ['gender', 'family', 'stock'].filter((k) => filters[k]).length;
