import { createSlice, createAsyncThunk, createSelector } from '@reduxjs/toolkit';
import { fetchProductsApi } from '../../services/productsApi';
import { getBrands, getPriceLimits } from '../../utils/products';

/**
 * Товары. Загружаются асинхронно через createAsyncThunk (pending → fulfilled / rejected)
 * из коллекции Firestore products; если Firebase не подключён или коллекция пуста —
 * из резервного файла src/data/products.js (см. services/productsApi.js).
 * source — откуда взят каталог: 'firestore' | 'fallback' | 'demo'.
 */
export const fetchProducts = createAsyncThunk('products/fetchAll', async (_, { rejectWithValue }) => {
  try {
    return await fetchProductsApi();
  } catch (error) {
    // Код Firestore (permission-denied, unavailable…) — чтобы ошибку можно было отличить
    return rejectWithValue(error.code || error.message || 'loadError');
  }
});

const productsSlice = createSlice({
  name: 'products',
  initialState: {
    items: [],
    status: 'idle', // 'idle' | 'loading' | 'succeeded' | 'failed'
    error: null,
    source: null,
  },
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchProducts.pending, (state) => {
        state.status = 'loading';
        state.error = null;
      })
      .addCase(fetchProducts.fulfilled, (state, action) => {
        state.status = 'succeeded';
        state.items = action.payload.items;
        state.source = action.payload.source;
      })
      .addCase(fetchProducts.rejected, (state, action) => {
        state.status = 'failed';
        state.error = action.payload;
      });
  },
});

export default productsSlice.reducer;

export const selectProducts = (state) => state.products.items;
export const selectProductsStatus = (state) => state.products.status;
export const selectProductsSource = (state) => state.products.source;
export const selectProductById = (id) => (state) => state.products.items.find((p) => p.id === id);

// Бренды и диапазон цен — из загруженного каталога (раньше — константы BRANDS и PRICE_LIMITS)
export const selectBrands = createSelector([selectProducts], getBrands);
export const selectPriceLimits = createSelector([selectProducts], getPriceLimits);
