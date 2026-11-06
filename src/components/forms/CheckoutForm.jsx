import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import FormField from '../common/FormField';
import PhoneField from '../common/PhoneField';
import LoadingSpinner from '../common/LoadingSpinner';
import { DELIVERY_METHODS } from '../../utils/promo';
import { formatPrice } from '../../utils/format';
import { hasErrors, validateCheckout } from '../../utils/validation';
// Регионы Кыргызстана и города, в которые доставляем — общий модуль (его же использует проверка заказа)
import { REGIONS } from '../../data/regions';

// Способы оплаты: наличными курьеру или DEMO-оплата картой (через модальное окно)
export const PAYMENT_METHODS = ['cashOnDelivery', 'cardDemo'];

/**
 * Форма оформления заказа: контакты, способ доставки, адрес, способ оплаты.
 * Кнопки находятся в самом конце формы, после всех данных покупателя и доставки.
 * Сама форма не отправляет данные — она проверяет их и передаёт родителю (onSubmit),
 * а уже страница CheckoutPage открывает DEMO-оплату или сохраняет заказ через orderService.
 */
export default function CheckoutForm({ initialValues, deliveryMethod, onDeliveryChange, onSubmit, onCancel, submitting, totalLabel }) {
  const { t } = useTranslation();
  const [values, setValues] = useState({
    name: '',
    lastName: '',
    phone: '',
    email: '',
    region: 'bishkek',
    city: 'bishkek',
    address: '',
    comment: '',
    payment: 'cashOnDelivery',
    agree: false,
    ...initialValues,
    delivery: deliveryMethod,
  });
  const [errors, setErrors] = useState({});

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setValues((v) => {
      const next = { ...v, [name]: type === 'checkbox' ? checked : value };
      // При смене региона подставляем первый город этого региона
      if (name === 'region') next.city = REGIONS[value]?.[0] || '';
      return next;
    });
    if (errors[name]) setErrors((er) => ({ ...er, [name]: undefined }));
  };

  const handleDelivery = (method) => {
    setValues((v) =>
      method === 'courier' ? { ...v, delivery: method, region: 'bishkek', city: 'bishkek' } : { ...v, delivery: method },
    );
    onDeliveryChange(method);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (submitting) return; // защита от повторной отправки
    const found = validateCheckout(values);
    setErrors(found);
    if (hasErrors(found)) {
      // Переводим фокус на первое поле с ошибкой
      const first = Object.keys(found)[0];
      document.getElementById(`co-${first}`)?.focus();
      return;
    }
    onSubmit(values);
  };

  const needsAddress = values.delivery !== 'pickup';
  const isCourier = values.delivery === 'courier';
  const isCard = values.payment === 'cardDemo';

  return (
    <form className="form checkout-form" onSubmit={handleSubmit} noValidate>
      <fieldset className="form__section">
        <legend>
          <span className="step-num">1</span> {t('checkout.contacts')}
        </legend>
        <div className="form__row">
          <FormField id="co-name" name="name" label={t('form.name')} autoComplete="given-name" value={values.name} onChange={handleChange} error={errors.name} required />
          <FormField
            id="co-lastName"
            name="lastName"
            label={t('form.lastName')}
            autoComplete="family-name"
            value={values.lastName}
            onChange={handleChange}
            error={errors.lastName}
            required
          />
        </div>
        <div className="form__row">
          <PhoneField id="co-phone" name="phone" label={t('form.phone')} value={values.phone} onChange={handleChange} error={errors.phone} required />
          <FormField id="co-email" name="email" type="email" label={t('form.email')} autoComplete="email" value={values.email} onChange={handleChange} error={errors.email} required />
        </div>
      </fieldset>

      <fieldset className="form__section">
        <legend>
          <span className="step-num">2</span> {t('checkout.delivery')}
        </legend>
        <div className="radio-cards">
          {Object.entries(DELIVERY_METHODS).map(([method, info]) => (
            <label key={method} className={`radio-card ${values.delivery === method ? 'is-active' : ''}`}>
              <input
                type="radio"
                name="delivery"
                value={method}
                checked={values.delivery === method}
                onChange={() => handleDelivery(method)}
              />
              <span className="radio-card__title">{t(`delivery.methods.${method}.title`)}</span>
              <span className="radio-card__text">{t(`delivery.methods.${method}.short`)}</span>
              <span className="radio-card__price">
                {info.price === 0
                  ? t('cart.free')
                  : `${formatPrice(info.price)} · ${t('delivery.freeFrom', { amount: formatPrice(info.freeFrom) })}`}
              </span>
            </label>
          ))}
        </div>

        {needsAddress ? (
          <>
            <div className="form__row">
              <FormField id="co-region" label={t('form.region')} error={errors.region} required>
                <select
                  id="co-region"
                  name="region"
                  className="field__control"
                  value={values.region}
                  onChange={handleChange}
                  disabled={isCourier}
                >
                  {Object.keys(REGIONS).map((region) => (
                    <option key={region} value={region}>
                      {t(`regions.${region}`)}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField id="co-city" label={t('form.city')} error={errors.city} required>
                <select
                  id="co-city"
                  name="city"
                  className="field__control"
                  value={values.city}
                  onChange={handleChange}
                  disabled={isCourier}
                >
                  {(REGIONS[values.region] || []).map((city) => (
                    <option key={city} value={city}>
                      {t(`cities.${city}`)}
                    </option>
                  ))}
                </select>
              </FormField>
            </div>
            <FormField
              id="co-address"
              name="address"
              label={t('form.address')}
              placeholder={t('form.addressPlaceholder')}
              autoComplete="street-address"
              value={values.address}
              onChange={handleChange}
              error={errors.address}
              required
            />
          </>
        ) : (
          <p className="checkout-form__pickup">{t('delivery.pickupAddress')}</p>
        )}
        <FormField
          id="co-comment"
          name="comment"
          as="textarea"
          rows={3}
          maxLength={300}
          label={t('form.comment')}
          value={values.comment}
          onChange={handleChange}
        />
      </fieldset>

      <fieldset className="form__section">
        <legend>
          <span className="step-num">3</span> {t('checkout.payment')}
        </legend>
        <div className="radio-cards radio-cards--2">
          {PAYMENT_METHODS.map((p) => (
            <label key={p} className={`radio-card ${values.payment === p ? 'is-active' : ''}`}>
              <input type="radio" name="payment" value={p} checked={values.payment === p} onChange={handleChange} />
              <span className="radio-card__title">{t(`checkout.paymentMethods.${p}`)}</span>
            </label>
          ))}
        </div>
        <p className="form__note">{t(isCard ? 'checkout.cardDemoNote' : 'checkout.cashNote')}</p>
      </fieldset>

      <label className={`checkbox ${errors.agree ? 'checkbox--error' : ''}`}>
        <input id="co-agree" type="checkbox" name="agree" checked={values.agree} onChange={handleChange} />
        <span className="checkbox__box" aria-hidden="true" />
        <span className="checkbox__label">{t('checkout.agree')}</span>
      </label>
      {errors.agree && (
        <p className="field__error" role="alert">
          {t(errors.agree)}
        </p>
      )}

      {/* Кнопки — в самом конце формы, после всех данных покупателя и доставки */}
      <div className="form__actions checkout-form__actions">
        <button type="submit" className="btn btn--primary btn--lg" disabled={submitting}>
          {submitting && <LoadingSpinner size="sm" />}
          {isCard ? t('checkout.demoPay') : t('checkout.placeOrder')} · {totalLabel}
        </button>
        <button type="button" className="btn btn--outline btn--lg" onClick={onCancel} disabled={submitting}>
          {t('checkout.cancel')}
        </button>
      </div>
    </form>
  );
}
