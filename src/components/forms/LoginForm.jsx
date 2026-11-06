import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import FormField from '../common/FormField';
import LoadingSpinner from '../common/LoadingSpinner';
import { clearAuthError, loginUser, selectAuthState } from '../../features/user/userSlice';
import { notify } from '../../features/notifications/notificationsSlice';
import { hasErrors, validateLogin } from '../../utils/validation';

/** Форма входа с проверкой полей и показом ошибок сервера/демо-режима */
export default function LoginForm() {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const { status, error } = useSelector(selectAuthState);
  const [values, setValues] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const loading = status === 'loading';

  // Сбрасываем старую ошибку при открытии формы
  useEffect(() => {
    dispatch(clearAuthError());
  }, [dispatch]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setValues((v) => ({ ...v, [name]: value }));
    if (errors[name]) setErrors((er) => ({ ...er, [name]: undefined }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return; // защита от двойной отправки
    const found = validateLogin(values);
    setErrors(found);
    if (hasErrors(found)) return;
    const result = await dispatch(loginUser(values));
    if (loginUser.fulfilled.match(result)) {
      dispatch(notify({ message: 'notify.loggedIn', params: { name: result.payload.name } }));
      navigate(location.state?.from || '/account', { replace: true });
    }
  };

  return (
    <form className="form" onSubmit={handleSubmit} noValidate>
      {error && (
        <p className="form__error" role="alert">
          {t(error)}
        </p>
      )}
      <FormField
        id="login-email"
        name="email"
        type="email"
        label={t('form.email')}
        autoComplete="email"
        value={values.email}
        onChange={handleChange}
        error={errors.email}
        required
      />
      <FormField id="login-password" label={t('form.password')} error={errors.password} required>
        <div className="password-input">
          <input
            id="login-password"
            name="password"
            className="field__control"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            value={values.password}
            onChange={handleChange}
            aria-invalid={Boolean(errors.password)}
            aria-describedby={errors.password ? 'login-password-error' : undefined}
          />
          <button type="button" className="password-input__toggle" onClick={() => setShowPassword((v) => !v)}>
            {showPassword ? t('form.hide') : t('form.show')}
          </button>
        </div>
      </FormField>
      {/* Восстановление пароля (Блок 2): введённый e-mail переносится в форму */}
      <p className="form__forgot">
        <Link to="/forgot-password" state={{ email: values.email }}>
          {t('auth.reset.link')}
        </Link>
      </p>
      <button type="submit" className="btn btn--primary btn--lg btn--block" disabled={loading}>
        {loading ? <LoadingSpinner size="sm" /> : null}
        {t('auth.loginButton')}
      </button>
      <p className="form__switch">
        {t('auth.noAccount')} <Link to="/register">{t('auth.registerLink')}</Link>
      </p>
    </form>
  );
}
