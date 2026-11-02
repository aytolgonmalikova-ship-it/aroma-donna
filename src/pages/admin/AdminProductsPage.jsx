import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import Icon from '../../components/common/Icon';
import EmptyState from '../../components/common/EmptyState';
import ErrorMessage from '../../components/common/ErrorMessage';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import ProductImage from '../../components/common/ProductImage';
import AvailabilityBadge from '../../components/products/AvailabilityBadge';
import { CATEGORIES, FAMILIES, products as demoProducts } from '../../data/products';
import { fetchProducts, selectProducts, selectProductsSource, selectProductsStatus } from '../../features/products/productsSlice';
import { notify } from '../../features/notifications/notificationsSlice';
import { fetchAllProducts, fetchProductForEdit, importDemoCatalog, setProductHidden } from '../../services/adminService';
import { AVAILABILITIES } from '../../utils/products';
import {
  DEFAULT_PRODUCT_FILTERS,
  PRODUCT_SORTS,
  PRODUCT_VISIBILITIES,
  applyFetchedProduct,
  countActiveProductFilters,
  countProductVisibility,
  filterAdminProducts,
  hideBlockReason,
  parseProductListParams,
  sortAdminProducts,
  toProductListParams,
} from '../../utils/adminProducts';
import { formatDate, formatPrice } from '../../utils/format';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';

const editPath = (id) => `/admin/products/${id}/edit`;

/**
 * Раздел «Товары» (этап 5б): все товары из Firestore, включая скрытые, с поиском,
 * фильтрами и сортировкой. Параметры хранятся в адресе (?q=&gender=&family=&stock=&visibility=&sort=),
 * поэтому сохраняются после «Назад» из формы товара. Фильтрация — в браузере: индексы не нужны.
 *
 * Блок импорта демо-каталога (этап 5а) показывается, только когда коллекция products пуста.
 * Пока каталог не импортирован, создавать товары нельзя: первый же товар переключил бы витрину
 * с резервного каталога на Firestore, и покупатели увидели бы только его.
 *
 * Скрытие и возвращение на витрину (этап 5в): кнопка в строке вызывает setProductHidden с датой
 * updatedAt этой строки. После ответа строка перечитывается из Firestore — так у неё новая дата,
 * и следующее действие не получит conflict. Одновременно выполняется только одно действие.
 * Последний видимый товар скрыть нельзя: иначе витрина показала бы демо-каталог.
 * Окончательное удаление — на странице редактирования (подэтап 5в.4).
 */
export default function AdminProductsPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage;
  const dispatch = useDispatch();
  const storefront = useSelector(selectProducts);
  const storefrontStatus = useSelector(selectProductsStatus);
  const source = useSelector(selectProductsSource);
  const [data, setData] = useState(null); // null — загрузка; { products, invalidIds }
  const [error, setError] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState(null);
  const [busyId, setBusyId] = useState(null); // id товара, видимость которого сейчас меняется
  const [actionError, setActionError] = useState(null); // { name, code } — ошибка скрытия или показа
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => parseProductListParams(searchParams), [searchParams]);
  useDocumentTitle(`${t('admin.nav.products')} — ${t('admin.title')}`);

  const load = useCallback(() => {
    let cancelled = false;
    setError(null);
    setData(null);
    fetchAllProducts()
      .then((res) => !cancelled && setData(res))
      .catch((err) => !cancelled && setError(err.code || 'failed'));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => load(), [load]);

  const setFilters = (next) => setSearchParams(toProductListParams({ ...filters, ...next }), { replace: true });
  // Сброс поиска и фильтров; выбранная сортировка остаётся
  const resetFilters = () => setFilters({ ...DEFAULT_PRODUCT_FILTERS, sort: filters.sort });

  const visible = useMemo(
    () => (data ? sortAdminProducts(filterAdminProducts(data.products, filters), filters.sort, lang) : []),
    [data, filters, lang],
  );

  const counts = useMemo(() => countProductVisibility(data), [data]);
  const total = data ? counts.total : null;
  const collectionEmpty = total === 0;
  const hasFilters = countActiveProductFilters(filters) > 0 || filters.q.trim() !== '';
  const canAdd = Boolean(data) && !collectionEmpty;
  // Форма вернёт к списку с теми же поиском и фильтрами
  const linkState = { listSearch: searchParams.toString() };

  const handleImport = async () => {
    if (!window.confirm(t('admin.products.importConfirm', { count: demoProducts.length }))) return;
    setImporting(true);
    setImportError(null);
    try {
      const imported = await importDemoCatalog(demoProducts);
      dispatch(notify({ message: 'admin.products.imported', params: { count: imported } }));
      // Витрина сразу переходит на товары из Firestore
      dispatch(fetchProducts());
      load();
    } catch (err) {
      setImportError(err.code || 'failed');
      // Коллекция оказалась не пустой — перечитываем список, блок импорта исчезнет
      if (err.code === 'not-empty') load();
    } finally {
      setImporting(false);
    }
  };

  /**
   * Перечитать одну строку из Firestore. false — не удалось (например, нет сети):
   * тогда вызывающий перезагружает весь список, чтобы в строке не осталась старая дата.
   */
  const refreshRow = async (id) => {
    try {
      const fetched = await fetchProductForEdit(id);
      setData((d) => applyFetchedProduct(d, id, fetched));
      return true;
    } catch (err) {
      if (err.code !== 'not-found') return false;
      setData((d) => applyFetchedProduct(d, id, null));
      return true;
    }
  };

  const handleToggleHidden = async (product) => {
    if (busyId) return;
    const hidden = !product.hidden;
    setBusyId(product.id);
    setActionError(null);
    try {
      await setProductHidden(product.id, hidden, product.updatedAt);
      if (!(await refreshRow(product.id))) load();
      dispatch(
        notify({
          message: hidden ? 'admin.products.hiddenDone' : 'admin.products.shownDone',
          params: { name: product.name },
        }),
      );
      // Витрина в этой вкладке сразу видит изменение
      dispatch(fetchProducts());
    } catch (err) {
      const code = err.code || 'failed';
      setActionError({ name: product.name, code });
      if (code === 'last-visible') {
        // Сервер знает больше, чем список (другой товар скрыли в другом окне) — перечитываем всё
        load();
      } else if (code === 'conflict' || code === 'damaged' || code === 'not-found') {
        // Показываем актуальное состояние строки: новая дата, повреждён или удалён
        if (!(await refreshRow(product.id))) load();
      }
    } finally {
      setBusyId(null);
    }
  };

  // «Скрыть» или «Показать». Пока выполняется любое действие, все такие кнопки заблокированы;
  // последний видимый товар скрыть нельзя — кнопка заблокирована с объяснением
  const renderVisibilityButton = (p) => {
    const busy = busyId === p.id;
    const blocked = hideBlockReason(p, counts);
    const action = p.hidden ? 'show' : 'hide';
    const label = busy ? t(`admin.products.visibilityBusy.${action}`) : t(`admin.products.visibilityAction.${action}`);
    const blockedText = blocked ? t('admin.products.lastVisibleHint') : undefined;
    return (
      <button
        type="button"
        className={`btn btn--sm ${p.hidden ? 'btn--primary' : 'btn--ghost'}`}
        onClick={() => handleToggleHidden(p)}
        disabled={Boolean(busyId) || Boolean(blocked)}
        aria-busy={busy || undefined}
        aria-label={`${t(`admin.products.visibilityAction.${action}`)}: ${p.name}${blockedText ? `. ${blockedText}` : ''}`}
        title={blockedText}
      >
        {label}
      </button>
    );
  };

  const sourceText =
    storefrontStatus === 'failed'
      ? t('admin.products.source.failed')
      : storefrontStatus === 'succeeded'
        ? t(`admin.products.source.${source}`, { count: storefront.length })
        : '…';

  const select = (key, label, values, optionLabel, allLabel = t('admin.products.all')) => (
    <label className="admin-toolbar__sort">
      <span>{label}</span>
      <select className="field__control" value={filters[key]} onChange={(e) => setFilters({ [key]: e.target.value })}>
        {key !== 'sort' && <option value="">{allLabel}</option>}
        {values.map((v) => (
          <option key={v} value={v}>
            {optionLabel(v)}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <>
      <div className="admin-page__head admin-page__head--row">
        <div>
          <h1>{t('admin.nav.products')}</h1>
          <p>{t('admin.products.subtitle')}</p>
        </div>
        <div className="admin-page__actions">
          <button
            type="button"
            className="btn btn--outline btn--sm"
            onClick={() => {
              setActionError(null);
              load();
            }}
            disabled={(!data && !error) || Boolean(busyId)}
          >
            <Icon name="refresh" size={16} /> {t('admin.products.refresh')}
          </button>
          {canAdd ? (
            <Link to="/admin/products/new" state={linkState} className="btn btn--primary btn--sm">
              <Icon name="plus" size={16} /> {t('admin.products.add')}
            </Link>
          ) : (
            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled
              title={collectionEmpty ? t('admin.products.addDisabledHint') : undefined}
            >
              <Icon name="plus" size={16} /> {t('admin.products.add')}
            </button>
          )}
        </div>
      </div>

      <dl className="admin-dl admin-products__summary card">
        <div>
          <dt>{t('admin.products.storefront')}</dt>
          <dd>{sourceText}</dd>
        </div>
        <div>
          <dt>{t('admin.products.summary.total')}</dt>
          <dd>{total === null ? (error ? '—' : '…') : total}</dd>
        </div>
        {data && (
          <>
            <div>
              <dt>{t('admin.products.summary.visible')}</dt>
              <dd>{counts.visible}</dd>
            </div>
            <div>
              <dt>{t('admin.products.summary.hidden')}</dt>
              <dd>{counts.hidden}</dd>
            </div>
            {counts.damaged > 0 && (
              <div>
                <dt>{t('admin.products.summary.damaged')}</dt>
                <dd className="admin-products__damaged-count">{counts.damaged}</dd>
              </div>
            )}
          </>
        )}
      </dl>
      {data && counts.visible === 1 && <p className="admin-muted">{t('admin.products.lastVisibleHint')}</p>}

      {actionError && (
        <div className="admin-products__action-error" role="alert">
          <Icon name="alert" size={18} />
          <p>
            {t(`admin.products.visibilityErrors.${actionError.code}`, {
              name: actionError.name,
              defaultValue: t('admin.products.visibilityErrors.failed', { name: actionError.name }),
            })}
          </p>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setActionError(null)}
            aria-label={t('admin.products.closeMessage')}
            title={t('admin.products.closeMessage')}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      )}

      {error && <ErrorMessage message={t(`admin.products.errors.${error}`, t('admin.products.errors.failed'))} onRetry={load} />}
      {!error && !data && <LoadingSpinner />}

      {collectionEmpty && (
        <>
          <EmptyState icon="drop" title={t('admin.products.empty')} text={t('admin.products.addDisabledHint')} />
          <section className="admin-panel card admin-import">
            <h2>{t('admin.products.importTitle')}</h2>
            <p>{t('admin.products.importText')}</p>
            <button type="button" className="btn btn--primary" onClick={handleImport} disabled={importing}>
              <Icon name="drop" size={18} />{' '}
              {importing ? t('admin.products.importing') : t('admin.products.importButton', { count: demoProducts.length })}
            </button>
            {importError && <ErrorMessage message={t(`admin.products.errors.${importError}`, t('admin.products.errors.failed'))} />}
          </section>
        </>
      )}

      {data?.invalidIds.length > 0 && (
        <div className="admin-products__damaged" role="alert">
          <Icon name="alert" size={18} />
          <div>
            <strong>{t('admin.products.damagedTitle', { count: data.invalidIds.length })}</strong>
            <p>{t('admin.products.damagedText')}</p>
            <ul>
              {data.invalidIds.map((id) => (
                <li key={id}>
                  <Link to={editPath(id)} state={linkState}>
                    {id}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {data && !collectionEmpty && (
        <>
          <div className="admin-toolbar">
            <label className="admin-toolbar__search">
              <span className="visually-hidden">{t('admin.products.searchLabel')}</span>
              <Icon name="search" size={16} />
              <input
                type="search"
                className="field__control"
                placeholder={t('admin.products.searchPlaceholder')}
                value={filters.q}
                onChange={(e) => setFilters({ q: e.target.value })}
              />
            </label>
            {select('gender', t('admin.products.filterGender'), CATEGORIES, (v) => t(`categories.${v}`))}
            {select('family', t('admin.products.filterFamily'), FAMILIES, (v) => t(`families.${v}`))}
            {select('stock', t('admin.products.filterStock'), AVAILABILITIES, (v) => t(`availability.${v}`))}
            {select(
              'visibility',
              t('admin.products.filterVisibility'),
              PRODUCT_VISIBILITIES,
              (v) => t(`admin.products.visibility.${v}`),
              t('admin.products.visibility.all'),
            )}
            {select('sort', t('admin.products.sortLabel'), PRODUCT_SORTS, (v) => t(`admin.products.sort.${v}`))}
            {hasFilters && (
              <button type="button" className="btn btn--ghost btn--sm" onClick={resetFilters}>
                <Icon name="close" size={14} /> {t('admin.products.reset')}
              </button>
            )}
            <span className="admin-toolbar__count">
              {t('admin.products.found', { count: visible.length, total: data.products.length })}
            </span>
          </div>

          {visible.length === 0 && data.products.length > 0 && (
            <EmptyState
              icon="search"
              title={t('admin.products.emptyFiltered')}
              text={t('admin.products.emptyFilteredText')}
              actionLabel={t('admin.products.reset')}
              onAction={resetFilters}
            />
          )}

          {visible.length > 0 && (
            <div className="admin-table-wrap card">
              <table className="admin-table admin-products__table">
                <thead>
                  <tr>
                    <th scope="col">
                      <span className="visually-hidden">{t('admin.products.col.photo')}</span>
                    </th>
                    <th scope="col">{t('admin.products.col.name')}</th>
                    <th scope="col">{t('admin.products.col.brand')}</th>
                    <th scope="col">{t('admin.products.col.gender')}</th>
                    <th scope="col">{t('admin.products.col.family')}</th>
                    <th scope="col">{t('admin.products.col.price')}</th>
                    <th scope="col">{t('admin.products.col.availability')}</th>
                    <th scope="col">{t('admin.products.col.updated')}</th>
                    <th scope="col">
                      <span className="visually-hidden">{t('admin.products.col.actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((p) => (
                    <tr key={p.id} className={p.hidden ? 'is-hidden' : undefined}>
                      <td data-label={t('admin.products.col.photo')}>
                        <Link
                          to={editPath(p.id)}
                          state={linkState}
                          className="admin-products__thumb"
                          tabIndex={-1}
                          aria-hidden="true"
                        >
                          <ProductImage src={p.image} alt="" />
                        </Link>
                      </td>
                      <td data-label={t('admin.products.col.name')}>
                        <div>
                          <Link to={editPath(p.id)} state={linkState} className="admin-table__link">
                            {p.name}
                          </Link>
                          <small>{p.id}</small>
                          {p.hidden && (
                            <span className="admin-badge" title={t('admin.products.hiddenHint')}>
                              {t('admin.products.hidden')}
                            </span>
                          )}
                        </div>
                      </td>
                      <td data-label={t('admin.products.col.brand')}>{p.brand}</td>
                      <td data-label={t('admin.products.col.gender')}>{t(`categories.${p.category}`, p.category)}</td>
                      <td data-label={t('admin.products.col.family')}>{t(`families.${p.fragranceFamily}`, p.fragranceFamily)}</td>
                      <td data-label={t('admin.products.col.price')}>
                        <strong>{formatPrice(p.price)}</strong>
                        <small>{p.volumes.map((v) => v.ml).join(' / ')} {t('product.ml')}</small>
                      </td>
                      <td data-label={t('admin.products.col.availability')}>
                        <AvailabilityBadge status={p.availability} />
                      </td>
                      <td data-label={t('admin.products.col.updated')}>{p.updatedAt ? formatDate(p.updatedAt, lang) : '—'}</td>
                      <td data-label={t('admin.products.col.actions')}>
                        <div className="admin-products__actions">
                          <Link
                            to={editPath(p.id)}
                            state={linkState}
                            className="btn btn--outline btn--sm"
                            aria-label={t('admin.products.editLabel', { name: p.name })}
                          >
                            {t('admin.products.edit')}
                          </Link>
                          {renderVisibilityButton(p)}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
