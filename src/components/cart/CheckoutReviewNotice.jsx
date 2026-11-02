import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Icon from '../common/Icon';
import { formatPrice } from '../../utils/format';

/**
 * Итог проверки корзины перед оформлением (utils/checkoutReview.js):
 * - blocked — товары скрыты, удалены, нет в наличии или нет объёма: заказ не оформлен,
 *   можно удалить такие позиции из корзины, выбрать другой объём в корзине или вернуться в каталог;
 * - confirm — изменились цены или сумма: новые цены и повторное подтверждение.
 * Сообщение получает фокус, чтобы покупатель с клавиатуры или экранным диктором сразу его заметил.
 */
export default function CheckoutReviewNotice({ review, cardPayment, submitting, onRemoveProblems, onConfirm }) {
  const { t } = useTranslation();
  const ref = useRef(null);

  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
    ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [review]);

  const blocked = review.status === 'blocked';
  const hasVolumeProblem = review.problems.some((l) => l.status === 'volumeUnavailable');

  return (
    <section
      ref={ref}
      tabIndex={-1}
      className={`checkout-review ${blocked ? 'checkout-review--blocked' : 'checkout-review--confirm'}`}
      role="alert"
      aria-labelledby="checkout-review-title"
    >
      <h2 id="checkout-review-title" className="checkout-review__title">
        <Icon name="alert" size={20} /> {t(blocked ? 'checkout.review.blockedTitle' : 'checkout.review.confirmTitle')}
      </h2>
      <p>{t(blocked ? 'checkout.review.blockedText' : 'checkout.review.confirmText')}</p>

      <ul className="checkout-review__list">
        {(blocked ? review.problems : review.priceChanges).map((l) => (
          <li key={l.key}>
            <span className="checkout-review__name">
              {l.name}
              <small>
                {l.volume} {t('product.ml')} × {l.quantity}
              </small>
            </span>
            {blocked ? (
              <span className="checkout-review__reason">{t(`checkout.review.problem.${l.status}`, { volume: l.volume })}</span>
            ) : (
              <span className="checkout-review__price">
                {l.oldPrice !== null && (
                  <>
                    <s aria-label={t('checkout.review.oldPrice', { price: formatPrice(l.oldPrice) })}>{formatPrice(l.oldPrice)}</s>{' '}
                    →{' '}
                  </>
                )}
                <strong aria-label={t('checkout.review.newPrice', { price: formatPrice(l.price) })}>{formatPrice(l.price)}</strong>
              </span>
            )}
          </li>
        ))}
      </ul>

      {!blocked && (
        <p className="checkout-review__total">
          {t('checkout.review.newTotal')} <strong>{formatPrice(review.totals.grandTotal)}</strong>
        </p>
      )}
      {!blocked && cardPayment && <p className="checkout-review__note">{t('checkout.review.cardNote')}</p>}

      <div className="checkout-review__actions">
        {blocked ? (
          <>
            <button type="button" className="btn btn--primary btn--sm" onClick={onRemoveProblems}>
              <Icon name="trash" size={16} /> {t('checkout.review.removeProblems')}
            </button>
            {hasVolumeProblem && (
              <Link to="/cart" className="btn btn--outline btn--sm">
                {t('checkout.review.chooseVolume')}
              </Link>
            )}
            <Link to="/catalog" className="btn btn--outline btn--sm">
              {t('cart.goToCatalog')}
            </Link>
          </>
        ) : (
          <>
            <button type="button" className="btn btn--primary btn--sm" onClick={onConfirm} disabled={submitting}>
              <Icon name="check" size={16} /> {t('checkout.review.confirmNew')}
            </button>
            <Link to="/cart" className="btn btn--outline btn--sm">
              {t('checkout.editCart')}
            </Link>
          </>
        )}
      </div>
    </section>
  );
}
