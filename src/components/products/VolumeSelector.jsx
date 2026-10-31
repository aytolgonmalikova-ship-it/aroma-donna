import { useTranslation } from 'react-i18next';
import { formatPrice } from '../../utils/format';

/** Выбор объёма флакона: 30 / 50 / 100 мл (у каждого своя цена) */
export default function VolumeSelector({ volumes, value, onChange }) {
  const { t } = useTranslation();
  return (
    <fieldset className="volume-selector">
      <legend>{t('product.volume')}</legend>
      <div className="volume-selector__options">
        {volumes.map((v) => (
          <label key={v.ml} className={`volume-option ${v.ml === value ? 'is-active' : ''}`}>
            <input
              type="radio"
              name="volume"
              value={v.ml}
              checked={v.ml === value}
              onChange={() => onChange(v.ml)}
            />
            <span className="volume-option__ml">
              {v.ml} {t('product.ml')}
            </span>
            <span className="volume-option__price">{formatPrice(v.price)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
