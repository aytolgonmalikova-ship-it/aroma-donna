import { Link } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import ProductImage from '../common/ProductImage';
import QuantitySelector from '../products/QuantitySelector';
import Icon from '../common/Icon';
import { decreaseQuantity, increaseQuantity, removeFromCart, MAX_QUANTITY } from '../../features/cart/cartSlice';
import { notify } from '../../features/notifications/notificationsSlice';
import { formatPrice } from '../../utils/format';

/** Строка корзины: фото, название, объём, цена за штуку, количество, сумма, удаление */
export default function CartItem({ item }) {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const { product } = item;

  const handleRemove = () => {
    dispatch(removeFromCart(item.key));
    dispatch(notify({ type: 'info', message: 'notify.removedFromCart', params: { name: product.name } }));
  };

  return (
    <li className="cart-item">
      <Link to={`/product/${product.id}`} className="cart-item__image">
        <ProductImage src={product.image} alt={product.name} />
      </Link>
      <div className="cart-item__info">
        <p className="cart-item__brand">{product.brand}</p>
        <h3 className="cart-item__name">
          <Link to={`/product/${product.id}`}>{product.name}</Link>
        </h3>
        <p className="cart-item__meta">
          {item.volume} {t('product.ml')} · {t(`concentration.${product.concentration}`)}
        </p>
        <p className="cart-item__unit">
          {formatPrice(item.price)} {t('cart.perItem')}
        </p>
      </div>
      <div className="cart-item__controls">
        <QuantitySelector
          size="sm"
          value={item.quantity}
          max={MAX_QUANTITY}
          onDecrease={() => dispatch(decreaseQuantity(item.key))}
          onIncrease={() => dispatch(increaseQuantity(item.key))}
          label={`${t('cart.quantity')}: ${product.name}`}
        />
        <p className="cart-item__total">{formatPrice(item.lineTotal)}</p>
        <button
          type="button"
          className="icon-btn cart-item__remove"
          onClick={handleRemove}
          aria-label={`${t('cart.remove')}: ${product.name}`}
          title={t('cart.remove')}
        >
          <Icon name="trash" size={18} />
        </button>
      </div>
    </li>
  );
}
