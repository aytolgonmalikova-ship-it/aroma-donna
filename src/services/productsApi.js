import { products } from '../data/products';

/**
 * Имитация запроса к серверу каталога.
 * Небольшая задержка нужна, чтобы показать состояние загрузки (LoadingSpinner).
 * При подключении настоящего API достаточно заменить тело функции на fetch(...).
 */
export function fetchProductsApi(delay = 350) {
  return new Promise((resolve) => {
    setTimeout(() => resolve(products), delay);
  });
}
