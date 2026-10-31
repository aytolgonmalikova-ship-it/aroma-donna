import { useTranslation } from 'react-i18next';
import FilterGroup from './FilterGroup';

/** Фильтр по бренду (список брендов строится из товаров каталога) */
export default function BrandFilter({ products, selected, onToggle }) {
  const { t } = useTranslation();
  const brands = [...new Set(products.map((p) => p.brand))].sort();
  const options = brands.map((brand) => ({
    value: brand,
    label: brand,
    count: products.filter((p) => p.brand === brand).length,
  }));
  return <FilterGroup title={t('filters.brand')} options={options} selected={selected} onToggle={onToggle} />;
}
