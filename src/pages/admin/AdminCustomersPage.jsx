import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Icon from '../../components/common/Icon';
import EmptyState from '../../components/common/EmptyState';
import ErrorMessage from '../../components/common/ErrorMessage';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import { fetchAllCustomers } from '../../services/adminService';
import { CUSTOMER_SORTS, filterCustomers, isCustomerSort, sortCustomers } from '../../utils/customers';
import { formatDate, formatPrice } from '../../utils/format';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';

/**
 * Список покупателей: профили users/{uid} + статистика по их заказам.
 * Поиск (?q=) и сортировка (?sort=) хранятся в адресе, поэтому сохраняются после «Назад» из карточки.
 * Поиск и сортировка — в браузере: все покупатели уже загружены, индексы Firestore не нужны.
 */
export default function AdminCustomersPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage;
  const [customers, setCustomers] = useState(null); // null — загрузка
  const [error, setError] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get('q') || '';
  const sortParam = searchParams.get('sort');
  const sort = isCustomerSort(sortParam) ? sortParam : CUSTOMER_SORTS[0];
  useDocumentTitle(`${t('admin.nav.customers')} — ${t('admin.title')}`);

  const load = useCallback(() => {
    let cancelled = false;
    setError(null);
    setCustomers(null);
    fetchAllCustomers()
      .then((list) => !cancelled && setCustomers(list))
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

  const visible = useMemo(
    () => (customers ? sortCustomers(filterCustomers(customers, query), sort, lang) : []),
    [customers, query, sort, lang],
  );

  return (
    <>
      <div className="admin-page__head admin-page__head--row">
        <div>
          <h1>{t('admin.nav.customers')}</h1>
          <p>{t('admin.customers.subtitle')}</p>
        </div>
        <button type="button" className="btn btn--outline btn--sm" onClick={load} disabled={!customers && !error}>
          <Icon name="refresh" size={16} /> {t('admin.customers.refresh')}
        </button>
      </div>

      <div className="admin-toolbar">
        <label className="admin-toolbar__search">
          <span className="visually-hidden">{t('admin.customers.searchLabel')}</span>
          <Icon name="search" size={16} />
          <input
            type="search"
            className="field__control"
            placeholder={t('admin.customers.searchPlaceholder')}
            value={query}
            onChange={(e) => setParam('q', e.target.value)}
          />
        </label>
        <label className="admin-toolbar__sort">
          <span>{t('admin.customers.sortLabel')}</span>
          <select className="field__control" value={sort} onChange={(e) => setParam('sort', e.target.value, CUSTOMER_SORTS[0])}>
            {CUSTOMER_SORTS.map((s) => (
              <option key={s} value={s}>
                {t(`admin.customers.sort.${s}`)}
              </option>
            ))}
          </select>
        </label>
        {customers && (
          <span className="admin-toolbar__count">{t('admin.customers.found', { count: visible.length, total: customers.length })}</span>
        )}
      </div>

      {error && <ErrorMessage message={t(`admin.customers.errors.${error}`, t('admin.customers.errors.failed'))} onRetry={load} />}
      {!error && !customers && <LoadingSpinner />}
      {customers && visible.length === 0 && (
        <EmptyState
          icon={query ? 'search' : 'user'}
          title={query ? t('admin.customers.emptySearch') : t('admin.customers.empty')}
        />
      )}

      {visible.length > 0 && (
        <div className="admin-table-wrap card">
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">{t('admin.customers.name')}</th>
                <th scope="col">{t('admin.customers.registered')}</th>
                <th scope="col">{t('admin.customers.ordersCount')}</th>
                <th scope="col">{t('admin.customers.spent')}</th>
                <th scope="col">{t('admin.customers.lastOrder')}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => (
                <tr key={c.uid}>
                  <td data-label={t('admin.customers.name')}>
                    <div>
                      <Link to={`/admin/customers/${c.uid}`} className="admin-table__link">
                        {c.name || t('admin.customers.noName')}
                      </Link>
                      <small>{c.email || '—'}</small>
                    </div>
                  </td>
                  <td data-label={t('admin.customers.registered')}>
                    {c.createdAt && formatDate(c.createdAt, lang)}
                    {!c.createdAt && c.hasProfile && '—'}
                    {!c.hasProfile && (
                      <span className="admin-badge" title={t('admin.customers.noProfileHint')}>
                        {t('admin.customers.noProfile')}
                      </span>
                    )}
                  </td>
                  <td data-label={t('admin.customers.ordersCount')}>{c.ordersCount}</td>
                  <td data-label={t('admin.customers.spent')}>
                    <strong>{formatPrice(c.totalSpent)}</strong>
                  </td>
                  <td data-label={t('admin.customers.lastOrder')}>{c.lastOrderAt ? formatDate(c.lastOrderAt, lang) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
