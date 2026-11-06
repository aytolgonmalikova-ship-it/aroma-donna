import { Navigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import LoginForm from '../components/forms/LoginForm';
import RegisterForm from '../components/forms/RegisterForm';
import GoogleSignInButton from '../components/forms/GoogleSignInButton';
import DemoNotice from '../components/common/DemoNotice';
import Breadcrumbs from '../components/common/Breadcrumbs';
import { selectAuthState } from '../features/user/userSlice';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

/** Страница входа (mode="login") и регистрации (mode="register") */
export default function AuthPage({ mode }) {
  const { t } = useTranslation();
  const { current, status, mode: authMode } = useSelector(selectAuthState);
  const isLogin = mode === 'login';
  useDocumentTitle(isLogin ? t('auth.loginTitle') : t('auth.registerTitle'));

  // Уже вошли — сразу в личный кабинет. Но не во время входа или регистрации: Firebase сообщает о входе
  // раньше, чем сохранён профиль. Если профиль сохранить не удалось (вход через Google), пользователь
  // остаётся здесь и видит ошибку; при успехе в кабинет ведёт сама форма или кнопка Google.
  if (current && status !== 'loading') return <Navigate to="/account" replace />;

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
        {/* Вход через Google — только с Firebase (в демо-режиме его нет) */}
        {authMode === 'firebase' && <GoogleSignInButton />}
        {isLogin ? <LoginForm /> : <RegisterForm />}
      </div>
    </div>
  );
}
