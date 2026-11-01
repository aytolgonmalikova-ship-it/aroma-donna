import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Icon from '../../components/common/Icon';
import EmptyState from '../../components/common/EmptyState';
import ErrorMessage from '../../components/common/ErrorMessage';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import DemoNotice from '../../components/common/DemoNotice';
import { fetchAllOrders } from '../../services/adminService';
import { ORDER_STATUSES, countByStatus, filterOrdersByStatus, isOrderStatus } from '../../utils/orderStatus';
import { formatDate, formatPrice } from '../../utils/format';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';

/**
 * Список заказов покупателей с фильтром по статусу.
 * Фильтр хранится в адресе (?status=new), поэтому после «Назад» из карточки заказа он сохраняется.
 * Фильтрация — в браузере: все заказы уже загружены, новые индексы Firestore не нужны.
 */
export default function AdminOrdersPage() {
  const { t, i18n } = useTranslation();
  const [orders, setOrders] = useState(null); // null — загрузка
  const [error, setError] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const statusParam = searchParams.get('status');
  const filter = isOrderStatus(statusParam) ? statusParam : 'all';
  useDocumentTitle(`${t('admin.nav.orders')} — ${t('admin.title')}`);

  const load = useCallback(() => {
    let cancelled = false;
    setError(null);
    setOrders(null);
    fetchAllOrders()
      .then((list) => !cancelled && setOrders(list))
      .catch((err) => !cancelled && setError(err.code || 'failed'));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => load(), [load]);

  const setFilter = (status) => setSearchParams(status === 'all' ? {} : { status }, { replace: true });

  const counts = orders ? countByStatus(orders) : null;
  const visible = orders ? filterOrdersByStatus(orders, filter) : [];

  return (
    <>
      <div className="admin-page__head admin-page__head--row">
        <div>
          <h1>{t('admin.nav.orders')}</h1>
          <p>{t('admin.orders.subtitle')}</p>
        </div>
        <button type="button" className="btn btn--outline btn--sm" onClick={load} disabled={!orders && !error}>
          <Icon name="refresh" size={16} /> {t('admin.orders.refresh')}
        </button>
      </div>

      <DemoNotice>{t('admin.orders.guestNote')}</DemoNotice>

      <div className="admin-filters" role="group" aria-label={t('admin.orders.filterLabel')}>
        {['all', ...ORDER_STATUSES].map((s) => (
          <button
            key={s}
            type="button"
            className={`admin-filter${filter === s ? ' is-active' : ''}`}
            aria-pressed={filter === s}
            onClick={() => setFilter(s)}
          >
            {s === 'all' ? t('admin.orders.all') : t(`orderStatus.${s}`)}
            {counts && <span className="admin-filter__count">{counts[s]}</span>}
          </button>
        ))}
      </div>

      {error && <ErrorMessage message={t(`admin.orders.errors.${error}`, t('admin.orders.errors.failed'))} onRetry={load} />}
      {!error && !orders && <LoadingSpinner />}
      {orders && visible.length === 0 && (
        <EmptyState
          icon="cart"
          title={filter === 'all' ? t('admin.orders.empty') : t('admin.orders.emptyFiltered')}
        />
      )}

      {visible.length > 0 && (
        <div className="admin-table-wrap card">
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">{t('admin.orders.number')}</th>
                <th scope="col">{t('admin.orders.date')}</th>
                <th scope="col">{t('admin.orders.customer')}</th>
                <th scope="col">{t('admin.orders.total')}</th>
                <th scope="col">{t('admin.orders.status')}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((order) => (
                <tr key={`${order.userId}/${order.id}`}>
                  <td data-label={t('admin.orders.number')}>
                    <Link to={`/admin/orders/${order.userId}/${order.id}`} className="admin-table__link">
                      {order.id}
                    </Link>
                  </td>
                  <td data-label={t('admin.orders.date')}>{formatDate(order.createdAt, i18n.resolvedLanguage)}</td>
                  <td data-label={t('admin.orders.customer')}>
                    <div>
                      {[order.customer?.name, order.customer?.lastName].filter(Boolean).join(' ')}
                      <small>{order.customer?.phone}</small>
                    </div>
                  </td>
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
    </>
  );
}
