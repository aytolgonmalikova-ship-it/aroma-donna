import { products as fallbackProducts } from '../data/products';
import { getFirebase, isFirebaseConfigured } from './firebase';
import { toCatalogProduct } from '../utils/products';

/**
 * Загрузка каталога витрины. Возвращает { items, source }:
 *
 * - 'firestore' — видимые товары из коллекции products (hidden == false);
 * - 'fallback'  — Firebase подключён, но видимых товаров в коллекции нет (каталог ещё
 *                 не импортирован) — показываем резервный каталог src/data/products.js;
 * - 'demo'      — демо-режим без Firebase, тот же резервный каталог.
 *
 * Ошибка Firestore (нет прав, нет сети) НЕ подменяется резервным каталогом и не выглядит
 * как пустой список: функция бросает ошибку, каталог показывает «Не удалось загрузить» и «Повторить».
 */
export async function fetchProductsApi(delay = 350) {
  if (!isFirebaseConfigured) {
    // Небольшая задержка — чтобы и в демо-режиме было видно состояние загрузки
    await new Promise((resolve) => setTimeout(resolve, delay));
    return { items: fallbackProducts, source: 'demo' };
  }

  const { db, dbApi } = await getFirebase();
  // Фильтр hidden == false обязателен: правила firestore.rules разрешают посетителю
  // только такой запрос (скрытые товары видит лишь администратор)
  const snap = await dbApi.getDocs(
    dbApi.query(dbApi.collection(db, 'products'), dbApi.where('hidden', '==', false)),
  );

  if (snap.empty) {
    console.info('[catalog] В Firestore нет видимых товаров — показан резервный каталог');
    return { items: fallbackProducts, source: 'fallback' };
  }

  const items = [];
  snap.docs.forEach((doc) => {
    const product = toCatalogProduct(doc.id, doc.data());
    if (product) items.push(product);
    else console.warn(`[catalog] Товар ${doc.id} пропущен: некорректные данные`);
  });
  // Документы есть, но ни один нельзя показать — это ошибка данных, а не пустой каталог
  if (items.length === 0) throw new Error('invalidCatalog');

  // Порядок по умолчанию — по популярности (Firestore отдаёт документы по id)
  items.sort((a, b) => b.popularity - a.popularity);
  return { items, source: 'firestore' };
}
