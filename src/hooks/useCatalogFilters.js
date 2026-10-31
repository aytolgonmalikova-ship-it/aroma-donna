import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DEFAULT_FILTERS, SORT_OPTIONS } from '../utils/filterProducts';

/**
 * Фильтры каталога хранятся в адресной строке (?q=rose&family=floral&sort=priceAsc).
 * Плюсы: ссылку с фильтрами можно отправить другу, кнопка «Назад» в браузере работает,
 * а поиск из шапки просто переходит на /catalog?q=...
 */

const LIST_KEYS = ['category', 'brand', 'family', 'concentration'];

export function useCatalogFilters() {
  const [params, setParams] = useSearchParams();

  const filters = useMemo(() => {
    const sort = params.get('sort');
    return {
      q: params.get('q') || '',
      category: params.getAll('category'),
      brand: params.getAll('brand'),
      family: params.getAll('family'),
      concentration: params.getAll('concentration'),
      minPrice: params.get('minPrice') || '',
      maxPrice: params.get('maxPrice') || '',
      inStock: params.get('inStock') === '1',
      sort: SORT_OPTIONS.includes(sort) ? sort : DEFAULT_FILTERS.sort,
    };
  }, [params]);

  const writeParams = useCallback(
    (next) => {
      const p = new URLSearchParams();
      if (next.q) p.set('q', next.q);
      LIST_KEYS.forEach((key) => next[key].forEach((v) => p.append(key, v)));
      if (next.minPrice !== '') p.set('minPrice', next.minPrice);
      if (next.maxPrice !== '') p.set('maxPrice', next.maxPrice);
      if (next.inStock) p.set('inStock', '1');
      if (next.sort !== DEFAULT_FILTERS.sort) p.set('sort', next.sort);
      setParams(p, { replace: true });
    },
    [setParams],
  );

  const setFilter = useCallback((key, value) => writeParams({ ...filters, [key]: value }), [filters, writeParams]);

  /** Изменить сразу несколько фильтров: updateFilters({ minPrice: '3000', maxPrice: '6000' }) */
  const updateFilters = useCallback((partial) => writeParams({ ...filters, ...partial }), [filters, writeParams]);

  /** Включить/выключить значение в списке (чекбоксы) */
  const toggleListValue = useCallback(
    (key, value) => {
      const list = filters[key];
      const next = list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
      writeParams({ ...filters, [key]: next });
    },
    [filters, writeParams],
  );

  const resetFilters = useCallback(
    () => writeParams({ ...DEFAULT_FILTERS, q: '', sort: filters.sort }),
    [filters.sort, writeParams],
  );

  return { filters, setFilter, updateFilters, toggleListValue, resetFilters };
}
