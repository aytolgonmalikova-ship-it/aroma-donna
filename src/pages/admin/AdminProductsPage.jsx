import { useCallback, useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import Icon from '../../components/common/Icon';
import ErrorMessage from '../../components/common/ErrorMessage';
import { products as demoProducts } from '../../data/products';
import { fetchProducts, selectProducts, selectProductsSource, selectProductsStatus } from '../../features/products/productsSlice';
import { notify } from '../../features/notifications/notificationsSlice';
import { fetchProductsCount, importDemoCatalog } from '../../services/adminService';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';

/**
 * Раздел «Товары», этап 5а: откуда витрина берёт каталог и первичный импорт
 * демо-каталога в Firestore. Список и редактирование товаров — этап 5б.
 *
 * Кнопка импорта показывается, только когда сервер подтвердил, что коллекция products пуста.
 * Повторную проверку и защиту от дубликатов делает сам importDemoCatalog (транзакция).
 */
export default function AdminProductsPage() {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const storefront = useSelector(selectProducts);
  const status = useSelector(selectProductsStatus);
  const source = useSelector(selectProductsSource);
  const [count, setCount] = useState(null); // null — загрузка; число — товаров в Firestore
  const [countError, setCountError] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState(null);
  useDocumentTitle(`${t('admin.nav.products')} — ${t('admin.title')}`);

  const loadCount = useCallback(() => {
    let cancelled = false;
    setCount(null);
    setCountError(null);
    fetchProductsCount()
      .then((n) => !cancelled && setCount(n))
      .catch((err) => !cancelled && setCountError(err.code || 'failed'));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => loadCount(), [loadCount]);

  const handleImport = async () => {
    if (!window.confirm(t('admin.products.importConfirm', { count: demoProducts.length }))) return;
    setImporting(true);
    setImportError(null);
    try {
      const imported = await importDemoCatalog(demoProducts);
      dispatch(notify({ message: 'admin.products.imported', params: { count: imported } }));
      // Витрина сразу переходит на товары из Firestore
      dispatch(fetchProducts());
      loadCount();
    } catch (err) {
      setImportError(err.code || 'failed');
      // Коллекция оказалась не пустой — обновляем счётчик, кнопка исчезнет
      if (err.code === 'not-empty') loadCount();
    } finally {
      setImporting(false);
    }
  };

  const sourceText =
    status === 'failed'
      ? t('admin.products.source.failed')
      : status === 'succeeded'
        ? t(`admin.products.source.${source}`, { count: storefront.length })
        : '…';

  return (
    <>
      <div className="admin-page__head admin-page__head--row">
        <div>
          <h1>{t('admin.nav.products')}</h1>
          <p>{t('admin.products.subtitle')}</p>
        </div>
        <button type="button" className="btn btn--outline btn--sm" onClick={loadCount} disabled={count === null && !countError}>
          <Icon name="refresh" size={16} /> {t('admin.products.refresh')}
        </button>
      </div>

      <div className="admin-products">
        <section className="admin-panel card">
          <h2>{t('admin.products.catalogTitle')}</h2>
          <dl className="admin-dl">
            <div>
              <dt>{t('admin.products.storefront')}</dt>
              <dd>{sourceText}</dd>
            </div>
            <div>
              <dt>{t('admin.products.inFirestore')}</dt>
              <dd>{count === null ? (countError ? '—' : '…') : count}</dd>
            </div>
          </dl>
          {countError && <ErrorMessage message={t(`admin.products.errors.${countError}`)} onRetry={loadCount} />}
        </section>

        {count === 0 && (
          <section className="admin-panel card admin-import">
            <h2>{t('admin.products.importTitle')}</h2>
            <p>{t('admin.products.importText')}</p>
            <button type="button" className="btn btn--primary" onClick={handleImport} disabled={importing}>
              <Icon name="drop" size={18} />{' '}
              {importing ? t('admin.products.importing') : t('admin.products.importButton', { count: demoProducts.length })}
            </button>
            {importError && <ErrorMessage message={t(`admin.products.errors.${importError}`)} />}
          </section>
        )}
        {count > 0 && (
          <p className="admin-muted">
            {t('admin.products.importDone', { count })}
            {importError === 'not-empty' && ` ${t('admin.products.errors.not-empty')}`}
          </p>
        )}

        <p className="admin-muted">{t('admin.products.nextStage')}</p>
      </div>
    </>
  );
}
