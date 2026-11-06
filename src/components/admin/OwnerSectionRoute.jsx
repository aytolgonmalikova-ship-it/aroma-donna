import { useTranslation } from 'react-i18next';
import EmptyState from '../common/EmptyState';
import ErrorMessage from '../common/ErrorMessage';
import LoadingSpinner from '../common/LoadingSpinner';
import { useOwnerAccess } from '../../hooks/useOwnerAccess';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';

/**
 * Доступ к разделу управления администраторами (Блок 2) — внутри AdminRoute (вход и admins/{uid} уже проверены).
 * Пускает главного администратора и кандидата, которому предложена роль (он видит только своё предложение).
 * Обычному администратору страница не открывается — даже по прямой ссылке: сообщение вместо страницы,
 * сервис списка не вызывается. Роль — из useOwnerAccess (fetchOwnerStatus); защиту данных дают правила Firestore.
 */
export default function OwnerSectionRoute({ children }) {
  const { t } = useTranslation();
  const { access, refresh } = useOwnerAccess();
  useDocumentTitle(`${t('admin.nav.admins')} — ${t('admin.title')}`);

  if (access === 'owner' || access === 'pending') return children;
  if (access === 'loading') return <LoadingSpinner label={t('admin.admins.loading')} />;
  if (access === 'error') return <ErrorMessage message={t('admin.admins.errors.failed')} onRetry={refresh} />;
  return (
    <div className="admin-admins">
      <div className="admin-page__head">
        <h1>{t('admin.nav.admins')}</h1>
      </div>
      <EmptyState icon="shield" title={t('admin.admins.access.ownerOnlyTitle')} text={t('admin.admins.access.ownerOnlyText')} />
    </div>
  );
}
