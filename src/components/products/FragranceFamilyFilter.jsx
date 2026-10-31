import { useTranslation } from 'react-i18next';
import FilterGroup from './FilterGroup';
import { FAMILIES } from '../../data/products';

/** Фильтр по семейству ароматов: цветочные, древесные, восточные и т.д. */
export default function FragranceFamilyFilter({ products, selected, onToggle }) {
  const { t } = useTranslation();
  const options = FAMILIES.map((family) => ({
    value: family,
    label: t(`families.${family}`),
    count: products.filter((p) => p.fragranceFamily === family).length,
  })).filter((o) => o.count > 0);
  return <FilterGroup title={t('filters.family')} options={options} selected={selected} onToggle={onToggle} />;
}
