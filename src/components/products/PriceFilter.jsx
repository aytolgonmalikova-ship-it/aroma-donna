import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { selectPriceLimits } from '../../features/products/productsSlice';

/**
 * Фильтр по цене «от — до».
 * Значения применяются по кнопке «Применить» или Enter, чтобы список
 * не перестраивался на каждую введённую цифру.
 * Подсказки «от / до» — диапазон цен загруженного каталога.
 */
export default function PriceFilter({ minPrice, maxPrice, onApply }) {
  const { t } = useTranslation();
  const [min, setMin] = useState(minPrice);
  const [max, setMax] = useState(maxPrice);
  const [error, setError] = useState('');
  const limits = useSelector(selectPriceLimits);

  // Синхронизация, если фильтры сброшены снаружи
  useEffect(() => {
    setMin(minPrice);
    setMax(maxPrice);
  }, [minPrice, maxPrice]);

  const apply = (event) => {
    event.preventDefault();
    if (min !== '' && max !== '' && Number(min) > Number(max)) {
      setError(t('filters.priceError'));
      return;
    }
    setError('');
    onApply(min === '' ? '' : String(Math.max(0, Number(min))), max === '' ? '' : String(Math.max(0, Number(max))));
  };

  return (
    <form className="filter-group price-filter" onSubmit={apply} noValidate>
      <p className="filter-group__title">{t('filters.price')}</p>
      <div className="price-filter__row">
        <label className="visually-hidden" htmlFor="price-min">{t('filters.priceFrom')}</label>
        <input
          id="price-min"
          type="number"
          inputMode="numeric"
          min="0"
          step="100"
          placeholder={limits ? `${t('filters.priceFrom')} ${limits.min}` : t('filters.priceFrom')}
          value={min}
          onChange={(e) => setMin(e.target.value)}
        />
        <span aria-hidden="true">—</span>
        <label className="visually-hidden" htmlFor="price-max">{t('filters.priceTo')}</label>
        <input
          id="price-max"
          type="number"
          inputMode="numeric"
          min="0"
          step="100"
          placeholder={limits ? `${t('filters.priceTo')} ${limits.max}` : t('filters.priceTo')}
          value={max}
          onChange={(e) => setMax(e.target.value)}
        />
      </div>
      {error && <p className="field__error" role="alert">{error}</p>}
      <button type="submit" className="btn btn--outline btn--sm btn--block">
        {t('filters.apply')}
      </button>
    </form>
  );
}
