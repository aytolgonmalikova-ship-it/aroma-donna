import { Link } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { selectCartCount, selectCartTotals } from '../../features/cart/cartSlice';
import { formatPrice } from '../../utils/format';
import PromoCodeForm from './PromoCodeForm';
import Icon from '../common/Icon';

/**
 * Итог заказа: сумма товаров, скидка по промокоду, доставка, к оплате.
 * delivery === undefined — доставка ещё не выбрана (страница корзины).
 */
export default function CartSummary({ delivery, showCheckout = true, showPromo = true, children }) {
  const { t } = useTranslation();
  const count = useSelector(selectCartCount);
  const { subtotal, discount, total, promoCode } = useSelector(selectCartTotals);
  const grandTotal = total + (delivery || 0);

  return (
    <aside className="summary" aria-labelledby="summary-title">
      <h2 id="summary-title" className="summary__title">
        {t('cart.summary')}
      </h2>
      <dl className="summary__rows">
        <div>
          <dt>{t('cart.itemsCount', { count })}</dt>
          <dd>{formatPrice(subtotal)}</dd>
        </div>
        {promoCode && discount === 0 && (
          <div className="summary__warning">
            <dt>{t('promo.notActive', { code: promoCode })}</dt>
            <dd>—</dd>
          </div>
        )}
        {discount > 0 && (
          <div className="summary__discount">
            <dt>
              {t('cart.discount')} ({promoCode})
            </dt>
            <dd>−{formatPrice(discount)}</dd>
          </div>
        )}
        <div>
          <dt>{t('cart.delivery')}</dt>
          <dd>
            {delivery === undefined
              ? t('cart.deliveryAtCheckout')
              : delivery === 0
                ? t('cart.free')
                : formatPrice(delivery)}
          </dd>
        </div>
        <div className="summary__total">
          <dt>{t('cart.total')}</dt>
          <dd>{formatPrice(grandTotal)}</dd>
        </div>
      </dl>
      {showPromo && <PromoCodeForm />}
      {children}
      {showCheckout && (
        <Link to="/checkout"
        onClick={()=> console.log('Нажали оформить заказэ')}
         className="btn btn--primary btn--lg btn--block">
          {t('cart.checkout')} <Icon name="arrowRight" size={18} />
        </Link>
      )}
      <p className="summary__note">
        <Icon name="shield" size={16} /> {t('cart.paymentNote')}
      </p>
    </aside>
  );
}
