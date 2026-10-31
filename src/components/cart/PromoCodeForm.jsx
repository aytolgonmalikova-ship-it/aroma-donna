import { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import {
  applyPromoCode,
  removePromoCode,
  selectCartTotals,
  selectUsedPromoCodes,
} from '../../features/cart/cartSlice';
import { notify } from '../../features/notifications/notificationsSlice';
import { checkPromoCode } from '../../utils/promo';
import { formatPrice } from '../../utils/format';
import Icon from '../common/Icon';

/**
 * Применение ДЕМОНСТРАЦИОННОГО промокода.
 * Сообщения: пустое поле / неверный код / уже применён / уже использован / мин. сумма / успех.
 */
export default function PromoCodeForm() {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const { subtotal, promoCode } = useSelector(selectCartTotals);
  const usedCodes = useSelector(selectUsedPromoCodes);
  const [code, setCode] = useState('');
  const [message, setMessage] = useState(null); // { type, text }

  const handleSubmit = (event) => {
    event.preventDefault();
    const result = checkPromoCode(code, { subtotal, appliedCode: promoCode, usedCodes });
    if (!result.ok) {
      const params = { ...result.params };
      if (params.min) params.min = formatPrice(params.min);
      setMessage({ type: 'error', text: t(result.error, params) });
      return;
    }
    dispatch(applyPromoCode(result.promo.code));
    dispatch(notify({ message: 'promo.success', params: { code: result.promo.code } }));
    setMessage(null); // об успехе сообщает всплывающее уведомление и блок «Применён»
    setCode('');
  };

  const handleRemove = () => {
    dispatch(removePromoCode());
    setMessage(null);
    dispatch(notify({ type: 'info', message: 'promo.removed' }));
  };

  return (
    <div className="promo">
      {promoCode ? (
        <div className="promo__applied">
          <Icon name="check" size={18} />
          <span>
            {t('promo.applied')}: <strong>{promoCode}</strong>
          </span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={handleRemove}>
            {t('promo.remove')}
          </button>
        </div>
      ) : (
        <form className="promo__form" onSubmit={handleSubmit} noValidate>
          <label htmlFor="promo-code" className="visually-hidden">
            {t('promo.label')}
          </label>
          <input
            id="promo-code"
            type="text"
            value={code}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase());
              setMessage(null);
            }}
            placeholder={t('promo.placeholder')}
            autoComplete="off"
            aria-describedby="promo-message promo-hint"
          />
          <button type="submit" className="btn btn--outline">
            {t('promo.apply')}
          </button>
        </form>
      )}
      {message && (
        <p id="promo-message" className={`promo__message promo__message--${message.type}`} role="status">
          {message.text}
        </p>
      )}
      <p id="promo-hint" className="promo__hint">
        {t('promo.demoHint')}
      </p>
    </div>
  );
}
