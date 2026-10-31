import { useTranslation } from 'react-i18next';
import Icon from './Icon';

/** Сообщение об ошибке с необязательной кнопкой «Повторить» */
export default function ErrorMessage({ message, onRetry }) {
  const { t } = useTranslation();
  return (
    <div className="error-message" role="alert">
      <Icon name="alert" size={22} />
      <p>{message || t('common.error')}</p>
      {onRetry && (
        <button type="button" className="btn btn--outline btn--sm" onClick={onRetry}>
          <Icon name="refresh" size={16} /> {t('common.retry')}
        </button>
      )}
    </div>
  );
}
