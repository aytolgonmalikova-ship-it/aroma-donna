import { Navigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import LoginForm from '../components/forms/LoginForm';
import RegisterForm from '../components/forms/RegisterForm';
import DemoNotice from '../components/common/DemoNotice';
import Breadcrumbs from '../components/common/Breadcrumbs';
import { selectAuthState } from '../features/user/userSlice';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

/** Страница входа (mode="login") и регистрации (mode="register") */
export default function AuthPage({ mode }) {
  const { t } = useTranslation();
  const { current, mode: authMode } = useSelector(selectAuthState);
  const isLogin = mode === 'login';
  useDocumentTitle(isLogin ? t('auth.loginTitle') : t('auth.registerTitle'));

  // Уже вошли — сразу в личный кабинет
  if (current) return <Navigate to="/account" replace />;

  return (
    <div className="container auth-page">
      <Breadcrumbs items={[{ label: isLogin ? t('auth.loginTitle') : t('auth.registerTitle') }]} />
      <div className="auth-card card">
        <h1 className="auth-card__title">{isLogin ? t('auth.loginTitle') : t('auth.registerTitle')}</h1>
        <p className="auth-card__subtitle">{isLogin ? t('auth.loginSubtitle') : t('auth.registerSubtitle')}</p>
        {authMode === 'demo' && (
          <DemoNotice variant="warning">
            <strong>{t('auth.demoTitle')}</strong> {isLogin ? t('auth.demoLogin') : t('auth.demoRegister')}
          </DemoNotice>
        )}
        {isLogin ? <LoginForm /> : <RegisterForm />}
      </div>
    </div>
  );
}
