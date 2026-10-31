import { createSlice, nanoid } from '@reduxjs/toolkit';

/**
 * Всплывающие уведомления (toast).
 * В message хранится КЛЮЧ перевода, а не готовый текст —
 * поэтому уведомление показывается на текущем языке.
 */
const notificationsSlice = createSlice({
  name: 'notifications',
  initialState: { list: [] },
  reducers: {
    notify: {
      reducer(state, action) {
        state.list.push(action.payload);
        if (state.list.length > 4) state.list.shift(); // не больше 4 одновременно
      },
      prepare({ type = 'success', message, params = {} }) {
        return { payload: { id: nanoid(), type, message, params } };
      },
    },
    dismiss(state, action) {
      state.list = state.list.filter((n) => n.id !== action.payload);
    },
  },
});

export const { notify, dismiss } = notificationsSlice.actions;
export default notificationsSlice.reducer;
export const selectNotifications = (state) => state.notifications.list;
