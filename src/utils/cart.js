// Чистые функции корзины и избранного: сборка строк корзины по каталогу, счётчики,
// очистка устаревших записей и смена объёма. Используются в cartSlice и favoritesSlice.
// Каталог теперь приходит из Firestore, поэтому товар или его объём могут исчезнуть —
// эти функции не дают таким записям сломать сумму, счётчики или заказ.

export const MAX_QUANTITY = 10;

export const makeKey = (id, volume) => `${id}__${volume}`;

/**
 * Позиции корзины, дополненные данными товара из каталога.
 * - Товара нет в каталоге — позиция не показывается.
 * - Товар есть, но выбранного объёма больше нет — volumeAvailable: false, price: null, lineTotal: 0.
 *   Цена другого объёма НЕ подставляется: объём и цена всегда соответствуют друг другу.
 */
export function buildCartLines(items, catalog) {
  const byId = new Map(catalog.map((p) => [p.id, p]));
  const lines = [];
  items.forEach((item) => {
    const product = byId.get(item.id);
    if (!product) return;
    const variant = product.volumes.find((v) => v.ml === item.volume);
    lines.push(
      variant
        ? { ...item, product, volumeAvailable: true, price: variant.price, lineTotal: variant.price * item.quantity }
        : { ...item, product, volumeAvailable: false, price: null, lineTotal: 0 },
    );
  });
  return lines;
}

/** Есть ли в корзине позиции, которые нельзя оформить (объём недоступен) */
export const hasUnavailableLines = (lines) => lines.some((line) => !line.volumeAvailable);

/**
 * Количество штук для значка корзины.
 * Пока каталог не загружен, проверить товары нельзя — считаем всё сохранённое;
 * после загрузки — только товары, которые есть в каталоге.
 */
export function countCartItems(items, catalog, catalogLoaded) {
  const ids = catalogLoaded ? new Set(catalog.map((p) => p.id)) : null;
  return items.reduce((sum, item) => (!ids || ids.has(item.id) ? sum + item.quantity : sum), 0);
}

/** Количество избранного для значка — по тому же принципу, что и countCartItems */
export function countFavorites(ids, catalog, catalogLoaded) {
  if (!catalogLoaded) return ids.length;
  const known = new Set(catalog.map((p) => p.id));
  return ids.filter((id) => known.has(id)).length;
}

/**
 * Очистка устаревших записей после успешной загрузки каталога: удаляются только позиции
 * товаров, которых нет в каталоге. Позиции действующих товаров (в том числе с недоступным
 * объёмом — покупатель выберет другой) остаются. Возвращает тот же массив, если удалять нечего.
 */
export function pruneCartItems(items, catalog) {
  const ids = new Set(catalog.map((p) => p.id));
  const kept = items.filter((item) => ids.has(item.id));
  return kept.length === items.length ? items : kept;
}

export function pruneFavoriteIds(favoriteIds, catalog) {
  const ids = new Set(catalog.map((p) => p.id));
  const kept = favoriteIds.filter((id) => ids.has(id));
  return kept.length === favoriteIds.length ? favoriteIds : kept;
}

/**
 * Сменить объём позиции корзины. Если позиция с новым объёмом уже есть — количества
 * складываются (не больше MAX_QUANTITY). Порядок позиций сохраняется.
 */
export function changeItemVolume(items, key, volume) {
  const item = items.find((i) => i.key === key);
  if (!item || item.volume === volume) return items;
  const newKey = makeKey(item.id, volume);
  const target = items.find((i) => i.key === newKey);
  if (target) {
    return items
      .filter((i) => i.key !== key)
      .map((i) => (i.key === newKey ? { ...i, quantity: Math.min(i.quantity + item.quantity, MAX_QUANTITY) } : i));
  }
  return items.map((i) => (i.key === key ? { ...i, key: newKey, volume } : i));
}
