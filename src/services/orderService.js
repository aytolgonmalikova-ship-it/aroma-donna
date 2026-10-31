/**
 * Сохранение и получение заказов.
 *
 * - Режим Firebase + пользователь вошёл: заказ сохраняется в Firestore
 *   (users/{uid}/orders). Читать заказы может только их владелец — это проверяют
 *   правила firestore.rules на сервере.
 * - Демо-режим или гость: заказ сохраняется только в localStorage этого браузера.
 *
 * Оплата не проводится: способы оплаты — только при получении. Деньги не списываются.
 */
import { getFirebase } from './firebase';
import { AUTH_MODE } from './authService';
import { loadFromStorage, saveToStorage, STORAGE_KEYS } from '../utils/storage';

export async function createOrder(order, user) {
  if (AUTH_MODE === 'firebase' && user) {
    const { db, dbApi } = await getFirebase();
    const ref = dbApi.doc(db, 'users', user.uid, 'orders', order.id);
    await dbApi.setDoc(ref, { ...order, mode: 'firebase', status: 'new' });
    return { ...order, mode: 'firebase', status: 'new' };
  }
  await new Promise((r) => setTimeout(r, 500));
  const saved = { ...order, mode: 'demo', status: 'demo' };
  const all = loadFromStorage(STORAGE_KEYS.demoOrders, []);
  saveToStorage(STORAGE_KEYS.demoOrders, [saved, ...all].slice(0, 50));
  return saved;
}

export async function getOrders(user) {
  if (!user) return [];
  if (AUTH_MODE === 'firebase') {
    const { db, dbApi } = await getFirebase();
    const q = dbApi.query(
      dbApi.collection(db, 'users', user.uid, 'orders'),
      dbApi.orderBy('createdAt', 'desc'),
    );
    const snap = await dbApi.getDocs(q);
    return snap.docs.map((d) => d.data());
  }
  return loadFromStorage(STORAGE_KEYS.demoOrders, []).filter((o) => o.userId === user.uid);
}

/** Поиск демо-заказа по номеру (для страницы успешного оформления после обновления) */
export function findLocalOrder(orderId) {
  return loadFromStorage(STORAGE_KEYS.demoOrders, []).find((o) => o.id === orderId) || null;
}
