import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import Icon from '../../components/common/Icon';
import EmptyState from '../../components/common/EmptyState';
import ErrorMessage from '../../components/common/ErrorMessage';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import { fetchOrder, updateOrderStatus } from '../../services/adminService';
import { notify } from '../../features/notifications/notificationsSlice';
import { ORDER_STATUSES } from '../../utils/orderStatus';
import { formatDate, formatPrice } from '../../utils/format';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';

/** Подробности заказа users/{userId}/orders/{orderId} и смена его статуса */
export default function AdminOrderPage() {
  const { t, i18n } = useTranslation();
  const dispatch = useDispatch();
  const { userId, orderId } = useParams();
  const [order, setOrder] = useState(undefined); // undefined — загрузка, null — не найден
  const [error, setError] = useState(null);
  const [nextStatus, setNextStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  useDocumentTitle(`${t('admin.orders.order')} ${orderId} — ${t('admin.title')}`);

  const load = useCallback(() => {
    let cancelled = false;
    setError(null);
    setOrder(undefined);
    fetchOrder(userId, orderId)
      .then((o) => {
        if (cancelled) return;
        setOrder(o);
        setNextStatus(o?.status || '');
      })
      .catch((err) => !cancelled && setError(err.code || 'failed'));
    return () => {
      cancelled = true;
    };
  }, [userId, orderId]);

  useEffect(() => load(), [load]);

  const back = (
    <Link to="/admin/orders" className="admin-back">
      <Icon name="arrowLeft" size={16} /> {t('admin.orders.back')}
    </Link>
  );

  if (error) {
    return (
      <>
        {back}
        <ErrorMessage message={t(`admin.orders.errors.${error}`, t('admin.orders.errors.failed'))} onRetry={load} />
      </>
    );
  }
  if (order === undefined) return <LoadingSpinner />;
  if (order === null) {
    return (
      <>
        {back}
        <EmptyState icon="search" title={t('admin.orders.notFound')} />
      </>
    );
  }

  const lang = i18n.resolvedLanguage;
  const { customer = {}, shipping = {} } = order;
  const address =
    shipping.method === 'pickup'
      ? null
      : [shipping.region && t(`regions.${shipping.region}`), shipping.city && t(`cities.${shipping.city}`), shipping.address]
          .filter(Boolean)
          .join(', ');

  const handleSave = async (e) => {
    e.preventDefault();
    if (nextStatus === order.status) return;
    if (nextStatus === 'cancelled' && !window.confirm(t('admin.orders.confirmCancel', { id: order.id }))) return;
    setSaving(true);
    setSaveError(null);
    try {
      await updateOrderStatus(userId, order.id, nextStatus);
      setOrder({ ...order, status: nextStatus, statusUpdatedAt: new Date().toISOString() });
      dispatch(notify({ message: 'admin.orders.statusSaved', params: { id: order.id } }));
    } catch (err) {
      setSaveError(err.code || 'failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {back}
      <div className="admin-page__head admin-page__head--row">
        <div>
          <h1>
            {t('admin.orders.order')} № {order.id}
          </h1>
          <p>{formatDate(order.createdAt, lang)}</p>
        </div>
        <span className={`order__status order__status--${order.status}`}>{t(`orderStatus.${order.status}`, order.status)}</span>
      </div>

      <div className="admin-order">
        <section className="admin-panel card">
          <h2>{t('admin.orders.statusTitle')}</h2>
          <form className="admin-status-form" onSubmit={handleSave}>
            <label htmlFor="order-status">{t('admin.orders.status')}</label>
            <select
              id="order-status"
              className="field__control"
              value={nextStatus}
              onChange={(e) => setNextStatus(e.target.value)}
              disabled={saving}
            >
              {ORDER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`orderStatus.${s}`)}
                </option>
              ))}
            </select>
            <button type="submit" className="btn btn--primary btn--sm" disabled={saving || nextStatus === order.status}>
              {saving ? <LoadingSpinner size="sm" /> : <Icon name="check" size={16} />} {t('admin.orders.saveStatus')}
            </button>
          </form>
          {saveError && (
            <p className="form__error" role="alert">
              {t(`admin.orders.errors.${saveError}`, t('admin.orders.errors.failed'))}
            </p>
          )}
          {order.statusUpdatedAt && (
            <p className="admin-muted">{t('admin.orders.statusUpdatedAt', { date: formatDate(order.statusUpdatedAt, lang) })}</p>
          )}
        </section>

        <section className="admin-panel card">
          <h2>{t('admin.orders.customer')}</h2>
          <dl className="admin-dl">
            <div>
              <dt>{t('admin.orders.name')}</dt>
              <dd>{[customer.name, customer.lastName].filter(Boolean).join(' ') || '—'}</dd>
            </div>
            <div>
              <dt>{t('admin.orders.phone')}</dt>
              <dd>{customer.phone ? <a href={`tel:${customer.phone.replace(/[^\d+]/g, '')}`}>{customer.phone}</a> : '—'}</dd>
            </div>
            <div>
              <dt>{t('admin.orders.email')}</dt>
              <dd>{customer.email ? <a href={`mailto:${customer.email}`}>{customer.email}</a> : '—'}</dd>
            </div>
          </dl>
        </section>

        <section className="admin-panel card">
          <h2>{t('checkout.delivery')}</h2>
          <dl className="admin-dl">
            <div>
              <dt>{t('admin.orders.deliveryMethod')}</dt>
              <dd>{shipping.method ? t(`delivery.methods.${shipping.method}.title`) : '—'}</dd>
            </div>
            {address && (
              <div>
                <dt>{t('admin.orders.address')}</dt>
                <dd>{address}</dd>
              </div>
            )}
            {shipping.comment && (
              <div>
                <dt>{t('admin.orders.comment')}</dt>
                <dd className="admin-pre">{shipping.comment}</dd>
              </div>
            )}
            <div>
              <dt>{t('checkout.payment')}</dt>
              <dd>{order.payment ? t(`checkout.paymentMethods.${order.payment}`) : '—'}</dd>
            </div>
            {order.paymentStatus && (
              <div>
                <dt>{t('paymentStatus.label')}</dt>
                <dd>
                  <span className={`order__status order__status--${order.paymentStatus}`}>
                    {t(`paymentStatus.${order.paymentStatus}`)}
                  </span>
                </dd>
              </div>
            )}
          </dl>
        </section>

        <section className="admin-panel card admin-order__items">
          <h2>{t('admin.orders.items')}</h2>
          <ul className="order__items">
            {(order.items || []).map((item) => (
              <li key={`${item.id}-${item.volume}`}>
                <span>
                  {item.brand} {item.name}, {item.volume} {t('product.ml')} × {item.quantity}
                </span>
                <span>{formatPrice(item.price * item.quantity)}</span>
              </li>
            ))}
          </ul>
          <dl className="order__totals">
            <div>
              <dt>{t('admin.orders.subtotal')}</dt>
              <dd>{formatPrice(order.subtotal)}</dd>
            </div>
            {order.discount > 0 && (
              <div>
                <dt>
                  {t('cart.discount')} ({order.promoCode})
                </dt>
                <dd>−{formatPrice(order.discount)}</dd>
              </div>
            )}
            <div>
              <dt>{t('admin.orders.deliveryCost')}</dt>
              <dd>{order.delivery === 0 ? t('cart.free') : formatPrice(order.delivery)}</dd>
            </div>
            <div>
              <dt>{t('cart.total')}</dt>
              <dd>{formatPrice(order.total)}</dd>
            </div>
          </dl>
        </section>
      </div>
    </>
  );
}
