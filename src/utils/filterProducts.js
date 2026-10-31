// Чистые функции каталога: поиск, фильтрация и сортировка.
// «Чистые» — значит, не меняют исходный массив и всегда дают одинаковый результат
// для одинаковых входных данных. Их легко тестировать и объяснять.

export const SORT_OPTIONS = ['popular', 'rating', 'priceAsc', 'priceDesc', 'nameAsc', 'new'];

export const DEFAULT_FILTERS = {
  q: '',
  category: [],
  brand: [],
  family: [],
  concentration: [],
  minPrice: '',
  maxPrice: '',
  inStock: false,
  sort: 'popular',
};

/** Поиск по названию и бренду (без учёта регистра) */
export function matchesSearch(product, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return product.name.toLowerCase().includes(q) || product.brand.toLowerCase().includes(q);
}

export function filterProducts(products, filters) {
  const min = filters.minPrice === '' ? 0 : Number(filters.minPrice);
  const max = filters.maxPrice === '' ? Infinity : Number(filters.maxPrice);

  return products.filter((p) => {
    if (!matchesSearch(p, filters.q)) return false;
    if (filters.category.length && !filters.category.includes(p.category)) return false;
    if (filters.brand.length && !filters.brand.includes(p.brand)) return false;
    if (filters.family.length && !filters.family.includes(p.fragranceFamily)) return false;
    if (filters.concentration.length && !filters.concentration.includes(p.concentration)) return false;
    if (filters.inStock && p.availability === 'outOfStock') return false;
    // Фильтр по цене — по минимальной цене товара
    if (p.price < min || p.price > max) return false;
    return true;
  });
}

export function sortProducts(products, sort) {
  const list = [...products];
  switch (sort) {
    case 'priceAsc':
      return list.sort((a, b) => a.price - b.price);
    case 'priceDesc':
      return list.sort((a, b) => b.price - a.price);
    case 'nameAsc':
      return list.sort((a, b) => a.name.localeCompare(b.name));
    case 'rating':
      return list.sort((a, b) => b.rating - a.rating);
    case 'new':
      return list.sort((a, b) => Number(b.isNew) - Number(a.isNew) || b.popularity - a.popularity);
    case 'popular':
    default:
      return list.sort((a, b) => b.popularity - a.popularity);
  }
}

/** Количество активных фильтров (для бейджа «Фильтры (3)») */
export function countActiveFilters(filters) {
  return (
    filters.category.length +
    filters.brand.length +
    filters.family.length +
    filters.concentration.length +
    (filters.minPrice !== '' ? 1 : 0) +
    (filters.maxPrice !== '' ? 1 : 0) +
    (filters.inStock ? 1 : 0)
  );
}
