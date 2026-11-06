import { useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import PageHeader from '../components/common/PageHeader';
import ProductFilters from '../components/products/ProductFilters';
import ProductSort from '../components/products/ProductSort';
import ProductGrid from '../components/products/ProductGrid';
import LoadingSpinner from '../components/common/LoadingSpinner';
import ErrorMessage from '../components/common/ErrorMessage';
import EmptyState from '../components/common/EmptyState';
import Icon from '../components/common/Icon';
import { fetchProducts, selectProducts, selectProductsStatus } from '../features/products/productsSlice';
import { useCatalogFilters } from '../hooks/useCatalogFilters';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { countActiveFilters, filterProducts, sortProducts } from '../utils/filterProducts';

/**
 * Каталог: поиск, фильтры, сортировка, счётчик найденных товаров.
 * useMemo пересчитывает список только когда изменились товары или фильтры.
 */
export default function CatalogPage() {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const products = useSelector(selectProducts);
  const status = useSelector(selectProductsStatus);
  const { filters, setFilter, updateFilters, toggleListValue, resetFilters } = useCatalogFilters();
  const [filtersOpen, setFiltersOpen] = useState(false);
  useDocumentTitle(t('catalog.title'));

  const visible = useMemo(
    () => sortProducts(filterProducts(products, filters), filters.sort),
    [products, filters],
  );
  const activeCount = countActiveFilters(filters);

  return (
    <>
      <PageHeader title={t('catalog.title')} subtitle={t('catalog.subtitle')} crumbs={[{ label: t('nav.catalog') }]} />
      <div className="container catalog">
        <ProductFilters
          products={products}
          filters={filters}
          onToggle={toggleListValue}
          onSet={updateFilters}
          onReset={resetFilters}
          open={filtersOpen}
          onClose={() => setFiltersOpen(false)}
          id="catalog-filters"
        />
        {filtersOpen && <div className="filters__backdrop" onClick={() => setFiltersOpen(false)} aria-hidden="true" />}

        <section className="catalog__main" aria-label={t('catalog.results')}>
          <div className="catalog__toolbar">
            <button
              type="button"
              className="btn btn--outline catalog__filters-btn"
              onClick={() => setFiltersOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={filtersOpen}
              aria-controls="catalog-filters"
            >
              <Icon name="filter" size={18} /> {t('filters.title')}
              {activeCount > 0 && <span className="filter-group__count">{activeCount}</span>}
            </button>
            <p className="catalog__count" aria-live="polite">
              {status === 'succeeded' && t('catalog.found', { count: visible.length })}
            </p>
            <ProductSort value={filters.sort} onChange={(v) => setFilter('sort', v)} />
          </div>

          {filters.q && (
            <div className="catalog__query">
              {t('catalog.searchFor')}: <strong>«{filters.q}»</strong>
              <button type="button" className="chip chip--removable" onClick={() => setFilter('q', '')}>
                {t('catalog.clearSearch')} <Icon name="close" size={14} />
              </button>
            </div>
          )}

          {(status === 'loading' || status === 'idle') && <LoadingSpinner />}
          {status === 'failed' && <ErrorMessage message={t('catalog.loadError')} onRetry={() => dispatch(fetchProducts())} />}
          {status === 'succeeded' &&
            (visible.length > 0 ? (
              <ProductGrid products={visible} columns={3} />
            ) : (
              <EmptyState
                icon="search"
                title={t('catalog.notFoundTitle')}
                text={t('catalog.notFoundText')}
                actionLabel={t('filters.reset')}
                onAction={resetFilters}
              />
            ))}
        </section>
      </div>
    </>
  );
}
