import { useTranslation } from 'react-i18next';
import Icon from '../common/Icon';

/** Счётчик количества «− 2 +». Используется на странице товара и в корзине */
export default function QuantitySelector({ value, onDecrease, onIncrease, min = 1, max = 10, size = 'md', label }) {
  const { t } = useTranslation();
  return (
    <div className={`qty qty--${size}`} role="group" aria-label={label || t('cart.quantity')}>
      <button type="button" onClick={onDecrease} disabled={value <= min} aria-label={t('cart.decrease')}>
        <Icon name="minus" size={16} />
      </button>
      <span className="qty__value" aria-live="polite">
        {value}
      </span>
      <button type="button" onClick={onIncrease} disabled={value >= max} aria-label={t('cart.increase')}>
        <Icon name="plus" size={16} />
      </button>
    </div>
  );
}
