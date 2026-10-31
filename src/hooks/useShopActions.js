import { useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { addToCart } from '../features/cart/cartSlice';
import { toggleFavorite, selectFavoriteIds } from '../features/favorites/favoritesSlice';
import { notify } from '../features/notifications/notificationsSlice';

/**
 * Собственный хук: действия «в корзину» и «в избранное» вместе с уведомлением.
 * Используется в карточке товара, на странице товара, в избранном и в квизе —
 * без хука эту логику пришлось бы копировать в каждый компонент.
 */
export function useShopActions() {
  const dispatch = useDispatch();
  const favoriteIds = useSelector(selectFavoriteIds);

  const addProductToCart = useCallback(
    (product, volume = product.volume, quantity = 1) => {
      if (product.availability === 'outOfStock') {
        dispatch(notify({ type: 'error', message: 'notify.outOfStock', params: { name: product.name } }));
        return;
      }
      dispatch(addToCart({ id: product.id, volume, quantity }));
      dispatch(notify({ message: 'notify.addedToCart', params: { name: product.name, volume } }));
    },
    [dispatch],
  );

  const toggleProductFavorite = useCallback(
    (product) => {
      const wasFavorite = favoriteIds.includes(product.id);
      dispatch(toggleFavorite(product.id));
      dispatch(
        notify({
          type: wasFavorite ? 'info' : 'success',
          message: wasFavorite ? 'notify.removedFromFavorites' : 'notify.addedToFavorites',
          params: { name: product.name },
        }),
      );
    },
    [dispatch, favoriteIds],
  );

  return { addProductToCart, toggleProductFavorite, favoriteIds };
}
