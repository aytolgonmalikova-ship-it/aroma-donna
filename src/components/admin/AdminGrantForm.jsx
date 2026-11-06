import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import FormField from '../common/FormField';
import Icon from '../common/Icon';
import { validateGrantInput } from '../../utils/adminAdmins';

const ERROR_KEYS = {
  uid: { required: 'admin.admins.uid.required', invalid: 'admin.admins.uid.invalid' },
  label: { invalid: 'admin.admins.errors.invalid-label' },
};

/**
 * Форма «Добавить администратора» (крупный блок 1): UID пользователя и необязательная подпись.
 * Формат проверяется до отправки (validateGrantInput); назначение — только по UID, не по e-mail.
 * onGrant({ uid, label }) выполняет родитель и возвращает true при успехе — тогда поля очищаются.
 * Ошибки сервиса (пользователь не найден, уже администратор…) показывает родитель.
 */
export default function AdminGrantForm({ onGrant, disabled = false }) {
  const { t } = useTranslation();
  const [uid, setUid] = useState('');
  const [label, setLabel] = useState('');
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const busy = submitting || disabled;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    const { errors: found, value } = validateGrantInput({ uid, label });
    setErrors(found);
    if (Object.keys(found).length) return;
    setSubmitting(true);
    try {
      if (await onGrant(value)) {
        setUid('');
        setLabel('');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="admin-panel card admin-grant" aria-labelledby="admin-grant-title">
      <h2 id="admin-grant-title">{t('admin.admins.grant.title')}</h2>
      <p className="admin-grant__text">{t('admin.admins.grant.text')}</p>
      <form className="form admin-grant__form" onSubmit={handleSubmit} noValidate autoComplete="off">
        <FormField
          id="admin-grant-uid"
          label={t('admin.admins.uid.fieldLabel')}
          hint={t('admin.admins.uid.hint')}
          error={errors.uid ? ERROR_KEYS.uid[errors.uid] : undefined}
          value={uid}
          onChange={(e) => setUid(e.target.value)}
          placeholder={t('admin.admins.uid.placeholder')}
          maxLength={200}
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          disabled={busy}
          required
        />
        <FormField
          id="admin-grant-label"
          label={t('admin.admins.grant.labelLabel')}
          hint={t('admin.admins.grant.labelHint')}
          error={errors.label ? ERROR_KEYS.label[errors.label] : undefined}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={200}
          disabled={busy}
        />
        <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={submitting || undefined}>
          <Icon name="plus" size={16} /> {submitting ? t('admin.admins.grant.submitting') : t('admin.admins.grant.submit')}
        </button>
      </form>
    </section>
  );
}
