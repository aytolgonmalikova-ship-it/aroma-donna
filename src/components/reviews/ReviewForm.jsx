import { useState } from 'react';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import FormField from '../common/FormField';
import LoadingSpinner from '../common/LoadingSpinner';
import ErrorMessage from '../common/ErrorMessage';
import StarRatingInput from './StarRatingInput';
import { notify } from '../../features/notifications/notificationsSlice';
import { hasErrors, REVIEW_LIMITS, validateReview } from '../../utils/validation';
import { addReview } from '../../services/reviewsService';

const EMPTY = { name: '', rating: 0, text: '' };

/**
 * Форма отзыва: имя, оценка 1–5, текст.
 * Отзыв сохраняется в Firestore. «Спасибо» показывается только после того,
 * как Firestore подтвердил запись; при ошибке введённый текст не теряется.
 */
export default function ReviewForm({ onCreated }) {
  const { t, i18n } = useTranslation();
  const dispatch = useDispatch();
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState('idle'); // idle | sending | success | error
  const [errorCode, setErrorCode] = useState(null);

  const update = (name, value) => {
    setValues((v) => ({ ...v, [name]: value }));
    if (errors[name]) setErrors((er) => ({ ...er, [name]: undefined }));
    if (status === 'success' || status === 'error') setStatus('idle');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (status === 'sending') return;
    const found = validateReview(values);
    setErrors(found);
    if (hasErrors(found)) return;
    setStatus('sending');
    setErrorCode(null);
    try {
      const saved = await addReview(values, i18n.language);
      setValues(EMPTY);
      setStatus('success');
      dispatch(notify({ type: 'success', message: 'reviews.sentToast' }));
      onCreated?.(saved);
    } catch (err) {
      if (err.code !== 'cooldown') console.error('[reviews] Не удалось сохранить отзыв:', err.cause || err);
      setErrorCode(err.code || 'failed');
      setStatus('error');
    }
  };

  const sending = status === 'sending';

  return (
    <form className="form review-form" onSubmit={handleSubmit} noValidate aria-busy={sending}>
      <FormField
        id="r-name"
        name="name"
        label={t('reviews.name')}
        autoComplete="given-name"
        value={values.name}
        onChange={(e) => update('name', e.target.value)}
        error={errors.name}
        maxLength={REVIEW_LIMITS.nameMax}
        hint={t('reviews.nameHint')}
        required
      />
      <StarRatingInput name="rating" label={t('reviews.rating')} value={values.rating} onChange={(n) => update('rating', n)} error={errors.rating} />
      <FormField
        id="r-text"
        name="text"
        as="textarea"
        rows={5}
        label={t('reviews.text')}
        value={values.text}
        onChange={(e) => update('text', e.target.value)}
        error={errors.text}
        maxLength={REVIEW_LIMITS.textMax}
        hint={t('reviews.textHint', { count: values.text.trim().length, max: REVIEW_LIMITS.textMax })}
        required
      />
      {status === 'error' && <ErrorMessage message={t(`reviews.errors.${errorCode}`)} />}
      {status === 'success' && (
        <p className="review-form__success" role="status">
          {t('reviews.thanks')}
        </p>
      )}
      <button type="submit" className="btn btn--primary btn--lg" disabled={sending}>
        {sending && <LoadingSpinner size="sm" label={t('reviews.sending')} />}
        {sending ? t('reviews.sending') : t('reviews.submit')}
      </button>
      <p className="form__note">{t('reviews.publicNote')}</p>
    </form>
  );
}
