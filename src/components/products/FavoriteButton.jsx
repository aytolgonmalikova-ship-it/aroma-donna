import { useTranslation } from 'react-i18next';
import { useShopActions } from '../../hooks/useShopActions';
import Icon from '../common/Icon';

/**
 * Кнопка «сердечко». Состояние берётся из Redux (favorites.ids),
 * поэтому одинаково отображается во всех местах интерфейса.
 */
export default function FavoriteButton({ product, variant = 'icon' }) {
  const { t } = useTranslation();
  const { toggleProductFavorite, favoriteIds } = useShopActions();
  const active = favoriteIds.includes(product.id);
  const label = active ? t('favorites.remove') : t('favorites.add');

  return (
    <button
      type="button"
      className={`fav-btn fav-btn--${variant} ${active ? 'is-active' : ''}`}
      onClick={(e) => {
        e.preventDefault(); // кнопка внутри карточки-ссылки — не переходим по ссылке
        toggleProductFavorite(product);
      }}
      aria-pressed={active}
      aria-label={`${label}: ${product.name}`}
      title={label}
    >
      <Icon name="heart" filled={active} size={variant === 'icon' ? 20 : 18} />
      {variant === 'full' && <span>{active ? t('favorites.inFavorites') : t('favorites.add')}</span>}
    </button>
  );
}
