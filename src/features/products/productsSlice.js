import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { fetchProductsApi } from '../../services/productsApi';

/**
 * Товары. Загружаются асинхронно через createAsyncThunk —
 * так же, как это было бы с настоящим сервером (pending → fulfilled / rejected).
 * Сейчас «сервер» — локальный файл src/data/products.js (см. services/productsApi.js).
 */
export const fetchProducts = createAsyncThunk('products/fetchAll', async (_, { rejectWithValue }) => {
  try {
    return await fetchProductsApi();
  } catch (error) {
    return rejectWithValue(error.message || 'loadError');
  }
});

const productsSlice = createSlice({
  name: 'products',
  initialState: {
    items: [],
    status: 'idle', // 'idle' | 'loading' | 'succeeded' | 'failed'
    error: null,
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
        state.items = action.payload;
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
export const selectProductById = (id) => (state) => state.products.items.find((p) => p.id === id);
