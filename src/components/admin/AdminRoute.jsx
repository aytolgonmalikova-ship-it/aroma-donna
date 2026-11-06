import { Link, Navigate, useLocation } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { selectAuthState } from '../../features/user/userSlice';
import { useAdminAccess } from '../../hooks/useAdminAccess';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import LoadingSpinner from '../common/LoadingSpinner';
import ErrorMessage from '../common/ErrorMessage';
import DemoNotice from '../common/DemoNotice';
import Icon from '../common/Icon';

/** Экран-заглушка вместо админ-панели: нет доступа, демо-режим или ошибка */
function AdminGate({ icon, title, children }) {
  const { t } = useTranslation();
  useDocumentTitle(t('admin.title'));
  return (
    <div className="admin-gate">
      <div className="admin-gate__card card">
        <span className="admin-gate__icon">
          <Icon name={icon} size={32} />
        </span>
        <h1>{title}</h1>
        {children}
        <Link to="/" className="btn btn--outline">
          <Icon name="arrowLeft" size={18} /> {t('admin.backToShop')}
        </Link>
      </div>
    </div>
  );
}

/**
 * Защищённый маршрут админ-панели: пускает только пользователей с документом admins/{uid}.
 * Это удобство интерфейса. Настоящая защита данных — функция isAdmin() в firestore.rules.
 */
export default function AdminRoute({ children }) {
  const { t } = useTranslation();
  const { current, initialized } = useSelector(selectAuthState);
  const { status, retry } = useAdminAccess(current);
  const location = useLocation();

  if (status === 'unavailable') {
    return (
      <AdminGate icon="shield" title={t('admin.unavailableTitle')}>
        <DemoNotice variant="warning">{t('admin.unavailableText')}</DemoNotice>
      </AdminGate>
    );
  }
  if (!initialized) return <LoadingSpinner />;
  if (!current) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (status === 'loading') return <LoadingSpinner label={t('admin.checking')} />;
  if (status === 'error') {
    return (
      <AdminGate icon="alert" title={t('admin.title')}>
        <ErrorMessage message={t('admin.checkError')} onRetry={retry} />
      </AdminGate>
    );
  }
  if (status !== 'admin') {
    // UID вошедшего пользователя (из Firebase Auth) — его отправляют главному администратору,
    // чтобы получить доступ. Показывается только свой UID; выделяется одним нажатием для копирования.
    return (
      <AdminGate icon="shield" title={t('admin.deniedTitle')}>
        <p>{t('admin.deniedText', { email: current.email })}</p>
        {current.uid && (
          <div className="admin-gate__uid">
            <p className="admin-gate__uid-label" id="admin-gate-uid-label">
              {t('admin.deniedUidLabel')}
            </p>
            <code className="admin-gate__uid-value" aria-labelledby="admin-gate-uid-label">
              {current.uid}
            </code>
            <p className="admin-gate__uid-hint">{t('admin.deniedUidHint')}</p>
          </div>
        )}
      </AdminGate>
    );
  }
  return children;
}
