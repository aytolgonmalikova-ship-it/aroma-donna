import { useTranslation } from 'react-i18next';

/**
 * Поле формы с подписью и сообщением об ошибке.
 * error — ключ перевода (например 'validation.email'), переводится здесь.
 * Атрибуты aria-invalid и aria-describedby помогают экранным дикторам.
 */
export default function FormField({ id, label, error, hint, as = 'input', children, required, ...inputProps }) {
  const { t } = useTranslation();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;
  const Control = as;

  return (
    <div className={`field ${error ? 'field--error' : ''}`}>
      <label htmlFor={id} className="field__label">
        {label}
        {required && <span className="field__required" aria-hidden="true"> *</span>}
      </label>
      {children || (
        <Control
          id={id}
          className="field__control"
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          aria-required={required || undefined}
          {...inputProps}
        />
      )}
      {hint && !error && (
        <p id={hintId} className="field__hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="field__error" role="alert">
          {t(error)}
        </p>
      )}
    </div>
  );
}
