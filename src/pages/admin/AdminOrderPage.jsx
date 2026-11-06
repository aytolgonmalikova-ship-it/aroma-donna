import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import Icon from '../../components/common/Icon';
import EmptyState from '../../components/common/EmptyState';
import ErrorMessage from '../../components/common/ErrorMessage';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import { fetchOrder, resendOrderNotification, updateOrderStatus } from '../../services/adminService';
import { canResendNotification } from '../../utils/adminOrders';
import { notify } from '../../features/notifications/notificationsSlice';
import { ORDER_STATUSES } from '../../utils/orderStatus';
import { formatDate, formatPrice } from '../../utils/format';
import { displayPhone } from '../../utils/phone';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';

/**
 * Подробности заказа и смена его статуса: покупатель — users/{userId}/orders/{orderId},
 * гость — guests/{guestKey}/orders/{orderId} (адрес /admin/orders/guest/:guestKey/:orderId).
 * Уведомление в Telegram: статус и ручная повторная отправка (только при сбое, с подтверждением).
 */
export default function AdminOrderPage() {
  const { t, i18n } = useTranslation();
  const dispatch = useDispatch();
  const { userId, guestKey, orderId } = useParams();
  const kind = guestKey ? 'guest' : 'user';
  const ownerId = guestKey || userId;
  const [order, setOrder] = useState(undefined); // undefined — загрузка, null — не найден
  const [error, setError] = useState(null);
  const [nextStatus, setNextStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [confirmResend, setConfirmResend] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendResult, setResendResult] = useState(null); // { ok, key }
  useDocumentTitle(`${t('admin.orders.order')} ${orderId} — ${t('admin.title')}`);

  const load = useCallback(() => {
    let cancelled = false;
    setError(null);
    setOrder(undefined);
    fetchOrder({ kind, ownerId, orderId })
      .then((o) => {
        if (cancelled) return;
        setOrder(o);
        setNextStatus(o?.status || '');
      })
      .catch((err) => !cancelled && setError(err.code || 'failed'));
    return () => {
      cancelled = true;
    };
  }, [kind, ownerId, orderId]);

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
  // Номер в заказе не меняется — только вид на экране (+996 700 123 456 для однозначных кыргызских номеров)
  const phone = displayPhone(customer.phone);
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
      await updateOrderStatus({ kind, ownerId, orderId: order.id }, nextStatus);
      setOrder({ ...order, status: nextStatus, statusUpdatedAt: new Date().toISOString() });
      dispatch(notify({ message: 'admin.orders.statusSaved', params: { id: order.id } }));
    } catch (err) {
      setSaveError(err.code || 'failed');
    } finally {
      setSaving(false);
    }
  };

  const notification = order.notification || null;
  const handleResend = async () => {
    setResending(true);
    setResendResult(null);
    try {
      const status = await resendOrderNotification({ kind, ownerId, orderId: order.id });
      setOrder((o) => ({ ...o, notification: { ...(o.notification || {}), status: status === 'in_progress' ? 'sending' : status } }));
      setResendResult({ ok: status === 'sent', key: `admin.orders.notify.result.${status}` });
    } catch (err) {
      setResendResult({ ok: false, key: `admin.orders.errors.${err.code}` });
    } finally {
      setResending(false);
      setConfirmResend(false);
    }
  };

  return (
    <>
      {back}
      <div className="admin-page__head admin-page__head--row">
        <div>
          <h1>
            {t('admin.orders.order')} № {order.id}
            {order.isGuest && <span className="admin-badge admin-badge--guest">{t('admin.orders.guest')}</span>}
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

        <section className="admin-panel card admin-order-notify" aria-labelledby="order-notify-title">
          <h2 id="order-notify-title">{t('admin.orders.notify.title')}</h2>
          {notification ? (
            <dl className="admin-dl">
              <div>
                <dt>{t('admin.orders.notify.status')}</dt>
                <dd>
                  <span className={`admin-badge admin-notify admin-notify--${notification.status}`}>
                    {t(`admin.orders.notify.statuses.${notification.status}`, notification.status)}
                  </span>
                </dd>
              </div>
              <div>
                <dt>{t('admin.orders.notify.attempts')}</dt>
                <dd>{Number(notification.attempts) || 0}</dd>
              </div>
              {notification.sentAt && (
                <div>
                  <dt>{t('admin.orders.notify.sentAt')}</dt>
                  <dd>{formatDate(notification.sentAt, lang)}</dd>
                </div>
              )}
              {notification.status === 'failed' && notification.lastError && (
                <div>
                  <dt>{t('admin.orders.notify.lastError')}</dt>
                  <dd>
                    <code>{notification.lastError}</code>
                  </dd>
                </div>
              )}
            </dl>
          ) : (
            <p className="admin-muted">{t('admin.orders.notify.legacy')}</p>
          )}
          {canResendNotification(notification) && !confirmResend && (
            <button type="button" className="btn btn--outline btn--sm" onClick={() => setConfirmResend(true)} disabled={resending}>
              <Icon name="refresh" size={16} /> {t('admin.orders.notify.resend')}
            </button>
          )}
          {confirmResend && (
            <div className="admin-order-notify__confirm" role="group" aria-labelledby="order-notify-confirm">
              <p id="order-notify-confirm">{t('admin.orders.notify.confirm', { id: order.id })}</p>
              <div className="admin-order-notify__actions">
                <button type="button" className="btn btn--primary btn--sm" onClick={handleResend} disabled={resending} aria-busy={resending || undefined}>
                  {resending ? <LoadingSpinner size="sm" /> : <Icon name="check" size={16} />} {t('admin.orders.notify.confirmSend')}
                </button>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setConfirmResend(false)} disabled={resending}>
                  {t('admin.orders.notify.cancel')}
                </button>
              </div>
            </div>
          )}
          {resendResult && (
            <p className={resendResult.ok ? 'admin-order-notify__ok' : 'form__error'} role={resendResult.ok ? 'status' : 'alert'}>
              {t(resendResult.key, t('admin.orders.errors.failed'))}
            </p>
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
              <dd>{phone.text ? phone.href ? <a href={phone.href}>{phone.text}</a> : phone.text : '—'}</dd>
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
