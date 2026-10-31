import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import RatingStars from '../common/RatingStars';
import AvailabilityBadge from './AvailabilityBadge';
import VolumeSelector from './VolumeSelector';
import QuantitySelector from './QuantitySelector';
import FavoriteButton from './FavoriteButton';
import NotesPyramid from './NotesPyramid';
import Icon from '../common/Icon';
import { useShopActions } from '../../hooks/useShopActions';
import { MAX_QUANTITY } from '../../features/cart/cartSlice';
import { formatPrice, localized } from '../../utils/format';

/**
 * Информация о товаре: бренд, название, рейтинг, цена, объём, концентрация,
 * описание, ноты, наличие, выбор объёма и количества, кнопки действий.
 * Выбранный объём и количество — локальное состояние (useState):
 * они нужны только этому компоненту, поэтому в Redux их не кладём.
 */
export default function ProductInfo({ product }) {
  const { t, i18n } = useTranslation();
  const { addProductToCart } = useShopActions();
  const [volume, setVolume] = useState(product.volume);
  const [quantity, setQuantity] = useState(1);

  const variant = product.volumes.find((v) => v.ml === volume) || product.volumes[0];
  const outOfStock = product.availability === 'outOfStock';

  const handleAdd = () => {
    addProductToCart(product, volume, quantity);
    setQuantity(1);
  };

  return (
    <div className="product-info">
      <p className="product-info__brand">{product.brand}</p>
      <h1 className="product-info__name">{product.name}</h1>
      <div className="product-info__row">
        <RatingStars value={product.rating} />
        <span className="product-info__demo-note">{t('product.demoRating')}</span>
      </div>

      <p className="product-info__price">
        {formatPrice(variant.price)}
        <small>
          {' '}
          / {variant.ml} {t('product.ml')}
        </small>
      </p>

      <dl className="product-info__specs">
        <div>
          <dt>{t('product.concentration')}</dt>
          <dd>{t(`concentration.${product.concentration}`)}</dd>
        </div>
        <div>
          <dt>{t('product.family')}</dt>
          <dd>{t(`families.${product.fragranceFamily}`)}</dd>
        </div>
        <div>
          <dt>{t('product.category')}</dt>
          <dd>{t(`categories.${product.category}`)}</dd>
        </div>
        <div>
          <dt>{t('product.intensity')}</dt>
          <dd>{t(`intensity.${product.intensity}`)}</dd>
        </div>
        <div>
          <dt>{t('product.availability')}</dt>
          <dd>
            <AvailabilityBadge status={product.availability} />
          </dd>
        </div>
      </dl>

      <p className="product-info__description">{localized(product.description, i18n.resolvedLanguage)}</p>

      <VolumeSelector volumes={product.volumes} value={volume} onChange={setVolume} />

      <div className="product-info__buy">
        <QuantitySelector
          value={quantity}
          max={MAX_QUANTITY}
          onDecrease={() => setQuantity((q) => Math.max(1, q - 1))}
          onIncrease={() => setQuantity((q) => Math.min(MAX_QUANTITY, q + 1))}
        />
        <button type="button" className="btn btn--primary btn--lg" onClick={handleAdd} disabled={outOfStock}>
          <Icon name="cart" size={18} />
          {outOfStock ? t('availability.outOfStock') : `${t('product.addToCart')} · ${formatPrice(variant.price * quantity)}`}
        </button>
        <FavoriteButton product={product} variant="full" />
      </div>

      <ul className="product-info__perks">
        <li><Icon name="truck" size={18} /> {t('product.perkDelivery')}</li>
        <li><Icon name="gift" size={18} /> {t('product.perkGift')}</li>
        <li><Icon name="shield" size={18} /> {t('product.perkPayment')}</li>
      </ul>

      <section className="product-info__notes" aria-labelledby="notes-title">
        <h2 id="notes-title">{t('notes.title')}</h2>
        <NotesPyramid notes={product.notes} />
      </section>
    </div>
  );
}
