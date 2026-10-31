import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import FormField from '../common/FormField';
import LoadingSpinner from '../common/LoadingSpinner';
import Icon from '../common/Icon';
import { hasErrors, validateCardPayment } from '../../utils/validation';

const EMPTY_CARD = { holder: '', number: '', expiry: '', cvv: '' };
const PROCESSING_MS = 1200; // имитация обработки платежа
const SUCCESS_MS = 1500; // сколько показываем сообщение об успехе перед оформлением заказа

// Маски ввода: «0000 0000 0000 0000» и «MM/YY»
const formatCardNumber = (v) => v.replace(/\D/g, '').slice(0, 16).replace(/(\d{4})(?=\d)/g, '$1 ');
const formatExpiry = (v) => {
  const d = v.replace(/\D/g, '').slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
};

/**
 * Модальное окно DEMO-оплаты банковской картой.
 * ВАЖНО: данные карты хранятся только в локальном состоянии этого компонента.
 * Они не передаются родителю, не сохраняются и не отправляются в Telegram, EmailJS или Firebase.
 * После успешной демо-оплаты вызывается onSuccess() — без аргументов.
 */
export default function DemoCardPaymentModal({ amountLabel, onSuccess, onCancel }) {
  const { t } = useTranslation();
  const [card, setCard] = useState(EMPTY_CARD);
  const [errors, setErrors] = useState({});
  const [stage, setStage] = useState('form'); // form → processing → success
  const firstFieldRef = useRef(null);
  const timerRef = useRef(null);

  // Фокус на первое поле, блокировка прокрутки страницы, очистка таймеров
  useEffect(() => {
    firstFieldRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
      clearTimeout(timerRef.current);
    };
  }, []);

  // Escape закрывает окно (кроме момента обработки платежа)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && stage === 'form') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [stage, onCancel]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    let next = value;
    if (name === 'number') next = formatCardNumber(value);
    if (name === 'expiry') next = formatExpiry(value);
    if (name === 'cvv') next = value.replace(/\D/g, '').slice(0, 3);
    setCard((c) => ({ ...c, [name]: next }));
    if (errors[name]) setErrors((er) => ({ ...er, [name]: undefined }));
  };

  const handleCancel = () => {
    setCard(EMPTY_CARD);
    onCancel();
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (stage !== 'form') return;
    const found = validateCardPayment(card);
    setErrors(found);
    if (hasErrors(found)) {
      document.getElementById(`card-${Object.keys(found)[0]}`)?.focus();
      return;
    }
    setStage('processing');
    timerRef.current = setTimeout(() => {
      setCard(EMPTY_CARD); // данные карты больше не нужны — стираем сразу
      setStage('success');
      timerRef.current = setTimeout(onSuccess, SUCCESS_MS);
    }, PROCESSING_MS);
  };

  return (
    <div className="payment-modal-overlay">
      <div className="payment-modal" role="dialog" aria-modal="true" aria-labelledby="payment-modal-title">
        {stage === 'success' ? (
          <div className="payment-modal__success" role="status">
            <span className="success__icon">
              <Icon name="check" size={32} strokeWidth={2.2} />
            </span>
            <h2 id="payment-modal-title">{t('payment.successTitle')}</h2>
            <p>{t('payment.successText', { amount: amountLabel })}</p>
            <p className="payment-modal__hint">
              <LoadingSpinner size="sm" /> {t('payment.placingOrder')}
            </p>
          </div>
        ) : (
          <form className="form payment-modal__form" onSubmit={handleSubmit} noValidate autoComplete="off">
            <h2 id="payment-modal-title" className="payment-modal__title">
              {t('payment.title')}
            </h2>
            <p className="payment-modal__amount">
              {t('payment.amount')}: <strong>{amountLabel}</strong>
            </p>

            <FormField
              id="card-holder"
              name="holder"
              label={t('payment.holder')}
              placeholder="IVAN IVANOV"
              value={card.holder}
              onChange={handleChange}
              error={errors.holder}
              disabled={stage !== 'form'}
              ref={firstFieldRef}
              required
            />
            <FormField
              id="card-number"
              name="number"
              label={t('payment.number')}
              placeholder="0000 0000 0000 0000"
              inputMode="numeric"
              value={card.number}
              onChange={handleChange}
              error={errors.number}
              disabled={stage !== 'form'}
              required
            />
            <div className="form__row payment-modal__row">
              <FormField
                id="card-expiry"
                name="expiry"
                label={t('payment.expiry')}
                placeholder="MM/YY"
                inputMode="numeric"
                value={card.expiry}
                onChange={handleChange}
                error={errors.expiry}
                disabled={stage !== 'form'}
                required
              />
              <FormField
                id="card-cvv"
                name="cvv"
                type="password"
                label="CVV"
                placeholder="•••"
                inputMode="numeric"
                value={card.cvv}
                onChange={handleChange}
                error={errors.cvv}
                disabled={stage !== 'form'}
                required
              />
            </div>

            <p className="payment-modal__demo" role="note">
              <Icon name="info" size={18} /> {t('payment.demoMode')}
            </p>

            <div className="form__actions">
              <button type="submit" className="btn btn--primary btn--lg" disabled={stage !== 'form'}>
                {stage === 'processing' && <LoadingSpinner size="sm" />}
                {t('payment.confirm')}
              </button>
              <button type="button" className="btn btn--outline btn--lg" onClick={handleCancel} disabled={stage !== 'form'}>
                {t('payment.cancel')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
