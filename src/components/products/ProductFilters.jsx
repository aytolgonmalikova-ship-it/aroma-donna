import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import FilterGroup from './FilterGroup';
import BrandFilter from './BrandFilter';
import FragranceFamilyFilter from './FragranceFamilyFilter';
import PriceFilter from './PriceFilter';
import Icon from '../common/Icon';
import { CATEGORIES, CONCENTRATIONS } from '../../data/products';
import { countActiveFilters } from '../../utils/filterProducts';
import { useMediaQuery } from '../../hooks/useMediaQuery';

/** Ширина, на которой панель — выезжающее окно (тот же @media, что у .filters в pages.css) */
export const FILTERS_DRAWER_QUERY = '(max-width: 959px)';
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/**
 * Панель фильтров каталога. На мобильных открывается поверх страницы (open/onClose).
 * Само состояние фильтров живёт в URL (хук useCatalogFilters), а сюда приходят
 * готовые значения и функции для их изменения.
 *
 * До 959px панель — модальное окно (role="dialog", aria-modal): закрытая недоступна клавиатуре
 * и экранному диктору (inert, aria-hidden); при открытии фокус — на «Закрыть», Tab и Shift+Tab
 * не выходят из окна, Escape закрывает, после закрытия фокус возвращается на кнопку «Фильтры».
 * Шире 959px — обычная боковая колонка, как раньше.
 */
export default function ProductFilters({ products, filters, onToggle, onSet, onReset, open, onClose, id }) {
  const { t } = useTranslation();
  const active = countActiveFilters(filters);
  const isDrawer = useMediaQuery(FILTERS_DRAWER_QUERY);
  const modal = isDrawer && open;
  const panelRef = useRef(null);
  // onClose родителя меняется при каждой отрисовке — окно не должно из-за этого заново ставить фокус
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Окно открыто: фокус внутрь, прокрутка страницы под ним заблокирована, Escape и Tab — внутри окна
  useEffect(() => {
    if (!modal) return undefined;
    // Куда вернуть фокус: туда, откуда открыли; если неизвестно (Safari не ставит фокус на кнопку при нажатии
    // мышью) — на кнопку, которая управляет панелью (aria-controls)
    const active = document.activeElement;
    const opener =
      active instanceof HTMLElement && active !== document.body ? active : id ? document.querySelector(`[aria-controls="${id}"]`) : null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.querySelector('.filters__close')?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const items = [...panelRef.current.querySelectorAll(FOCUSABLE)];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const outside = !panelRef.current.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === first || outside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || outside)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [modal, id]);

  // Окно стало шире 959px, пока панель открыта, — закрыть: на компьютере панель всегда на месте
  useEffect(() => {
    if (!isDrawer && open) onCloseRef.current();
  }, [isDrawer, open]);

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
    <aside
      ref={panelRef}
      id={id}
      className={`filters ${open ? 'is-open' : ''}`}
      aria-label={t('filters.title')}
      role={modal ? 'dialog' : undefined}
      aria-modal={modal ? 'true' : undefined}
      aria-hidden={isDrawer && !open ? 'true' : undefined}
      inert={isDrawer && !open ? true : undefined}
    >
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
