import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import EmptyState from '../common/EmptyState';
import Icon from '../common/Icon';
import { formatDate, formatPrice } from '../../utils/format';

/** История заказов пользователя. Каждый заказ можно развернуть и посмотреть состав */
export default function OrderHistory({ orders }) {
  const { t, i18n } = useTranslation();
  const [openId, setOpenId] = useState(null);

  if (orders.length === 0) {
    return (
      <EmptyState
        icon="gift"
        title={t('account.noOrders')}
        text={t('account.noOrdersText')}
        actionLabel={t('nav.catalog')}
        actionTo="/catalog"
      />
    );
  }

  return (
    <ul className="orders">
      {orders.map((order) => {
        const open = openId === order.id;
        const count = order.items.reduce((s, i) => s + i.quantity, 0);
        return (
          <li key={order.id} className="order card">
            <button
              type="button"
              className="order__head"
              aria-expanded={open}
              onClick={() => setOpenId(open ? null : order.id)}
            >
              <span className="order__id">№ {order.id}</span>
              <span className="order__date">{formatDate(order.createdAt, i18n.resolvedLanguage)}</span>
              <span className={`order__status order__status--${order.status}`}>{t(`orderStatus.${order.status}`)}</span>
              {order.paymentStatus && (
                <span className={`order__status order__status--${order.paymentStatus}`}>{t(`paymentStatus.${order.paymentStatus}`)}</span>
              )}
              <span className="order__sum">
                {t('cart.itemsCount', { count })} · <strong>{formatPrice(order.total)}</strong>
              </span>
              <Icon name="chevronDown" size={18} className={open ? 'rotate-180' : ''} />
            </button>
            {open && (
              <div className="order__body">
                <ul className="order__items">
                  {order.items.map((item) => (
                    <li key={`${item.id}-${item.volume}`}>
                      <span>
                        {item.brand} {item.name}, {item.volume} {t('product.ml')} × {item.quantity}
                      </span>
                      <span>{formatPrice(item.price * item.quantity)}</span>
                    </li>
                  ))}
                </ul>
                <dl className="order__totals">
                  {order.discount > 0 && (
                    <div>
                      <dt>{t('cart.discount')} ({order.promoCode})</dt>
                      <dd>−{formatPrice(order.discount)}</dd>
                    </div>
                  )}
                  <div>
                    <dt>{t(`delivery.methods.${order.shipping.method}.title`)}</dt>
                    <dd>{order.delivery === 0 ? t('cart.free') : formatPrice(order.delivery)}</dd>
                  </div>
                  <div>
                    <dt>{t('cart.total')}</dt>
                    <dd>{formatPrice(order.total)}</dd>
                  </div>
                </dl>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
