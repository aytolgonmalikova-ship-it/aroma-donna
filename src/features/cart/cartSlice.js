import { createSlice, createSelector } from '@reduxjs/toolkit';
import { calcDiscount } from '../../utils/promo';

/**
 * Корзина.
 * В состоянии храним только id товара, выбранный объём и количество.
 * Название, картинку и цену берём из каталога — так данные не дублируются
 * и цена всегда актуальна (единый источник правды).
 */

export const MAX_QUANTITY = 10;

const makeKey = (id, volume) => `${id}__${volume}`;

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
});

export const {
  addToCart,
  removeFromCart,
  increaseQuantity,
  decreaseQuantity,
  setQuantity,
  clearCart,
  applyPromoCode,
  removePromoCode,
  markPromoCodeUsed,
} = cartSlice.actions;

export default cartSlice.reducer;

// ---------- Селекторы (вычисляемые данные) ----------

const selectCartState = (state) => state.cart;
const selectRawItems = (state) => state.cart.items;
const selectCatalog = (state) => state.products.items;

/** Позиции корзины, дополненные данными товара из каталога */
export const selectCartItems = createSelector([selectRawItems, selectCatalog], (items, catalog) =>
  items
    .map((item) => {
      const product = catalog.find((p) => p.id === item.id);
      if (!product) return null;
      const variant = product.volumes.find((v) => v.ml === item.volume) || product.volumes[0];
      return {
        ...item,
        product,
        price: variant.price,
        lineTotal: variant.price * item.quantity,
      };
    })
    .filter(Boolean),
);

/** Количество штук в корзине — для значка в шапке */
export const selectCartCount = createSelector([selectRawItems], (items) =>
  items.reduce((sum, item) => sum + item.quantity, 0),
);

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
