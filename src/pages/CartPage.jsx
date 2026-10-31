import { Link } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import PageHeader from '../components/common/PageHeader';
import CartItem from '../components/cart/CartItem';
import CartSummary from '../components/cart/CartSummary';
import EmptyState from '../components/common/EmptyState';
import LoadingSpinner from '../components/common/LoadingSpinner';
import Icon from '../components/common/Icon';
import { clearCart, selectCartItems } from '../features/cart/cartSlice';
import { selectProductsStatus } from '../features/products/productsSlice';
import { notify } from '../features/notifications/notificationsSlice';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

export default function CartPage() {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const items = useSelector(selectCartItems);
  const status = useSelector(selectProductsStatus);
  useDocumentTitle(t('cart.title'));

  const handleClear = () => {
    if (window.confirm(t('cart.clearConfirm'))) {
      dispatch(clearCart());
      dispatch(notify({ type: 'info', message: 'notify.cartCleared' }));
    }
  };

  return (
    <>
      <PageHeader title={t('cart.title')} crumbs={[{ label: t('cart.title') }]} />
      <div className="container section--tight">
        {status !== 'succeeded' ? (
          <LoadingSpinner />
        ) : items.length === 0 ? (
          <EmptyState
            icon="cart"
            title={t('cart.emptyTitle')}
            text={t('cart.emptyText')}
            actionLabel={t('cart.goToCatalog')}
            actionTo="/catalog"
          />
        ) : (
          <div className="cart-layout">
            <section aria-label={t('cart.items')}>
              <ul className="cart-list">
                {items.map((item) => (
                  <CartItem key={item.key} item={item} />
                ))}
              </ul>
              <div className="cart-layout__actions">
                <Link to="/catalog" className="btn btn--ghost">
                  <Icon name="arrowLeft" size={16} /> {t('cart.continue')}
                </Link>
                <button type="button" className="btn btn--ghost btn--danger" onClick={handleClear}>
                  <Icon name="trash" size={16} /> {t('cart.clear')}
                </button>
              </div>
            </section>
            <CartSummary />
          </div>
        )}
      </div>
    </>
  );
}
