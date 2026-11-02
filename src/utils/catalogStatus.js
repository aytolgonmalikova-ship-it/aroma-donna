// Что показать на странице, зависящей от каталога: загрузку, ошибку с «Повторить» или содержимое.
// Каталог грузится из Firestore и может не загрузиться (нет сети, нет прав) —
// тогда вместо бесконечного спиннера показывается ошибка.

/** status из productsSlice → 'loading' | 'error' | 'ready' */
export function catalogView(status) {
  if (status === 'failed') return 'error';
  if (status === 'succeeded') return 'ready';
  return 'loading';
}

/**
 * Страница товара → 'loading' | 'error' | 'notFound' | 'ready'.
 * «Не найден» — только когда каталог успешно загружен и товара в нём нет;
 * ошибка загрузки не выдаётся за отсутствующий товар.
 */
export function productPageView(status, product) {
  if (product) return 'ready';
  const view = catalogView(status);
  return view === 'ready' ? 'notFound' : view;
}
