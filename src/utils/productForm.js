// Модель формы товара в админ-панели (этап 5б): товар ↔ значения полей формы, проверка
// с понятными кодами ошибок, предупреждения и предложение id по названию.
// Чистые функции без Firebase и React — проверяются в tests/productForm.test.js.
// Итоговый документ дополнительно проверяется validateProductData (тот же формат, что в firestore.rules).

import { CATEGORIES, CONCENTRATIONS, FAMILIES, INTENSITIES } from '../data/products.js';
import { AVAILABILITIES, ID_PATTERN, LANGS, LIMITS, NOTE_LEVELS, validateProductData } from './products.js';

/** Объёмы, которые можно выбрать в форме */
export const FORM_VOLUMES = [30, 50, 100];

/**
 * Словарь нот — ключи notes.items в locales (ru, ky, en). Витрина выводит t(`notes.items.${key}`),
 * поэтому нота не из словаря показалась бы покупателю «сырым» ключом.
 */
export const NOTE_KEYS = [
  'pinkPepper', 'bergamot', 'rose', 'peony', 'musk', 'iris', 'neroli', 'jasmine', 'tuberose',
  'amber', 'vanilla', 'apple', 'lemon', 'lily', 'pear', 'caramel', 'tonka', 'sandalwood',
  'raspberry', 'blackcurrant', 'cardamom', 'orange', 'patchouli', 'oud', 'leather', 'cedar',
  'vetiver', 'fig', 'mint', 'seaSalt', 'lavender', 'coffee', 'coconut', 'tobacco',
];

/** Значения по умолчанию для нового товара */
export const FORM_DEFAULTS = { availability: 'inStock', rating: '0', popularity: '50' };

const RATING_PATTERN = /^\d+([.,]\d)?$/; // 4 или 4.5 (запятая тоже допустима)
const INTEGER_PATTERN = /^\d+$/;
// Фото: путь на сайте (/images/products/…) или адрес https://. Без пробелов,
// без «//» в начале (адрес на чужом сайте без протокола) и без javascript:/data:
const IMAGE_PATTERN = /^(\/(?!\/)|https:\/\/)\S+$/;

/** Путь к фото по умолчанию — как у демо-каталога */
export const defaultImagePath = (id) => `/images/products/${id}.jpg`;

/** Пустая форма для создания товара */
export function emptyProductForm() {
  return {
    id: '',
    name: '',
    brand: '',
    category: '',
    concentration: '',
    fragranceFamily: '',
    intensity: '',
    description: Object.fromEntries(LANGS.map((l) => [l, ''])),
    image: '',
    volumes: Object.fromEntries(FORM_VOLUMES.map((ml) => [ml, { enabled: false, price: '' }])),
    notes: Object.fromEntries(NOTE_LEVELS.map((level) => [level, []])),
    availability: FORM_DEFAULTS.availability,
    isNew: false,
    isBestseller: false,
    rating: FORM_DEFAULTS.rating,
    popularity: FORM_DEFAULTS.popularity,
  };
}

/**
 * Товар (формат витрины или документа Firestore) → значения формы.
 * hidden и updatedAt в форму не попадают: их форма не меняет.
 * Объёмы вне 30/50/100 в форму не переносятся — о них предупреждает getProductFormWarnings.
 */
export function productToForm(product) {
  const form = emptyProductForm();
  const str = (v) => (typeof v === 'string' ? v : '');
  form.id = str(product.id);
  form.name = str(product.name);
  form.brand = str(product.brand);
  form.category = str(product.category);
  form.concentration = str(product.concentration);
  form.fragranceFamily = str(product.fragranceFamily);
  form.intensity = str(product.intensity);
  LANGS.forEach((l) => {
    form.description[l] = str(product.description?.[l]);
  });
  form.image = str(product.image);
  (product.volumes || []).forEach((v) => {
    if (FORM_VOLUMES.includes(v.ml)) form.volumes[v.ml] = { enabled: true, price: String(v.price) };
  });
  NOTE_LEVELS.forEach((level) => {
    form.notes[level] = Array.isArray(product.notes?.[level]) ? [...product.notes[level]] : [];
  });
  form.availability = AVAILABILITIES.includes(product.availability) ? product.availability : FORM_DEFAULTS.availability;
  form.isNew = product.isNew === true;
  form.isBestseller = product.isBestseller === true;
  form.rating = typeof product.rating === 'number' ? String(product.rating) : FORM_DEFAULTS.rating;
  form.popularity = typeof product.popularity === 'number' ? String(product.popularity) : FORM_DEFAULTS.popularity;
  return form;
}

// ---------- Разбор значений полей ----------

/** Цена в сомах: целое число, пробелы между разрядами допустимы («8 550»). null — не число */
export function parsePrice(value) {
  const s = String(value ?? '').replace(/\s/g, '');
  return INTEGER_PATTERN.test(s) ? Number(s) : null;
}

/** Рейтинг: 0–5, один знак после запятой. null — не число */
export function parseRating(value) {
  const s = String(value ?? '').trim();
  return RATING_PATTERN.test(s) ? Number(s.replace(',', '.')) : null;
}

/** Популярность: целое 0–100. null — не число */
export function parsePopularity(value) {
  const s = String(value ?? '').trim();
  return INTEGER_PATTERN.test(s) ? Number(s) : null;
}

/** Включённые объёмы формы → [{ ml, price }] по возрастанию мл (цена null, если не число) */
function formVolumes(form) {
  return FORM_VOLUMES.filter((ml) => form.volumes?.[ml]?.enabled).map((ml) => ({
    ml,
    price: parsePrice(form.volumes[ml].price),
  }));
}

/**
 * Значения формы → данные документа products/{id} (без updatedAt — его ставит сервер).
 * hidden передаётся отдельно: при редактировании — значение из текущего документа,
 * при создании — false. Форма его не меняет: видимость переключает setProductHidden.
 * Вызывать после validateProductForm без ошибок.
 */
export function formToProduct(form, { hidden = false } = {}) {
  const id = form.id.trim();
  const volumes = formVolumes(form);
  const image = form.image.trim();
  return {
    id,
    name: form.name.trim(),
    brand: form.brand.trim(),
    category: form.category,
    concentration: form.concentration,
    fragranceFamily: form.fragranceFamily,
    intensity: form.intensity,
    notes: Object.fromEntries(NOTE_LEVELS.map((level) => [level, [...form.notes[level]]])),
    rating: parseRating(form.rating),
    popularity: parsePopularity(form.popularity),
    availability: form.availability,
    isNew: form.isNew === true,
    isBestseller: form.isBestseller === true,
    description: Object.fromEntries(LANGS.map((l) => [l, form.description[l].trim()])),
    volumes,
    price: volumes.length ? Math.min(...volumes.map((v) => v.price)) : null,
    image: image || defaultImagePath(id),
    hidden: hidden === true,
  };
}

// ---------- Проверка ----------

/**
 * Проверка формы. Возвращает объект { поле: код }, пустой — всё верно.
 * Поля: id, name, brand, category, concentration, fragranceFamily, intensity, availability,
 * description.ru|ky|en, image, volumes, volumes.30|50|100, notes.top|heart|base, rating, popularity.
 * Коды: required, tooLong, format, invalid, range, tooMany, duplicate, unknownNote.
 */
export function validateProductForm(form) {
  const errors = {};
  const text = (field, value, max) => {
    const v = String(value ?? '').trim();
    if (!v) errors[field] = 'required';
    else if (v.length > max) errors[field] = 'tooLong';
  };
  const oneOf = (field, value, list) => {
    if (!value) errors[field] = 'required';
    else if (!list.includes(value)) errors[field] = 'invalid';
  };

  const id = String(form.id ?? '').trim();
  if (!id) errors.id = 'required';
  else if (id.length > LIMITS.id) errors.id = 'tooLong';
  else if (!ID_PATTERN.test(id)) errors.id = 'format';

  text('name', form.name, LIMITS.name);
  text('brand', form.brand, LIMITS.brand);
  oneOf('category', form.category, CATEGORIES);
  oneOf('concentration', form.concentration, CONCENTRATIONS);
  oneOf('fragranceFamily', form.fragranceFamily, FAMILIES);
  oneOf('intensity', form.intensity, INTENSITIES);
  oneOf('availability', form.availability, AVAILABILITIES);
  LANGS.forEach((l) => text(`description.${l}`, form.description?.[l], LIMITS.description));

  const image = String(form.image ?? '').trim();
  if (image.length > LIMITS.image) errors.image = 'tooLong';
  else if (image && !IMAGE_PATTERN.test(image)) errors.image = 'format';

  const enabled = FORM_VOLUMES.filter((ml) => form.volumes?.[ml]?.enabled);
  if (enabled.length === 0) errors.volumes = 'required';
  enabled.forEach((ml) => {
    const raw = String(form.volumes[ml].price ?? '').trim();
    const price = parsePrice(raw);
    if (!raw) errors[`volumes.${ml}`] = 'required';
    else if (price === null) errors[`volumes.${ml}`] = 'invalid';
    else if (price <= 0 || price > LIMITS.maxPrice) errors[`volumes.${ml}`] = 'range';
  });

  NOTE_LEVELS.forEach((level) => {
    const list = form.notes?.[level];
    const field = `notes.${level}`;
    if (!Array.isArray(list)) errors[field] = 'invalid';
    else if (list.some((n) => !NOTE_KEYS.includes(n))) errors[field] = 'unknownNote';
    else if (new Set(list).size !== list.length) errors[field] = 'duplicate';
    else if (list.length > LIMITS.notesPerLevel) errors[field] = 'tooMany';
  });

  const rating = parseRating(form.rating);
  if (!String(form.rating ?? '').trim()) errors.rating = 'required';
  else if (rating === null) errors.rating = 'invalid';
  else if (rating > 5) errors.rating = 'range';

  const popularity = parsePopularity(form.popularity);
  if (!String(form.popularity ?? '').trim()) errors.popularity = 'required';
  else if (popularity === null) errors.popularity = 'invalid';
  else if (popularity > 100) errors.popularity = 'range';

  // Вторая линия защиты: итоговый документ в формате правил Firestore.
  // Если форма что-то пропустила, ошибка всё равно не дойдёт до записи.
  if (Object.keys(errors).length === 0) {
    validateProductData(formToProduct(form)).forEach((field) => {
      errors[field] = errors[field] || 'invalid';
    });
  }
  return errors;
}

// ---------- Предупреждения (сохранению не мешают) ----------

/**
 * Предупреждения: [{ code, params }].
 * - priceOrder — больший объём дешевле меньшего;
 * - removedVolumes — у товара были объёмы, которых не будет после сохранения
 *   (в корзинах покупателей такие позиции получат пометку «объём недоступен»).
 * original — товар до изменений (null при создании).
 */
export function getProductFormWarnings(form, original = null) {
  const warnings = [];
  const volumes = formVolumes(form).filter((v) => v.price !== null);
  for (let i = 1; i < volumes.length; i += 1) {
    if (volumes[i].price < volumes[i - 1].price) {
      warnings.push({ code: 'priceOrder', params: { larger: volumes[i].ml, smaller: volumes[i - 1].ml } });
      break;
    }
  }
  if (Array.isArray(original?.volumes)) {
    const kept = new Set(FORM_VOLUMES.filter((ml) => form.volumes?.[ml]?.enabled));
    // Повреждённый документ может содержать мусор вместо объёмов — учитываем только числа
    const removed = original.volumes.map((v) => v?.ml).filter((ml) => Number.isInteger(ml) && !kept.has(ml));
    if (removed.length) warnings.push({ code: 'removedVolumes', params: { volumes: removed } });
  }
  return warnings;
}

// ---------- id по названию ----------

const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  ң: 'ng', ө: 'o', ү: 'u',
};

/**
 * Предложение id по названию: латиница в нижнем регистре, цифры и дефисы, до 60 символов.
 * «Rose Poudrée» → rose-poudree, «Ала-Тоо Түн» → ala-too-tun. Администратор может изменить id до создания.
 */
export function slugifyProductId(name) {
  const latin = [...String(name ?? '').toLowerCase()].map((ch) => TRANSLIT[ch] ?? ch).join('');
  return latin
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // é → e, ô → o
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, LIMITS.id)
    .replace(/-+$/g, '');
}

// ---------- Тексты ошибок для интерфейса ----------

const SELECT_FIELDS = ['category', 'concentration', 'fragranceFamily', 'intensity', 'availability'];

/**
 * Ошибка поля → ключ перевода admin.productForm.errors.<key> и параметры.
 * field — как в validateProductForm ('name', 'description.ky', 'volumes.50'…);
 * code — код ошибки, плюс 'idTaken' (id занят — ответ сервера при создании).
 */
export function productFormErrorMessage(field, code) {
  const base = field.split('.')[0];
  switch (code) {
    case 'idTaken':
      return { key: 'idTaken' };
    case 'required':
      if (field === 'volumes') return { key: 'volumesRequired' };
      if (SELECT_FIELDS.includes(field)) return { key: 'choose' };
      return { key: 'required' };
    case 'tooLong': {
      const max = { id: LIMITS.id, description: LIMITS.description, image: LIMITS.image }[base] ?? LIMITS.name;
      return { key: 'tooLong', params: { max } };
    }
    case 'format':
      return { key: field === 'id' ? 'idFormat' : 'imageFormat' };
    case 'tooMany':
      return { key: 'tooMany', params: { max: LIMITS.notesPerLevel } };
    case 'duplicate':
    case 'unknownNote':
      return { key: code };
    default:
      break;
  }
  if (base === 'volumes') return code === 'range' ? { key: 'priceRange', params: { max: LIMITS.maxPrice } } : { key: 'priceInvalid' };
  if (field === 'rating') return { key: code === 'range' ? 'ratingRange' : 'ratingInvalid' };
  if (field === 'popularity') return { key: code === 'range' ? 'popularityRange' : 'popularityInvalid' };
  return { key: 'invalid' };
}

/**
 * Поля, отклонённые сервисом (err.fields — как у validateProductData), → ошибки формы.
 * price считается из объёмов, поэтому его ошибка показывается у объёмов; неизвестные поля пропускаются.
 */
export function serverFieldsToFormErrors(fields = []) {
  const known = new Set([
    'id', 'name', 'brand', 'category', 'concentration', 'fragranceFamily', 'intensity', 'availability',
    'image', 'rating', 'popularity', 'volumes',
    ...LANGS.map((l) => `description.${l}`),
    ...NOTE_LEVELS.map((level) => `notes.${level}`),
  ]);
  const errors = {};
  fields.forEach((f) => {
    const field = f === 'price' ? 'volumes' : f === 'description' ? 'description.ru' : f === 'notes' ? 'notes.top' : f;
    if (known.has(field)) errors[field] = 'invalid';
  });
  return errors;
}

/** Порядок полей на странице — фокус переходит к первой ошибке */
export const PRODUCT_FORM_FIELD_ORDER = [
  'id', 'name', 'brand', 'category', 'fragranceFamily', 'concentration', 'intensity',
  ...LANGS.map((l) => `description.${l}`),
  'image',
  'volumes', ...FORM_VOLUMES.map((ml) => `volumes.${ml}`),
  ...NOTE_LEVELS.map((level) => `notes.${level}`),
  'availability', 'rating', 'popularity',
];

/** id элемента формы для поля: 'description.ky' → 'pf-description-ky' */
export const productFormFieldId = (field) => `pf-${field.replace(/\./g, '-')}`;
