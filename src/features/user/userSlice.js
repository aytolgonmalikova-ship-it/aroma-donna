import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import * as authService from '../../services/authService';

/**
 * Пользователь. Вся работа с Firebase / демо-режимом спрятана в services/authService.js,
 * а здесь — только состояние для интерфейса.
 * Ошибки возвращаются как ключи перевода (например 'auth.emailInUse').
 */

export const registerUser = createAsyncThunk('user/register', async (data, { rejectWithValue }) => {
  try {
    return await authService.register(data);
  } catch (error) {
    return rejectWithValue(authService.toErrorKey(error));
  }
});

export const loginUser = createAsyncThunk('user/login', async (data, { rejectWithValue }) => {
  try {
    return await authService.login(data);
  } catch (error) {
    return rejectWithValue(authService.toErrorKey(error));
  }
});

export const logoutUser = createAsyncThunk('user/logout', async () => {
  await authService.logout();
});

const userSlice = createSlice({
  name: 'user',
  initialState: {
    current: null, // { uid, name, email, createdAt }
    initialized: false, // true, когда проверили сохранённую сессию
    status: 'idle', // 'idle' | 'loading'
    error: null,
    mode: authService.AUTH_MODE, // 'firebase' | 'demo'
  },
  reducers: {
    setUser(state, action) {
      state.current = action.payload;
      state.initialized = true;
    },
    clearAuthError(state) {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    const pending = (state) => {
      state.status = 'loading';
      state.error = null;
    };
    const fulfilled = (state, action) => {
      state.status = 'idle';
      state.current = action.payload;
    };
    const rejected = (state, action) => {
      state.status = 'idle';
      state.error = action.payload;
    };
    builder
      .addCase(registerUser.pending, pending)
      .addCase(registerUser.fulfilled, fulfilled)
      .addCase(registerUser.rejected, rejected)
      .addCase(loginUser.pending, pending)
      .addCase(loginUser.fulfilled, fulfilled)
      .addCase(loginUser.rejected, rejected)
      .addCase(logoutUser.fulfilled, (state) => {
        state.current = null;
      });
  },
});

export const { setUser, clearAuthError } = userSlice.actions;
export default userSlice.reducer;

export const selectUser = (state) => state.user.current;
export const selectAuthState = (state) => state.user;
