import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../common/Icon';

/**
 * Выбор оценки 1–5 звёзд.
 * Внутри — обычные радиокнопки: работают клавиатура (стрелки), экранные дикторы и формы.
 */
export default function StarRatingInput({ name, value, onChange, error, label }) {
  const { t } = useTranslation();
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  const errorId = `${name}-error`;

  return (
    <fieldset className={`field star-input ${error ? 'field--error' : ''}`} aria-describedby={error ? errorId : undefined}>
      <legend className="field__label">
        {label}
        <span className="field__required" aria-hidden="true"> *</span>
      </legend>
      <div className="star-input__stars" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className={`star-input__star ${n <= shown ? 'is-on' : ''}`} onMouseEnter={() => setHover(n)}>
            <input
              type="radio"
              className="visually-hidden"
              name={name}
              value={n}
              checked={value === n}
              onChange={() => onChange(n)}
              aria-invalid={Boolean(error)}
            />
            <Icon name="star" size={30} filled={n <= shown} />
            <span className="visually-hidden">{t('reviews.stars', { count: n })}</span>
          </label>
        ))}
        {value > 0 && <span className="star-input__value">{t('reviews.stars', { count: value })}</span>}
      </div>
      {error && (
        <p id={errorId} className="field__error" role="alert">
          {t(error)}
        </p>
      )}
    </fieldset>
  );
}
