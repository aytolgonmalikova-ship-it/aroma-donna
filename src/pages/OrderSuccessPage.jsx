import { Link, useLocation, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import DemoNotice from '../components/common/DemoNotice';
import EmptyState from '../components/common/EmptyState';
import Icon from '../components/common/Icon';
import { findLocalOrder } from '../services/orderService';
import { formatDate, formatPrice } from '../utils/format';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

/**
 * Страница успешного оформления. Заказ передаётся через state навигации;
 * если страницу обновили — ищем демо-заказ в localStorage по номеру.
 */
export default function OrderSuccessPage() {
  const { orderId } = useParams();
  const location = useLocation();
  const { t, i18n } = useTranslation();
  useDocumentTitle(t('success.title'));
  const order = location.state?.order || findLocalOrder(orderId);

  if (!order) {
    return (
      <div className="container section">
        <EmptyState headingLevel="h1" icon="search" title={t('success.notFound')} actionLabel={t('nav.home')} actionTo="/" />
      </div>
    );
  }

  const isDemo = order.mode !== 'firebase';

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
        <DemoNotice variant="warning">{isDemo ? t('success.demoText') : t('success.firebaseText')}</DemoNotice>

        <dl className="success__details">
          <div>
            <dt>{t('success.recipient')}</dt>
            <dd>{[order.customer.name, order.customer.lastName].filter(Boolean).join(' ')}</dd>
          </div>
          <div>
            <dt>{t('checkout.delivery')}</dt>
            <dd>
              {t(`delivery.methods.${order.shipping.method}.title`)}
              {order.shipping.address &&
                `: ${order.shipping.region ? `${t(`regions.${order.shipping.region}`)}, ` : ''}${t(`cities.${order.shipping.city}`)}, ${order.shipping.address}`}
            </dd>
          </div>
          <div>
            <dt>{t('checkout.payment')}</dt>
            <dd>{t(`checkout.paymentMethods.${order.payment}`)}</dd>
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
          {order.userId && (
            <Link to="/account" className="btn btn--outline">
              {t('success.toAccount')}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
