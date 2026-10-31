import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

/** Страница 404 — для любого несуществующего адреса (маршрут path="*") */
export default function NotFoundPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('notFound.title'));
  return (
    <div className="container not-found">
      <p className="not-found__code" aria-hidden="true">404</p>
      <h1>{t('notFound.title')}</h1>
      <p>{t('notFound.text')}</p>
      <div className="not-found__actions">
        <Link to="/" className="btn btn--primary">
          {t('nav.home')}
        </Link>
        <Link to="/catalog" className="btn btn--outline">
          {t('nav.catalog')}
        </Link>
      </div>
    </div>
  );
}
