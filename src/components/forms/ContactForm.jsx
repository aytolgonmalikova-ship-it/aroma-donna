import { useEffect, useRef, useState } from 'react';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import FormField from '../common/FormField';
import LoadingSpinner from '../common/LoadingSpinner';
import ErrorMessage from '../common/ErrorMessage';
import { notify } from '../../features/notifications/notificationsSlice';
import { CONTACT_LIMITS, CONTACT_TOPICS, hasErrors, validateContact } from '../../utils/validation';
import { sendContactMessage } from '../../services/contactService';

const EMPTY = { name: '', email: '', topic: 'question', message: '', hp: '' };

// Какую ошибку показать, если каналы вернули разные: важнее та, что подскажет пользователю, что делать
const ERROR_PRIORITY = ['validation', 'rate_limited', 'network', 'not_configured', 'failed'];

/**
 * Форма обратной связи.
 * Сообщение уходит на e-mail (EmailJS) и в Telegram (через /api/contact).
 * «Спасибо» показывается только если ОБА канала подтвердили доставку.
 * Если один канал не сработал, при повторной отправке уходит только он — без дублей.
 */
export default function ContactForm() {
  const { t, i18n } = useTranslation();
  const dispatch = useDispatch();
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState('idle'); // idle | sending | success | error
  const [errorCode, setErrorCode] = useState(null);
  const [delivered, setDelivered] = useState([]);
  const successRef = useRef(null);

  useEffect(() => {
    if (status === 'success') successRef.current?.focus();
  }, [status]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setValues((v) => ({ ...v, [name]: value }));
    if (errors[name]) setErrors((er) => ({ ...er, [name]: undefined }));
    // Текст изменился — это уже другое сообщение, отправляем его заново во все каналы
    if (delivered.length) setDelivered([]);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (status === 'sending') return;
    const found = validateContact(values);
    setErrors(found);
    if (hasErrors(found)) return;

    // Ловушка для ботов заполнена — ничего не отправляем
    if (values.hp) {
      setStatus('success');
      return;
    }

    setStatus('sending');
    setErrorCode(null);
    const topicLabel = i18n.getFixedT('ru')(`contacts.topics.${values.topic}`);
    const result = await sendContactMessage(values, { topicLabel, skip: delivered });
    const allDelivered = [...delivered, ...result.delivered];
    const failed = Object.values(result.errors);

    if (!failed.length) {
      setStatus('success');
      setValues(EMPTY);
      setDelivered([]);
      dispatch(notify({ type: 'success', message: 'contacts.sentToast' }));
      return;
    }

    const code = ERROR_PRIORITY.find((c) => failed.some((err) => err.code === c)) || 'failed';
    const serverFields = failed.find((err) => err.fields)?.fields;
    if (serverFields) setErrors(serverFields);
    setDelivered(allDelivered);
    setErrorCode(allDelivered.length ? 'partial' : code);
    setStatus('error');
  };

  if (status === 'success') {
    return (
      <div className="form-success" role="status">
        <h3 ref={successRef} tabIndex={-1}>
          {t('contacts.thanks')}
        </h3>
        <p>{t('contacts.successText')}</p>
        <button type="button" className="btn btn--outline" onClick={() => setStatus('idle')}>
          {t('contacts.sendAnother')}
        </button>
      </div>
    );
  }

  const sending = status === 'sending';

  return (
    <form className="form" onSubmit={handleSubmit} noValidate aria-busy={sending}>
      <div className="form__row">
        <FormField id="c-name" name="name" label={t('form.name')} autoComplete="name" value={values.name} onChange={handleChange} error={errors.name} maxLength={CONTACT_LIMITS.nameMax} required />
        <FormField id="c-email" name="email" type="email" label={t('form.email')} autoComplete="email" value={values.email} onChange={handleChange} error={errors.email} maxLength={CONTACT_LIMITS.emailMax} required />
      </div>
      <FormField id="c-topic" label={t('contacts.topic')} error={errors.topic}>
        <select id="c-topic" name="topic" className="field__control" value={values.topic} onChange={handleChange}>
          {CONTACT_TOPICS.map((topic) => (
            <option key={topic} value={topic}>
              {t(`contacts.topics.${topic}`)}
            </option>
          ))}
        </select>
      </FormField>
      <FormField
        id="c-message"
        name="message"
        as="textarea"
        rows={5}
        label={t('contacts.message')}
        value={values.message}
        onChange={handleChange}
        error={errors.message}
        maxLength={CONTACT_LIMITS.messageMax}
        required
      />
      {/* Поле-ловушка для спам-ботов: скрыто от людей и экранных дикторов */}
      <div className="contact-hp" aria-hidden="true">
        <label htmlFor="c-hp">{t('contacts.hp')}</label>
        <input id="c-hp" name="hp" type="text" tabIndex={-1} autoComplete="off" value={values.hp} onChange={handleChange} />
      </div>
      {status === 'error' && <ErrorMessage message={t(`contacts.errors.${errorCode}`)} />}
      <button type="submit" className="btn btn--primary btn--lg" disabled={sending}>
        {sending && <LoadingSpinner size="sm" label={t('contacts.sending')} />}
        {sending ? t('contacts.sending') : t('contacts.send')}
      </button>
      <p className="form__note">{t('contacts.privacyNote')}</p>
    </form>
  );
}
