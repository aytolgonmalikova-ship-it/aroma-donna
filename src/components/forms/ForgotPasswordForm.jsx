import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import FormField from '../common/FormField';
import LoadingSpinner from '../common/LoadingSpinner';
import { requestPasswordReset, toErrorKey } from '../../services/authService';
import { validatePasswordReset } from '../../utils/validation';

/**
 * Форма «Забыли пароль?» (Блок 2): e-mail → письмо со ссылкой для смены пароля (Firebase sendPasswordResetEmail).
 * Состояния: ввод, отправка (кнопка заблокирована), отправлено (одинаковый ответ для любого адреса —
 * по форме нельзя узнать, зарегистрирован ли e-mail), ошибка (неверный адрес, сеть, слишком много попыток).
 * Меняется только пароль существующего аккаунта: UID, профиль и заказы не затрагиваются.
 */
export default function ForgotPasswordForm({ disabled = false }) {
  const { t } = useTranslation();
  const location = useLocation();
  const [email, setEmail] = useState(location.state?.email || '');
  const [fieldError, setFieldError] = useState();
  const [status, setStatus] = useState('idle'); // 'idle' | 'sending' | 'sent'
  const [error, setError] = useState(null);
  const [sentTo, setSentTo] = useState('');
  const sending = status === 'sending';

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (sending || disabled) return; // защита от двойной отправки
    const found = validatePasswordReset({ email });
    setFieldError(found.email);
    setError(null);
    if (found.email) return;
    setStatus('sending');
    try {
      const { email: sent } = await requestPasswordReset(email);
      setSentTo(sent);
      setStatus('sent');
    } catch (err) {
      setError(toErrorKey(err));
      setStatus('idle');
    }
  };

  if (status === 'sent') {
    return (
      <div className="reset-sent" role="status">
        <p className="reset-sent__title">{t('auth.reset.sentTitle')}</p>
        <p>{t('auth.reset.sentText', { email: sentTo })}</p>
        <p className="form__note">{t('auth.reset.sentHint')}</p>
        <div className="reset-sent__actions">
          <Link to="/login" className="btn btn--primary btn--block">
            {t('auth.reset.backToLogin')}
          </Link>
          <button type="button" className="btn btn--ghost btn--block" onClick={() => setStatus('idle')}>
            {t('auth.reset.again')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form className="form" onSubmit={handleSubmit} noValidate>
      {error && (
        <p className="form__error" role="alert">
          {t(error)}
        </p>
      )}
      <FormField
        id="reset-email"
        name="email"
        type="email"
        label={t('form.email')}
        autoComplete="email"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          if (fieldError) setFieldError(undefined);
        }}
        error={fieldError}
        disabled={sending || disabled}
        required
      />
      <button type="submit" className="btn btn--primary btn--lg btn--block" disabled={sending || disabled} aria-busy={sending || undefined}>
        {sending ? <LoadingSpinner size="sm" /> : null}
        {sending ? t('auth.reset.sending') : t('auth.reset.submit')}
      </button>
      <p className="form__switch">
        {t('auth.reset.remembered')} <Link to="/login">{t('auth.loginLink')}</Link>
      </p>
    </form>
  );
}
