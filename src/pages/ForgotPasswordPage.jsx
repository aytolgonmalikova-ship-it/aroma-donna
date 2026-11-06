import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import Breadcrumbs from '../components/common/Breadcrumbs';
import DemoNotice from '../components/common/DemoNotice';
import ForgotPasswordForm from '../components/forms/ForgotPasswordForm';
import { selectAuthState } from '../features/user/userSlice';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

/** Страница «Забыли пароль?» (Блок 2) — в том же оформлении, что вход и регистрация */
export default function ForgotPasswordPage() {
  const { t } = useTranslation();
  const { mode: authMode } = useSelector(selectAuthState);
  useDocumentTitle(t('auth.reset.title'));

  return (
    <div className="container auth-page">
      <Breadcrumbs items={[{ label: t('auth.loginTitle'), to: '/login' }, { label: t('auth.reset.title') }]} />
      <div className="auth-card card">
        <h1 className="auth-card__title">{t('auth.reset.title')}</h1>
        <p className="auth-card__subtitle">{t('auth.reset.subtitle')}</p>
        {authMode === 'demo' && <DemoNotice variant="warning">{t('auth.reset.unavailable')}</DemoNotice>}
        <ForgotPasswordForm disabled={authMode === 'demo'} />
      </div>
    </div>
  );
}
