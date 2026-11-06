import { Link, useLocation, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import DemoNotice from '../components/common/DemoNotice';
import EmptyState from '../components/common/EmptyState';
import Icon from '../components/common/Icon';
import { findLocalOrder, findRecentOrder } from '../services/orderService';
import { formatDate, formatPrice } from '../utils/format';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

/**
 * Страница успешного оформления. Заказ передаётся через state навигации; если страницу обновили —
 * берём сводку из этого браузера (aroma_recent_orders, только безопасные поля ответа сервера)
 * или старый демо-заказ. Заказ здесь не создаётся и не отправляется повторно.
 *
 * Серверный заказ (C3.3): номер, дата, способы доставки и оплаты, статус оплаты, состав и итог —
 * без имени, телефона и адреса (их нет ни в ответе сервера, ни в браузере после оформления).
 */
function fromServer(o) {
  return {
    id: o.orderId,
    createdAt: o.createdAt,
    server: true,
    registered: o.customerType === 'registered',
    deliveryMethod: o.deliveryMethod,
    payment: o.paymentMethod,
    paymentStatus: o.paymentStatus,
    total: o.total,
    items: (o.items || []).map((i) => ({ ...i, id: i.productId })),
  };
}
function fromDemo(o) {
  return {
    id: o.id,
    createdAt: o.createdAt,
    server: false,
    registered: Boolean(o.userId),
    deliveryMethod: o.shipping?.method,
    recipient: [o.customer?.name, o.customer?.lastName].filter(Boolean).join(' '),
    shipping: o.shipping,
    payment: o.payment,
    paymentStatus: o.paymentStatus,
    total: o.total,
    items: o.items || [],
  };
}
export default function OrderSuccessPage() {
  const { orderId } = useParams();
  const location = useLocation();
  const { t, i18n } = useTranslation();
  useDocumentTitle(t('success.title'));
  const raw = location.state?.order || findRecentOrder(orderId) || findLocalOrder(orderId);
  const order = raw ? (raw.orderId ? fromServer(raw) : fromDemo(raw)) : null;

  if (!order) {
    return (
      <div className="container section">
        <EmptyState headingLevel="h1" icon="search" title={t('success.notFound')} actionLabel={t('nav.home')} actionTo="/" />
      </div>
    );
  }

  const isDemo = !order.server && raw.mode !== 'firebase';

  return (
    <div className="container section success">
      <div className="success__card card">
        <span className="success__icon">
          <Icon name="check" size={36} strokeWidth={2.2} />
        </span>
        <h1>{isDemo ? t('success.titleDemo') : t('success.title')}</h1>
        <p className="success__number">
          {t('success.number')}: <strong>{order.id}</strong>
        </p>
        <p className="success__date">{formatDate(order.createdAt, i18n.resolvedLanguage)}</p>
        <DemoNotice variant="warning">{isDemo ? t('success.demoText') : order.server ? t('success.serverText') : t('success.firebaseText')}</DemoNotice>

        <dl className="success__details">
          {order.recipient && (
            <div>
              <dt>{t('success.recipient')}</dt>
              <dd>{order.recipient}</dd>
            </div>
          )}
          <div>
            <dt>{t('checkout.delivery')}</dt>
            <dd>
              {order.deliveryMethod ? t(`delivery.methods.${order.deliveryMethod}.title`) : '—'}
              {order.shipping?.address &&
                `: ${order.shipping.region ? `${t(`regions.${order.shipping.region}`)}, ` : ''}${t(`cities.${order.shipping.city}`)}, ${order.shipping.address}`}
            </dd>
          </div>
          <div>
            <dt>{t('checkout.payment')}</dt>
            <dd>
              {t(`checkout.paymentMethods.${order.payment}`)}
              {order.server && order.payment === 'cardDemo' && <small className="success__note">{t('success.cardDemoNote')}</small>}
            </dd>
          </div>
          {order.paymentStatus && (
            <div>
              <dt>{t('paymentStatus.label')}</dt>
              <dd>
                <span className={`order__status order__status--${order.paymentStatus}`}>{t(`paymentStatus.${order.paymentStatus}`)}</span>
              </dd>
            </div>
          )}
          <div>
            <dt>{t('cart.total')}</dt>
            <dd>
              <strong>{formatPrice(order.total)}</strong>
            </dd>
          </div>
        </dl>

        <ul className="success__items">
          {order.items.map((item) => (
            <li key={`${item.id}-${item.volume}`}>
              <span>
                {item.brand} {item.name}, {item.volume} {t('product.ml')} × {item.quantity}
              </span>
              <span>{formatPrice(item.price * item.quantity)}</span>
            </li>
          ))}
        </ul>

        <div className="success__actions">
          <Link to="/catalog" className="btn btn--primary">
            {t('success.continue')}
          </Link>
          {order.registered && (
            <Link to="/account" className="btn btn--outline">
              {t('success.toAccount')}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
