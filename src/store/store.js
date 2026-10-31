import { configureStore } from '@reduxjs/toolkit';
import cartReducer from '../features/cart/cartSlice';
import favoritesReducer from '../features/favorites/favoritesSlice';
import productsReducer from '../features/products/productsSlice';
import userReducer from '../features/user/userSlice';
import notificationsReducer from '../features/notifications/notificationsSlice';
import { loadFromStorage, saveToStorage, STORAGE_KEYS } from '../utils/storage';

/**
 * Глобальное хранилище Redux.
 * Корзина и избранное восстанавливаются из localStorage при запуске
 * и сохраняются туда при каждом изменении (подписка store.subscribe ниже).
 */

const savedCart = loadFromStorage(STORAGE_KEYS.cart, null);
const savedFavorites = loadFromStorage(STORAGE_KEYS.favorites, []);

const preloadedState = {
  cart: {
    items: Array.isArray(savedCart?.items) ? savedCart.items : [],
    promoCode: savedCart?.promoCode ?? null,
    usedPromoCodes: loadFromStorage(STORAGE_KEYS.usedPromoCodes, []),
  },
  favorites: { ids: Array.isArray(savedFavorites) ? savedFavorites : [] },
};

export const store = configureStore({
  reducer: {
    cart: cartReducer,
    favorites: favoritesReducer,
    products: productsReducer,
    user: userReducer,
    notifications: notificationsReducer,
  },
  preloadedState,
});

// Сохраняем только когда соответствующая часть состояния реально изменилась
let prevCart = store.getState().cart;
let prevFavorites = store.getState().favorites;

store.subscribe(() => {
  const { cart, favorites } = store.getState();
  if (cart !== prevCart) {
    prevCart = cart;
    saveToStorage(STORAGE_KEYS.cart, { items: cart.items, promoCode: cart.promoCode });
    saveToStorage(STORAGE_KEYS.usedPromoCodes, cart.usedPromoCodes);
  }
  if (favorites !== prevFavorites) {
    prevFavorites = favorites;
    saveToStorage(STORAGE_KEYS.favorites, favorites.ids);
  }
});
