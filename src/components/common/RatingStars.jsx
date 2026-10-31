import { useTranslation } from 'react-i18next';
import Icon from './Icon';

/** Звёзды рейтинга (демонстрационное значение из каталога) */
export default function RatingStars({ value, showValue = true }) {
  const { t } = useTranslation();
  const rounded = Math.round(value);
  return (
    <span className="rating" aria-label={t('product.ratingLabel', { value })}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Icon key={n} name="star" size={14} filled={n <= rounded} className={n <= rounded ? 'rating__on' : 'rating__off'} />
      ))}
      {showValue && <span className="rating__value">{value.toFixed(1)}</span>}
    </span>
  );
}
