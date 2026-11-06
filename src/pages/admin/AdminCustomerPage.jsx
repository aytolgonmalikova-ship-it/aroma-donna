import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Icon from '../../components/common/Icon';
import EmptyState from '../../components/common/EmptyState';
import ErrorMessage from '../../components/common/ErrorMessage';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import { fetchCustomer } from '../../services/adminService';
import { shortUid } from '../../utils/customers';
import { formatDate, formatPrice } from '../../utils/format';
import { displayPhone } from '../../utils/phone';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';

/** Карточка покупателя: профиль users/{uid}, статистика и список его заказов (только просмотр) */
export default function AdminCustomerPage() {
  const { t, i18n } = useTranslation();
  const { uid } = useParams();
  const [customer, setCustomer] = useState(undefined); // undefined — загрузка, null — не найден
  const [error, setError] = useState(null);
  useDocumentTitle(`${customer?.name || t('admin.customers.customer')} — ${t('admin.title')}`);

  const load = useCallback(() => {
    let cancelled = false;
    setError(null);
    setCustomer(undefined);
    fetchCustomer(uid)
      .then((c) => !cancelled && setCustomer(c))
      .catch((err) => !cancelled && setError(err.code || 'failed'));
    return () => {
      cancelled = true;
    };
  }, [uid]);

  useEffect(() => load(), [load]);

  const back = (
    <Link to="/admin/customers" className="admin-back">
      <Icon name="arrowLeft" size={16} /> {t('admin.customers.back')}
    </Link>
  );

  if (error) {
    return (
      <>
        {back}
        <ErrorMessage message={t(`admin.customers.errors.${error}`, t('admin.customers.errors.failed'))} onRetry={load} />
      </>
    );
  }
  if (customer === undefined) return <LoadingSpinner />;
  if (customer === null) {
    return (
      <>
        {back}
        <EmptyState icon="search" title={t('admin.customers.notFound')} />
      </>
    );
  }

  const lang = i18n.resolvedLanguage;
  // Номер из последнего заказа не меняется — только вид на экране
  const phone = displayPhone(customer.phone);

  return (
    <>
      {back}
      <div className="admin-page__head admin-page__head--row">
        <div>
          <h1>{customer.name || t('admin.customers.noName')}</h1>
          <p>{customer.email || '—'}</p>
        </div>
        {!customer.hasProfile && <span className="admin-badge">{t('admin.customers.noProfile')}</span>}
      </div>

      {!customer.hasProfile && <p className="admin-muted admin-note">{t('admin.customers.noProfileHint')}</p>}

      <div className="admin-order">
        <section className="admin-panel card">
          <h2>{t('admin.customers.profile')}</h2>
          <dl className="admin-dl">
            <div>
              <dt>{t('admin.customers.name')}</dt>
              <dd>{customer.name || '—'}</dd>
            </div>
            <div>
              <dt>{t('admin.customers.email')}</dt>
              <dd>{customer.email ? <a href={`mailto:${customer.email}`}>{customer.email}</a> : '—'}</dd>
            </div>
            <div>
              <dt>{t('admin.customers.phone')}</dt>
              <dd>
                {phone.text ? (
                  <>
                    {phone.href ? <a href={phone.href}>{phone.text}</a> : phone.text}
                    <small className="admin-muted admin-muted--inline">{t('admin.customers.phoneHint')}</small>
                  </>
                ) : (
                  '—'
                )}
              </dd>
            </div>
            <div>
              <dt>{t('admin.customers.registered')}</dt>
              <dd>{customer.createdAt ? formatDate(customer.createdAt, lang) : '—'}</dd>
            </div>
            <div>
              <dt>{t('admin.customers.uid')}</dt>
              <dd title={customer.uid}>{shortUid(customer.uid)}</dd>
            </div>
          </dl>
        </section>

        <section className="admin-panel card">
          <h2>{t('admin.customers.stats')}</h2>
          <dl className="admin-dl">
            <div>
              <dt>{t('admin.customers.ordersCount')}</dt>
              <dd>{customer.ordersCount}</dd>
            </div>
            <div>
              <dt>{t('admin.customers.spent')}</dt>
              <dd>
                <strong>{formatPrice(customer.totalSpent)}</strong>
              </dd>
            </div>
            <div>
              <dt>{t('admin.customers.lastOrder')}</dt>
              <dd>{customer.lastOrderAt ? formatDate(customer.lastOrderAt, lang) : '—'}</dd>
            </div>
          </dl>
          <p className="admin-muted">{t('admin.customers.spentHint')}</p>
        </section>

        <section className="admin-panel card admin-order__items">
          <h2>{t('admin.customers.ordersTitle')}</h2>
          {customer.orders.length === 0 ? (
            <p className="admin-muted">{t('admin.customers.noOrders')}</p>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th scope="col">{t('admin.orders.number')}</th>
                    <th scope="col">{t('admin.orders.date')}</th>
                    <th scope="col">{t('admin.orders.total')}</th>
                    <th scope="col">{t('admin.orders.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {customer.orders.map((order) => (
                    <tr key={order.id}>
                      <td data-label={t('admin.orders.number')}>
                        <Link to={`/admin/orders/${customer.uid}/${order.id}`} className="admin-table__link">
                          {order.id}
                        </Link>
                      </td>
                      <td data-label={t('admin.orders.date')}>{formatDate(order.createdAt, lang)}</td>
                      <td data-label={t('admin.orders.total')}>
                        <strong>{formatPrice(order.total)}</strong>
                      </td>
                      <td data-label={t('admin.orders.status')}>
                        <span className={`order__status order__status--${order.status}`}>
                          {t(`orderStatus.${order.status}`, order.status)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
