import { useTranslation } from 'react-i18next';
import FilterGroup from './FilterGroup';
import BrandFilter from './BrandFilter';
import FragranceFamilyFilter from './FragranceFamilyFilter';
import PriceFilter from './PriceFilter';
import Icon from '../common/Icon';
import { CATEGORIES, CONCENTRATIONS } from '../../data/products';
import { countActiveFilters } from '../../utils/filterProducts';

/**
 * Панель фильтров каталога. На мобильных открывается поверх страницы (open/onClose).
 * Само состояние фильтров живёт в URL (хук useCatalogFilters), а сюда приходят
 * готовые значения и функции для их изменения.
 */
export default function ProductFilters({ products, filters, onToggle, onSet, onReset, open, onClose }) {
  const { t } = useTranslation();
  const active = countActiveFilters(filters);

  const categoryOptions = CATEGORIES.map((c) => ({
    value: c,
    label: t(`categories.${c}`),
    count: products.filter((p) => p.category === c).length,
  }));
  const concentrationOptions = CONCENTRATIONS.map((c) => ({
    value: c,
    label: t(`concentration.${c}`),
    count: products.filter((p) => p.concentration === c).length,
  }));

  return (
    <aside className={`filters ${open ? 'is-open' : ''}`} aria-label={t('filters.title')}>
      <div className="filters__head">
        <h2 className="filters__title">
          <Icon name="filter" size={18} /> {t('filters.title')}
          {active > 0 && <span className="filter-group__count">{active}</span>}
        </h2>
        <button type="button" className="icon-btn filters__close" onClick={onClose} aria-label={t('common.close')}>
          <Icon name="close" />
        </button>
      </div>

      <FilterGroup
        title={t('filters.category')}
        options={categoryOptions}
        selected={filters.category}
        onToggle={(v) => onToggle('category', v)}
      />
      <FragranceFamilyFilter products={products} selected={filters.family} onToggle={(v) => onToggle('family', v)} />
      <BrandFilter products={products} selected={filters.brand} onToggle={(v) => onToggle('brand', v)} />
      <FilterGroup
        title={t('filters.concentration')}
        options={concentrationOptions}
        selected={filters.concentration}
        onToggle={(v) => onToggle('concentration', v)}
        defaultOpen={false}
      />
      <PriceFilter
        minPrice={filters.minPrice}
        maxPrice={filters.maxPrice}
        onApply={(min, max) => onSet({ minPrice: min, maxPrice: max })}
      />
      <label className="checkbox checkbox--switch">
        <input type="checkbox" checked={filters.inStock} onChange={(e) => onSet({ inStock: e.target.checked })} />
        <span className="checkbox__box" aria-hidden="true" />
        <span className="checkbox__label">{t('filters.inStockOnly')}</span>
      </label>

      <div className="filters__actions">
        <button type="button" className="btn btn--ghost btn--block" onClick={onReset} disabled={active === 0 && !filters.q}>
          {t('filters.reset')}
        </button>
        <button type="button" className="btn btn--primary btn--block filters__show" onClick={onClose}>
          {t('filters.show')}
        </button>
      </div>
    </aside>
  );
}
