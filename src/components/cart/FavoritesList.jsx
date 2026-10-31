import { Link } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import ProductImage from '../common/ProductImage';
import AvailabilityBadge from '../products/AvailabilityBadge';
import Icon from '../common/Icon';
import { removeFavorite } from '../../features/favorites/favoritesSlice';
import { notify } from '../../features/notifications/notificationsSlice';
import { useShopActions } from '../../hooks/useShopActions';
import { formatPrice, localized } from '../../utils/format';

/** Список избранных товаров с кнопками «В корзину» и «Удалить» */
export default function FavoritesList({ products }) {
  const { t, i18n } = useTranslation();
  const dispatch = useDispatch();
  const { addProductToCart } = useShopActions();

  const handleRemove = (product) => {
    dispatch(removeFavorite(product.id));
    dispatch(notify({ type: 'info', message: 'notify.removedFromFavorites', params: { name: product.name } }));
  };

  return (
    <ul className="favorites-list">
      {products.map((product) => (
        <li key={product.id} className="favorite-row">
          <Link to={`/product/${product.id}`} className="favorite-row__image">
            <ProductImage src={product.image} alt={product.name} />
          </Link>
          <div className="favorite-row__info">
            <p className="cart-item__brand">{product.brand}</p>
            <h3 className="cart-item__name">
              <Link to={`/product/${product.id}`}>{product.name}</Link>
            </h3>
            <p className="favorite-row__desc">{localized(product.description, i18n.resolvedLanguage)}</p>
            <AvailabilityBadge status={product.availability} />
          </div>
          <div className="favorite-row__actions">
            <p className="favorite-row__price">
              {t('product.from')} {formatPrice(product.price)}
            </p>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={() => addProductToCart(product)}
              disabled={product.availability === 'outOfStock'}
            >
              <Icon name="cart" size={16} /> {t('product.addToCart')}
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => handleRemove(product)}>
              <Icon name="trash" size={16} /> {t('favorites.removeShort')}
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
