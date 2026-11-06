import { useLocation, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import LoadingSpinner from '../common/LoadingSpinner';
import { loginWithGoogleUser, selectAuthState } from '../../features/user/userSlice';
import { notify } from '../../features/notifications/notificationsSlice';

/** Многоцветный значок Google «G» (по правилам оформления кнопок Google) */
function GoogleLogo() {
  return (
    <svg className="google-btn__logo" width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/**
 * Кнопка «Продолжить с Google» для страниц входа и регистрации (Блок 2).
 * Вход и регистрация — одно действие: новый аккаунт Google получает профиль, существующий просто входит.
 * Ошибки показывает форма (общее поле error); отмену (закрыли окно Google) — не показывает.
 * Во время любого входа кнопка заблокирована (общий status), повторное окно не открывается.
 */
export default function GoogleSignInButton() {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const { status } = useSelector(selectAuthState);
  const loading = status === 'loading';

  const handleClick = async () => {
    if (loading) return;
    const result = await dispatch(loginWithGoogleUser());
    if (loginWithGoogleUser.fulfilled.match(result)) {
      dispatch(notify({ message: 'notify.loggedIn', params: { name: result.payload.name } }));
      navigate(location.state?.from || '/account', { replace: true });
    }
  };

  return (
    <div className="google-signin">
      <button type="button" className="btn btn--outline btn--lg btn--block google-btn" onClick={handleClick} disabled={loading} aria-busy={loading || undefined}>
        {loading ? <LoadingSpinner size="sm" /> : <GoogleLogo />}
        <span>{t('auth.google.continue')}</span>
      </button>
      <p className="google-signin__note">{t('auth.google.consent')}</p>
      <p className="google-signin__divider" role="separator">
        <span>{t('auth.google.or')}</span>
      </p>
    </div>
  );
}
