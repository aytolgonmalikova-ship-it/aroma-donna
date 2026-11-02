// Список товаров в админ-панели (этап 5б): поиск, фильтры, сортировка и параметры адреса;
// видимость, счётчики и доступность скрытия и удаления (этап 5в).
// Все товары (и скрытые) уже загружены, поэтому всё считается в браузере — новые индексы Firestore не нужны.
// Чистые функции — проверяются в tests/adminProducts.test.js.

import { CATEGORIES, FAMILIES } from '../data/products.js';
import { AVAILABILITIES } from './products.js';

// Варианты сортировки (первый — по умолчанию): недавно изменённые, название, цена ↑, цена ↓
export const PRODUCT_SORTS = ['updated', 'name', 'priceAsc', 'priceDesc'];

// Фильтр видимости: на витрине или скрытые (пустая строка — все)
export const PRODUCT_VISIBILITIES = ['visible', 'hidden'];

/** Фильтры по умолчанию. Пустая строка — «все» */
export const DEFAULT_PRODUCT_FILTERS = {
  q: '',
  gender: '',
  family: '',
  stock: '',
  visibility: '',
  sort: PRODUCT_SORTS[0],
};

// Фильтры, которые считает кнопка «Сбросить» (без поиска и сортировки)
const COUNTED_FILTERS = ['gender', 'family', 'stock', 'visibility'];

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

/** Подходит ли товар под фильтр видимости ('' — любой) */
const matchesVisibility = (product, visibility) =>
  !visibility || (visibility === 'hidden' ? product.hidden === true : product.hidden === false);

/** Фильтры: gender — пол (category), family — семейство ароматов, stock — наличие, visibility — видимость */
export function filterAdminProducts(products, filters) {
  const { q = '', gender = '', family = '', stock = '', visibility = '' } = filters;
  return products.filter(
    (p) =>
      matchesProductQuery(p, q) &&
      (!gender || p.category === gender) &&
      (!family || p.fragranceFamily === family) &&
      (!stock || p.availability === stock) &&
      matchesVisibility(p, visibility),
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
 * Параметры адреса (?q=&gender=&family=&stock=&visibility=&sort=) → фильтры.
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
    visibility: pick('visibility', PRODUCT_VISIBILITIES),
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
export const countActiveProductFilters = (filters) => COUNTED_FILTERS.filter((k) => filters[k]).length;

// ---------- Видимость, счётчики, скрытие и удаление (этап 5в) ----------

/**
 * Счётчики для сводки: всего документов, на витрине, скрытых и повреждённых.
 * data — результат fetchAllProducts: { products, invalidIds }. Повреждённые документы витрина не показывает,
 * поэтому в visible и hidden они не входят. visible — ровно те товары, что видит покупатель.
 */
export function countProductVisibility(data) {
  const products = data?.products ?? [];
  const damaged = data?.invalidIds?.length ?? 0;
  const hidden = products.filter((p) => p.hidden === true).length;
  return { total: products.length + damaged, visible: products.length - hidden, hidden, damaged };
}

/**
 * Почему товар нельзя скрыть (или null — можно). Те же правила проверяет сервис
 * (adminProductsStore.setProductHidden); здесь — чтобы заранее заблокировать кнопку и объяснить причину.
 * last-visible — это последний товар на витрине: иначе покупатели увидели бы демо-каталог.
 */
export function hideBlockReason(product, counts) {
  if (!product || product.hidden) return null;
  return counts.visible <= 1 ? 'last-visible' : null;
}

/**
 * Почему товар нельзя удалить (или null — можно): not-hidden — сначала скрыть,
 * last-visible — на витрине нет видимых товаров (удаление не должно закреплять демо-каталог).
 * counts можно не передавать (страница товара не знает счётчиков) — тогда last-visible проверяет сервис.
 */
export function deleteBlockReason(product, counts) {
  if (!product) return null;
  if (product.hidden !== true) return 'not-hidden';
  return counts && counts.visible < 1 ? 'last-visible' : null;
}

/**
 * Список после изменения одного товара (новый объект, исходный не меняется).
 * product — свежий товар из Firestore (например, после скрытия — с новой датой updatedAt,
 * иначе следующее действие с той же строкой получило бы conflict). Если товар был в списке
 * повреждённых, он оттуда убирается.
 */
export function replaceListProduct(data, product) {
  const exists = data.products.some((p) => p.id === product.id);
  return {
    products: exists ? data.products.map((p) => (p.id === product.id ? product : p)) : [...data.products, product],
    invalidIds: data.invalidIds.filter((id) => id !== product.id),
  };
}

/** Список после удаления товара: убирается и из товаров, и из повреждённых */
export function removeListProduct(data, id) {
  return {
    products: data.products.filter((p) => p.id !== id),
    invalidIds: data.invalidIds.filter((x) => x !== id),
  };
}

/**
 * Список после повторного чтения одного товара из Firestore (после скрытия, при конфликте и т.п.).
 * fetched — результат fetchProductForEdit ({ product, damaged }) или null, если товара больше нет.
 * - нет товара — строка убирается;
 * - документ повреждён — строка переходит в список повреждённых;
 * - иначе строка заменяется свежими данными (с новой датой updatedAt).
 * data === null (список перезагружается) — возвращается как есть.
 */
export function applyFetchedProduct(data, id, fetched) {
  if (!data) return data;
  if (!fetched) return removeListProduct(data, id);
  if (fetched.damaged) {
    return {
      products: data.products.filter((p) => p.id !== id),
      invalidIds: data.invalidIds.includes(id) ? data.invalidIds : [...data.invalidIds, id],
    };
  }
  return replaceListProduct(data, fetched.product);
}

// ---------- Окончательное удаление (подэтап 5в.4) ----------

/** Формат JSON-копии товара: по нему копию можно отличить от других файлов */
export const PRODUCT_BACKUP_FORMAT = 'aroma-donna/product-backup';

/** Значение документа → обычный JSON: Timestamp Firestore (есть toDate) превращается в ISO-строку */
function toPlainJson(value) {
  if (Array.isArray(value)) return value.map(toPlainJson);
  if (value && typeof value === 'object') {
    if (typeof value.toDate === 'function') return value.toDate().toISOString();
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toPlainJson(v)]));
  }
  return value;
}

/**
 * JSON-копия товара перед окончательным удалением. document — документ Firestore как есть
 * (все поля, updatedAt — ISO-строкой), по нему товар можно восстановить вручную.
 */
export function buildProductBackup(id, raw, exportedAt = new Date()) {
  return {
    format: PRODUCT_BACKUP_FORMAT,
    version: 1,
    collection: 'products',
    id,
    exportedAt: exportedAt.toISOString(),
    document: toPlainJson(raw ?? {}),
  };
}

/** Имя файла копии: product-<id>-<ГГГГ-ММ-ДД>.json */
export const productBackupFileName = (id, date = new Date()) => `product-${id}-${date.toISOString().slice(0, 10)}.json`;

/**
 * Введён ли точный ID для подтверждения удаления. Регистр важен; пробелы по краям
 * (например, при вставке) не считаются — в ID пробелов быть не может.
 */
export const isDeleteConfirmed = (input, id) => Boolean(id) && String(input ?? '').trim() === id;

/**
 * Что предложить после ошибки удаления:
 * reload — товар изменили или вернули на витрину в другом окне: загрузить актуальную версию;
 * list — товара уже нет: вернуться к списку;
 * retry — временная ошибка (сеть и т.п.): можно повторить;
 * null — повторять бессмысленно, пока не изменится ситуация (нет прав, нет видимых товаров).
 */
export function deleteErrorAction(code) {
  if (code === 'conflict' || code === 'not-hidden') return 'reload';
  if (code === 'not-found') return 'list';
  if (code === 'denied' || code === 'last-visible' || code === 'not-configured') return null;
  return 'retry';
}

// ---------- Видимость на странице товара (подэтап 5в.5) ----------

/**
 * Блок «Видимость на витрине» на странице товара.
 * status: visible — товар на витрине (hidden == false, как в запросе витрины), hidden — скрыт,
 * damaged — документ повреждён: витрина его не показывает, а правила отклонили бы запись.
 * action: hide | show | null — что сделает кнопка.
 * blocked — почему кнопку сейчас нажать нельзя (или null):
 * damaged — сначала исправить и сохранить товар; dirty — в форме несохранённые изменения
 * (сначала сохранить или отменить их); busy — выполняется другое действие (сохранение, удаление, переключение).
 */
export function productVisibilityState({ product, damaged = false, dirty = false, busy = false }) {
  if (!product || damaged) return { status: 'damaged', action: null, blocked: 'damaged' };
  const visible = product.hidden === false;
  return {
    status: visible ? 'visible' : 'hidden',
    action: visible ? 'hide' : 'show',
    blocked: dirty ? 'dirty' : busy ? 'busy' : null,
  };
}

/**
 * Что предложить после ошибки setProductHidden на странице товара:
 * reload — товар изменили в другом окне или документ оказался повреждён: загрузить актуальную версию;
 * list — товара уже нет: вернуться к списку;
 * null — достаточно сообщения (сеть, права, последний видимый товар); кнопка видимости остаётся доступной.
 */
export function visibilityErrorAction(code) {
  if (code === 'conflict' || code === 'damaged') return 'reload';
  if (code === 'not-found') return 'list';
  return null;
}
