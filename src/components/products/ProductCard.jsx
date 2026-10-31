import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ProductImage from '../common/ProductImage';
import RatingStars from '../common/RatingStars';
import FavoriteButton from './FavoriteButton';
import { useShopActions } from '../../hooks/useShopActions';
import { formatPrice } from '../../utils/format';
import Icon from '../common/Icon';

/** Карточка товара в каталоге и подборках */
export default function ProductCard({ product }) {
  const { t } = useTranslation();
  const { addProductToCart } = useShopActions();
  const outOfStock = product.availability === 'outOfStock';

  return (
    <article className={`product-card ${outOfStock ? 'is-out' : ''}`}>
      <Link to={`/product/${product.id}`} className="product-card__media" aria-label={product.name}>
        <ProductImage src={product.image} alt={`${product.brand} ${product.name}`} />
        <div className="product-card__labels">
          {product.isNew && <span className="label label--new">{t('product.new')}</span>}
          {product.isBestseller && <span className="label label--hit">{t('product.bestseller')}</span>}
          {outOfStock && <span className="label label--out">{t('availability.outOfStock')}</span>}
        </div>
      </Link>
      <div className="product-card__fav">
        <FavoriteButton product={product} />
      </div>
      <div className="product-card__body">
        <p className="product-card__brand">{product.brand}</p>
        <h3 className="product-card__name">
          <Link to={`/product/${product.id}`}>{product.name}</Link>
        </h3>
        <p className="product-card__meta">
          {t(`concentration.${product.concentration}`)} · {t(`families.${product.fragranceFamily}`)}
        </p>
        <RatingStars value={product.rating} />
        <div className="product-card__footer">
          <p className="product-card__price">
            <span className="product-card__from">{t('product.from')}</span> {formatPrice(product.price)}
            <small> / {product.volume} {t('product.ml')}</small>
          </p>
          <button
            type="button"
            className="btn btn--primary btn--icon"
            onClick={() => addProductToCart(product)}
            disabled={outOfStock}
            aria-label={`${t('product.addToCart')}: ${product.name}`}
            title={outOfStock ? t('availability.outOfStock') : t('product.addToCart')}
          >
            <Icon name="cart" size={18} />
          </button>
        </div>
      </div>
    </article>
  );
}
