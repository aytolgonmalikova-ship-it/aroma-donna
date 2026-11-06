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
import { displayPhone } from '../../utils/phone';
import { ORDER_SORTS, adminOrderLink, filterOrdersByDate, isOrderSort, searchOrders, sortOrders } from '../../utils/adminOrders';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';

/**
 * Список заказов: покупатели с аккаунтом и гости (отметка «Гость»). Поиск (номер, имя, телефон),
 * даты, сортировка и фильтр по статусу хранятся в адресе (?q=…&from=…&to=…&sort=…&status=…),
 * поэтому после «Назад» из карточки заказа они сохраняются. Загружаются последние заказы
 * (один запрос с сортировкой и лимитом), фильтрация — в браузере: новые индексы Firestore не нужны.
 */
export default function AdminOrdersPage() {
  const { t, i18n } = useTranslation();
  const [orders, setOrders] = useState(null); // null — загрузка
  const [error, setError] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const statusParam = searchParams.get('status');
  const filter = isOrderStatus(statusParam) ? statusParam : 'all';
  const query = searchParams.get('q') || '';
  const from = searchParams.get('from') || '';
  const to = searchParams.get('to') || '';
  const sortParam = searchParams.get('sort');
  const sort = isOrderSort(sortParam) ? sortParam : ORDER_SORTS[0];
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

  const setParam = (key, value, defaultValue) => {
    const next = new URLSearchParams(searchParams);
    if (!value || value === defaultValue) next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  };
  const setFilter = (status) => setParam('status', status, 'all');

  // Поиск и даты — затем счётчики по статусам и фильтр по статусу, затем сортировка
  const matched = orders ? filterOrdersByDate(searchOrders(orders, query), from, to) : null;
  const counts = matched ? countByStatus(matched) : null;
  const visible = matched ? sortOrders(filterOrdersByStatus(matched, filter), sort) : [];
  const narrowed = Boolean(query || from || to);

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

      <div className="admin-toolbar admin-orders__toolbar">
        <label className="admin-toolbar__search">
          <span className="visually-hidden">{t('admin.orders.searchLabel')}</span>
          <Icon name="search" size={16} />
          <input
            type="search"
            className="field__control"
            placeholder={t('admin.orders.searchPlaceholder')}
            value={query}
            onChange={(e) => setParam('q', e.target.value)}
          />
        </label>
        <label className="admin-toolbar__sort">
          <span>{t('admin.orders.dateFrom')}</span>
          <input type="date" className="field__control" value={from} max={to || undefined} onChange={(e) => setParam('from', e.target.value)} />
        </label>
        <label className="admin-toolbar__sort">
          <span>{t('admin.orders.dateTo')}</span>
          <input type="date" className="field__control" value={to} min={from || undefined} onChange={(e) => setParam('to', e.target.value)} />
        </label>
        <label className="admin-toolbar__sort">
          <span>{t('admin.orders.sortLabel')}</span>
          <select className="field__control" value={sort} onChange={(e) => setParam('sort', e.target.value, ORDER_SORTS[0])}>
            {ORDER_SORTS.map((s) => (
              <option key={s} value={s}>
                {t(`admin.orders.sort.${s}`)}
              </option>
            ))}
          </select>
        </label>
        {orders && <span className="admin-toolbar__count">{t('admin.orders.found', { count: visible.length, total: orders.length })}</span>}
      </div>

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
          title={narrowed ? t('admin.orders.emptySearch') : filter === 'all' ? t('admin.orders.empty') : t('admin.orders.emptyFiltered')}
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
                <tr key={`${order.isGuest ? `g/${order.guestKey}` : `u/${order.userId}`}/${order.id}`}>
                  <td data-label={t('admin.orders.number')}>
                    <Link to={adminOrderLink(order)} className="admin-table__link">
                      {order.id}
                    </Link>
                  </td>
                  <td data-label={t('admin.orders.date')}>{formatDate(order.createdAt, i18n.resolvedLanguage)}</td>
                  <td data-label={t('admin.orders.customer')}>
                    <div>
                      {[order.customer?.name, order.customer?.lastName].filter(Boolean).join(' ')}
                      {order.isGuest && <span className="admin-badge admin-badge--guest">{t('admin.orders.guest')}</span>}
                      <small>{displayPhone(order.customer?.phone).text}</small>
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
