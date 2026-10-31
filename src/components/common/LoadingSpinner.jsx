import { useTranslation } from 'react-i18next';

/** Индикатор загрузки. size: 'sm' — внутри кнопки, 'lg' — на всю секцию */
export default function LoadingSpinner({ size = 'lg', label }) {
  const { t } = useTranslation();
  const text = label || t('common.loading');
  if (size === 'sm') {
    return <span className="spinner spinner--sm" role="status" aria-label={text} />;
  }
  return (
    <div className="loading" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <p>{text}</p>
    </div>
  );
}
