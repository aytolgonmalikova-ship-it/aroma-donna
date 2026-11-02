import { createSlice, createSelector } from '@reduxjs/toolkit';
import { calcDiscount } from '../../utils/promo';
import { fetchProducts } from '../products/productsSlice';
import {
  MAX_QUANTITY,
  buildCartLines,
  changeItemVolume,
  countCartItems,
  hasUnavailableLines,
  makeKey,
  pruneCartItems,
} from '../../utils/cart';

/**
 * Корзина.
 * В состоянии храним только id товара, выбранный объём и количество.
 * Название, картинку и цену берём из каталога — так данные не дублируются
 * и цена всегда актуальна (единый источник правды).
 * Сопоставление с каталогом — чистые функции в utils/cart.js.
 */

export { MAX_QUANTITY };

const initialState = {
  items: [], // [{ key, id, volume, quantity }]
  promoCode: null, // применённый демо-промокод, например 'AROMA10'
  usedPromoCodes: [], // одноразовые коды, уже использованные в оформленных заказах
};

const cartSlice = createSlice({
  name: 'cart',
  initialState,
  reducers: {
    addToCart(state, action) {
      const { id, volume, quantity = 1 } = action.payload;
      const key = makeKey(id, volume);
      const existing = state.items.find((item) => item.key === key);
      if (existing) {
        existing.quantity = Math.min(existing.quantity + quantity, MAX_QUANTITY);
      } else {
        state.items.push({ key, id, volume, quantity: Math.min(quantity, MAX_QUANTITY) });
      }
    },
    removeFromCart(state, action) {
      state.items = state.items.filter((item) => item.key !== action.payload);
      if (state.items.length === 0) state.promoCode = null;
    },
    increaseQuantity(state, action) {
      const item = state.items.find((i) => i.key === action.payload);
      if (item && item.quantity < MAX_QUANTITY) item.quantity += 1;
    },
    decreaseQuantity(state, action) {
      const item = state.items.find((i) => i.key === action.payload);
      if (item && item.quantity > 1) item.quantity -= 1;
    },
    setQuantity(state, action) {
      const { key, quantity } = action.payload;
      const item = state.items.find((i) => i.key === key);
      if (item) item.quantity = Math.max(1, Math.min(MAX_QUANTITY, Number(quantity) || 1));
    },
    // Выбрать другой объём (например, если прежнего объёма больше нет в каталоге)
    changeCartItemVolume(state, action) {
      const { key, volume } = action.payload;
      state.items = changeItemVolume(state.items, key, volume);
    },
    clearCart(state) {
      state.items = [];
      state.promoCode = null;
    },
    applyPromoCode(state, action) {
      state.promoCode = action.payload;
    },
    removePromoCode(state) {
      state.promoCode = null;
    },
    markPromoCodeUsed(state, action) {
      if (!state.usedPromoCodes.includes(action.payload)) {
        state.usedPromoCodes.push(action.payload);
      }
    },
  },
  extraReducers: (builder) => {
    // Каталог загружен — убираем из корзины (и из localStorage) товары, которых в нём больше нет.
    // При ошибке загрузки ничего не трогаем: по ошибке нельзя судить, что товар удалён.
    builder.addCase(fetchProducts.fulfilled, (state, action) => {
      const kept = pruneCartItems(state.items, action.payload.items);
      if (kept === state.items) return;
      state.items = kept;
      if (kept.length === 0) state.promoCode = null;
    });
  },
});

export const {
  addToCart,
  removeFromCart,
  increaseQuantity,
  decreaseQuantity,
  setQuantity,
  changeCartItemVolume,
  clearCart,
  applyPromoCode,
  removePromoCode,
  markPromoCodeUsed,
} = cartSlice.actions;

export default cartSlice.reducer;

// ---------- Селекторы (вычисляемые данные) ----------

const selectCartState = (state) => state.cart;
const selectRawItems = (state) => state.cart.items;
/** Записи корзины как есть ({ key, id, volume, quantity }) — для проверки перед оформлением заказа */
export const selectCartEntries = selectRawItems;
const selectCatalog = (state) => state.products.items;
const selectCatalogLoaded = (state) => state.products.status === 'succeeded';

/**
 * Позиции корзины, дополненные данными товара из каталога.
 * Позиция с недоступным объёмом остаётся с volumeAvailable: false и без цены —
 * цена другого объёма не подставляется.
 */
export const selectCartItems = createSelector([selectRawItems, selectCatalog], buildCartLines);

/** Есть позиции, которые нельзя оформить: оформление заказа блокируется */
export const selectCartHasUnavailable = createSelector([selectCartItems], hasUnavailableLines);

/** Количество штук в корзине — для значка в шапке (только товары из загруженного каталога) */
export const selectCartCount = createSelector([selectRawItems, selectCatalog, selectCatalogLoaded], countCartItems);

export const selectCartSubtotal = createSelector([selectCartItems], (items) =>
  items.reduce((sum, item) => sum + item.lineTotal, 0),
);

export const selectCartTotals = createSelector(
  [selectCartSubtotal, selectCartState],
  (subtotal, cart) => {
    const discount = calcDiscount(subtotal, cart.promoCode);
    return { subtotal, discount, total: subtotal - discount, promoCode: cart.promoCode };
  },
);

export const selectUsedPromoCodes = (state) => state.cart.usedPromoCodes;
