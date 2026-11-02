// Чистые функции для товаров в Firestore (этап 5а): формат документа products/{id},
// проверка перед записью, превращение документа в товар витрины и данные для фильтров.
// Те же ограничения проверяют правила firestore.rules (функция isValidProduct) — держите их в согласии.

import { CATEGORIES, CONCENTRATIONS, FAMILIES, INTENSITIES } from '../data/products.js';

export const AVAILABILITIES = ['inStock', 'lowStock', 'outOfStock'];
export const LANGS = ['ru', 'ky', 'en'];
export const NOTE_LEVELS = ['top', 'heart', 'base'];

/** Поля документа products/{id}. updatedAt ставит сервер (serverTimestamp) */
export const PRODUCT_FIELDS = [
  'id',
  'name',
  'brand',
  'category',
  'concentration',
  'fragranceFamily',
  'intensity',
  'notes',
  'rating',
  'popularity',
  'availability',
  'isNew',
  'isBestseller',
  'description',
  'volumes',
  'price',
  'image',
  'hidden',
  'updatedAt',
];

export const LIMITS = {
  id: 60,
  name: 100,
  brand: 100,
  image: 500,
  description: 2000,
  notesPerLevel: 10,
  volumes: 4,
  maxMl: 1000,
  maxPrice: 10000000,
};

// id — латиница в нижнем регистре, цифры и дефисы: он же адрес страницы /product/{id}
const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const isValidVolume = (v) =>
  isPlainObject(v) &&
  Number.isInteger(v.ml) &&
  v.ml > 0 &&
  v.ml <= LIMITS.maxMl &&
  typeof v.price === 'number' &&
  Number.isFinite(v.price) &&
  v.price > 0 &&
  v.price <= LIMITS.maxPrice;

/** Объёмы по возрастанию мл (без мутации исходного массива) */
export const sortVolumes = (volumes) => [...volumes].sort((a, b) => a.ml - b.ml);

/** Минимальная цена среди объёмов — поле price («цена от») */
export const minVolumePrice = (volumes) => Math.min(...volumes.map((v) => v.price));

/**
 * Товар каталога → данные документа products/{id} (без updatedAt).
 * Поля витрины, которые вычисляются при чтении (volume), в базу не пишутся.
 */
export function toFirestoreProduct(product) {
  const volumes = sortVolumes(product.volumes || []).map(({ ml, price }) => ({ ml, price }));
  return {
    id: product.id,
    name: product.name,
    brand: product.brand,
    category: product.category,
    concentration: product.concentration,
    fragranceFamily: product.fragranceFamily,
    intensity: product.intensity,
    notes: {
      top: [...(product.notes?.top || [])],
      heart: [...(product.notes?.heart || [])],
      base: [...(product.notes?.base || [])],
    },
    rating: product.rating,
    popularity: product.popularity,
    availability: product.availability,
    isNew: Boolean(product.isNew),
    isBestseller: Boolean(product.isBestseller),
    description: { ru: product.description?.ru, ky: product.description?.ky, en: product.description?.en },
    volumes,
    price: volumes.length ? minVolumePrice(volumes) : product.price,
    image: product.image || `/images/products/${product.id}.jpg`,
    hidden: Boolean(product.hidden),
  };
}

/**
 * Проверка данных документа перед записью. Возвращает список ошибок (пустой — всё верно).
 * Ошибка — имя поля, например 'volumes' или 'description.ky'.
 */
export function validateProductData(data) {
  const errors = [];
  if (!isPlainObject(data)) return ['data'];

  const unknown = Object.keys(data).filter((k) => !PRODUCT_FIELDS.includes(k));
  unknown.forEach((k) => errors.push(`unknown.${k}`));

  if (typeof data.id !== 'string' || data.id.length > LIMITS.id || !ID_PATTERN.test(data.id)) errors.push('id');
  if (!isText(data.name, LIMITS.name)) errors.push('name');
  if (!isText(data.brand, LIMITS.brand)) errors.push('brand');
  if (!CATEGORIES.includes(data.category)) errors.push('category');
  if (!CONCENTRATIONS.includes(data.concentration)) errors.push('concentration');
  if (!FAMILIES.includes(data.fragranceFamily)) errors.push('fragranceFamily');
  if (!INTENSITIES.includes(data.intensity)) errors.push('intensity');
  if (!AVAILABILITIES.includes(data.availability)) errors.push('availability');
  ['isNew', 'isBestseller', 'hidden'].forEach((k) => typeof data[k] !== 'boolean' && errors.push(k));

  if (typeof data.rating !== 'number' || !(data.rating >= 0 && data.rating <= 5)) errors.push('rating');
  if (typeof data.popularity !== 'number' || !(data.popularity >= 0 && data.popularity <= 100)) errors.push('popularity');
  if (typeof data.image !== 'string' || data.image.length > LIMITS.image) errors.push('image');

  if (!isPlainObject(data.description)) errors.push('description');
  else LANGS.forEach((l) => !isText(data.description[l], LIMITS.description) && errors.push(`description.${l}`));

  if (!isPlainObject(data.notes)) errors.push('notes');
  else
    NOTE_LEVELS.forEach((level) => {
      const list = data.notes[level];
      const ok = Array.isArray(list) && list.length <= LIMITS.notesPerLevel && list.every((n) => typeof n === 'string');
      if (!ok) errors.push(`notes.${level}`);
    });

  const volumes = data.volumes;
  const volumesOk =
    Array.isArray(volumes) &&
    volumes.length >= 1 &&
    volumes.length <= LIMITS.volumes &&
    volumes.every(isValidVolume) &&
    new Set(volumes.map((v) => v.ml)).size === volumes.length;
  if (!volumesOk) errors.push('volumes');
  else if (data.price !== minVolumePrice(volumes)) errors.push('price');

  return errors;
}

/**
 * Демо-каталог → документы для импорта. Бросает ошибку, если хоть один товар некорректен
 * или id повторяются: импорт либо записывает весь каталог, либо ничего.
 */
export function prepareCatalogImport(products) {
  const docs = products.map(toFirestoreProduct);
  const seen = new Set();
  docs.forEach((doc) => {
    const errors = validateProductData(doc);
    if (seen.has(doc.id)) errors.push('duplicate-id');
    seen.add(doc.id);
    if (errors.length) throw new Error(`invalid-product:${doc.id}:${errors.join(',')}`);
  });
  return docs;
}

/** Дата Firestore (Timestamp), Date или строка → ISO-строка; иначе null */
function toIsoDate(value) {
  if (value?.toDate) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' ? value : null;
}

/**
 * Документ products/{id} → товар витрины (тот же формат, что у src/data/products.js).
 * Возвращает null, если документ повреждён настолько, что товар нельзя показать и купить.
 * Значения для Redux — только обычные объекты и строки (Timestamp превращается в ISO-строку).
 */
export function toCatalogProduct(id, data) {
  if (!isPlainObject(data) || !isText(data.name, LIMITS.name)) return null;
  const volumes = Array.isArray(data.volumes)
    ? sortVolumes(data.volumes.filter(isValidVolume).map(({ ml, price }) => ({ ml, price })))
    : [];
  if (volumes.length === 0) return null;

  const notes = isPlainObject(data.notes) ? data.notes : {};
  const description = isPlainObject(data.description) ? data.description : {};
  const text = (v) => (typeof v === 'string' ? v : '');

  return {
    id,
    name: data.name,
    brand: text(data.brand),
    category: data.category,
    concentration: data.concentration,
    fragranceFamily: data.fragranceFamily,
    intensity: data.intensity,
    notes: Object.fromEntries(
      NOTE_LEVELS.map((level) => [level, Array.isArray(notes[level]) ? notes[level].filter((n) => typeof n === 'string') : []]),
    ),
    rating: typeof data.rating === 'number' ? data.rating : 0,
    popularity: typeof data.popularity === 'number' ? data.popularity : 0,
    availability: AVAILABILITIES.includes(data.availability) ? data.availability : 'outOfStock',
    isNew: data.isNew === true,
    isBestseller: data.isBestseller === true,
    description: Object.fromEntries(LANGS.map((l) => [l, text(description[l])])),
    price: minVolumePrice(volumes),
    volume: volumes[0].ml,
    volumes,
    image: isText(data.image, LIMITS.image) ? data.image : `/images/products/${id}.jpg`,
    hidden: data.hidden === true,
    updatedAt: toIsoDate(data.updatedAt),
  };
}

/** Бренды загруженного каталога (по алфавиту, без повторов) */
export const getBrands = (products) => [...new Set(products.map((p) => p.brand).filter(Boolean))].sort();

/** Диапазон цен каталога: от минимальной цены до цены самого большого объёма. null — товаров нет */
export function getPriceLimits(products) {
  if (!products.length) return null;
  const prices = products.flatMap((p) => p.volumes.map((v) => v.price));
  return { min: Math.min(...prices), max: Math.max(...prices) };
}
