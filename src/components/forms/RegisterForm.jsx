import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import FormField from '../common/FormField';
import LoadingSpinner from '../common/LoadingSpinner';
import { clearAuthError, registerUser, selectAuthState } from '../../features/user/userSlice';
import { notify } from '../../features/notifications/notificationsSlice';
import { hasErrors, validateRegister } from '../../utils/validation';

/** Форма регистрации: имя, e-mail, пароль, подтверждение, согласие */
export default function RegisterForm() {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { status, error } = useSelector(selectAuthState);
  const [values, setValues] = useState({ name: '', email: '', password: '', confirmPassword: '', agree: false });
  const [errors, setErrors] = useState({});
  const loading = status === 'loading';

  useEffect(() => {
    dispatch(clearAuthError());
  }, [dispatch]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setValues((v) => ({ ...v, [name]: type === 'checkbox' ? checked : value }));
    if (errors[name]) setErrors((er) => ({ ...er, [name]: undefined }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;
    const found = validateRegister(values);
    setErrors(found);
    if (hasErrors(found)) return;
    const result = await dispatch(registerUser(values));
    if (registerUser.fulfilled.match(result)) {
      dispatch(notify({ message: 'notify.registered', params: { name: result.payload.name } }));
      navigate('/account', { replace: true });
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
        id="reg-name"
        name="name"
        label={t('form.name')}
        autoComplete="name"
        value={values.name}
        onChange={handleChange}
        error={errors.name}
        required
      />
      <FormField
        id="reg-email"
        name="email"
        type="email"
        label={t('form.email')}
        autoComplete="email"
        value={values.email}
        onChange={handleChange}
        error={errors.email}
        required
      />
      <FormField
        id="reg-password"
        name="password"
        type="password"
        label={t('form.password')}
        autoComplete="new-password"
        hint={t('form.passwordHint')}
        value={values.password}
        onChange={handleChange}
        error={errors.password}
        required
      />
      <FormField
        id="reg-confirm"
        name="confirmPassword"
        type="password"
        label={t('form.confirmPassword')}
        autoComplete="new-password"
        value={values.confirmPassword}
        onChange={handleChange}
        error={errors.confirmPassword}
        required
      />
      <label className={`checkbox ${errors.agree ? 'checkbox--error' : ''}`}>
        <input type="checkbox" name="agree" checked={values.agree} onChange={handleChange} />
        <span className="checkbox__box" aria-hidden="true" />
        <span className="checkbox__label">{t('form.agree')}</span>
      </label>
      {errors.agree && (
        <p className="field__error" role="alert">
          {t(errors.agree)}
        </p>
      )}
      <button type="submit" className="btn btn--primary btn--lg btn--block" disabled={loading}>
        {loading ? <LoadingSpinner size="sm" /> : null}
        {t('auth.registerButton')}
      </button>
      <p className="form__switch">
        {t('auth.haveAccount')} <Link to="/login">{t('auth.loginLink')}</Link>
      </p>
    </form>
  );
}
