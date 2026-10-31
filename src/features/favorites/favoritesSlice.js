import { createSlice, createSelector } from '@reduxjs/toolkit';

// Избранное: храним только список id товаров.
// Все кнопки «сердечко» читают этот список из Redux, поэтому их состояние
// автоматически синхронизировано в каталоге, на странице товара и в избранном.

const favoritesSlice = createSlice({
  name: 'favorites',
  initialState: { ids: [] },
  reducers: {
    toggleFavorite(state, action) {
      const id = action.payload;
      state.ids = state.ids.includes(id) ? state.ids.filter((x) => x !== id) : [...state.ids, id];
    },
    removeFavorite(state, action) {
      state.ids = state.ids.filter((x) => x !== action.payload);
    },
    clearFavorites(state) {
      state.ids = [];
    },
  },
});

export const { toggleFavorite, removeFavorite, clearFavorites } = favoritesSlice.actions;
export default favoritesSlice.reducer;

export const selectFavoriteIds = (state) => state.favorites.ids;
export const selectIsFavorite = (id) => (state) => state.favorites.ids.includes(id);

export const selectFavoriteProducts = createSelector(
  [selectFavoriteIds, (state) => state.products.items],
  (ids, catalog) => ids.map((id) => catalog.find((p) => p.id === id)).filter(Boolean),
);
