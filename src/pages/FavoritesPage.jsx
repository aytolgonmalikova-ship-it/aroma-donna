import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import PageHeader from '../components/common/PageHeader';
import FavoritesList from '../components/cart/FavoritesList';
import EmptyState from '../components/common/EmptyState';
import LoadingSpinner from '../components/common/LoadingSpinner';
import CatalogLoadError from '../components/common/CatalogLoadError';
import { clearFavorites, selectFavoriteProducts } from '../features/favorites/favoritesSlice';
import { selectProductsStatus } from '../features/products/productsSlice';
import { notify } from '../features/notifications/notificationsSlice';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { catalogView } from '../utils/catalogStatus';

export default function FavoritesPage() {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const products = useSelector(selectFavoriteProducts);
  const view = catalogView(useSelector(selectProductsStatus));
  useDocumentTitle(t('favorites.title'));

  return (
    <>
      <PageHeader
        title={t('favorites.title')}
        subtitle={products.length ? t('favorites.count', { count: products.length }) : null}
        crumbs={[{ label: t('favorites.title') }]}
      />
      <div className="container section--tight">
        {view === 'loading' ? (
          <LoadingSpinner />
        ) : view === 'error' ? (
          <CatalogLoadError />
        ) : products.length === 0 ? (
          <EmptyState
            icon="heart"
            title={t('favorites.emptyTitle')}
            text={t('favorites.emptyText')}
            actionLabel={t('cart.goToCatalog')}
            actionTo="/catalog"
          />
        ) : (
          <>
            <FavoritesList products={products} />
            <button
              type="button"
              className="btn btn--ghost btn--danger"
              onClick={() => {
                dispatch(clearFavorites());
                dispatch(notify({ type: 'info', message: 'notify.favoritesCleared' }));
              }}
            >
              {t('favorites.clear')}
            </button>
          </>
        )}
      </div>
    </>
  );
}
