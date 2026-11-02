// Тесты совместимости корзины, избранного и страниц с каталогом из Firestore (этап 5а):
// ошибки загрузки, счётчики и очистка устаревших записей, недоступный объём. Запуск: npm test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { products } from '../src/data/products.js';
import {
  MAX_QUANTITY,
  buildCartLines,
  changeItemVolume,
  countCartItems,
  countFavorites,
  hasUnavailableLines,
  makeKey,
  pruneCartItems,
  pruneFavoriteIds,
} from '../src/utils/cart.js';
import { catalogView, productPageView } from '../src/utils/catalogStatus.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const [rose, jasmin] = products;
const item = (id, volume, quantity = 1) => ({ key: makeKey(id, volume), id, volume, quantity });
const priceOf = (product, ml) => product.volumes.find((v) => v.ml === ml).price;

// ---------- 1. Ошибка загрузки каталога ----------

test('catalogView: ошибка Firestore — «error», а не бесконечная загрузка', () => {
  assert.equal(catalogView('idle'), 'loading');
  assert.equal(catalogView('loading'), 'loading');
  assert.equal(catalogView('failed'), 'error');
  assert.equal(catalogView('succeeded'), 'ready');
});

test('productPageView: ошибка загрузки отличается от отсутствующего товара', () => {
  assert.equal(productPageView('loading', undefined), 'loading');
  assert.equal(productPageView('failed', undefined), 'error');
  assert.equal(productPageView('succeeded', undefined), 'notFound');
  assert.equal(productPageView('succeeded', rose), 'ready');
  // Повторная загрузка не удалась, но товар уже был загружен раньше — показываем его
  assert.equal(productPageView('failed', rose), 'ready');
});

test('страницы с каталогом показывают ошибку с «Повторить» вместо вечного спиннера', () => {
  const pages = [
    'src/pages/CartPage.jsx',
    'src/pages/CheckoutPage.jsx',
    'src/pages/FavoritesPage.jsx',
    'src/pages/QuizPage.jsx',
    'src/pages/ProductPage.jsx',
    'src/components/home/ProductsShowcase.jsx',
  ];
  pages.forEach((path) => {
    const src = read(path);
    assert.match(src, /<CatalogLoadError \/>/, `${path}: нет состояния ошибки`);
    assert.match(src, /catalogView|productPageView/, `${path}: статус не проходит через catalogStatus`);
    assert.doesNotMatch(src, /status !== 'succeeded'/, `${path}: ошибка снова попадает в спиннер`);
  });
  assert.match(read('src/components/common/CatalogLoadError.jsx'), /onRetry=\{\(\) => dispatch\(fetchProducts\(\)\)\}/);
});

// ---------- 2. Счётчики и очистка устаревших записей ----------

test('countCartItems: после загрузки каталога считаются только существующие товары', () => {
  const items = [item(rose.id, 50, 3), item('deleted-product', 50, 3), item(jasmin.id, 30, 1)];
  assert.equal(countCartItems(items, products, true), 4);
  // Каталог ещё не загружен (или не загрузился) — проверить нельзя, считаем всё сохранённое
  assert.equal(countCartItems(items, [], false), 7);
  assert.equal(countCartItems([], products, true), 0);
});

test('countFavorites: учитываются только товары из загруженного каталога', () => {
  const ids = [rose.id, 'deleted-product', jasmin.id];
  assert.equal(countFavorites(ids, products, true), 2);
  assert.equal(countFavorites(ids, [], false), 3);
});

test('pruneCartItems: удаляет только отсутствующие товары, действующие — не трогает', () => {
  const items = [item(rose.id, 50, 2), item('deleted-product', 50), item(jasmin.id, 75)];
  const kept = pruneCartItems(items, products);
  // Позиция с недоступным объёмом остаётся: товар действующий, покупатель выберет другой объём
  assert.deepEqual(
    kept.map((i) => i.key),
    [makeKey(rose.id, 50), makeKey(jasmin.id, 75)],
  );
  assert.equal(kept[0].quantity, 2);
  // Удалять нечего — возвращается тот же массив (состояние и localStorage не перезаписываются)
  const clean = [item(rose.id, 50)];
  assert.equal(pruneCartItems(clean, products), clean);
});

test('pruneFavoriteIds: удаляет только отсутствующие id, порядок сохраняется', () => {
  assert.deepEqual(pruneFavoriteIds([jasmin.id, 'gone', rose.id], products), [jasmin.id, rose.id]);
  const clean = [rose.id];
  assert.equal(pruneFavoriteIds(clean, products), clean);
});

test('слайсы чистят корзину и избранное только после успешной загрузки каталога', () => {
  const cart = read('src/features/cart/cartSlice.js');
  const favorites = read('src/features/favorites/favoritesSlice.js');
  for (const src of [cart, favorites]) {
    assert.match(src, /addCase\(fetchProducts\.fulfilled/);
    assert.doesNotMatch(src, /fetchProducts\.rejected/);
  }
  assert.match(cart, /selectCartCount = createSelector\(\[selectRawItems, selectCatalog, selectCatalogLoaded\], countCartItems\)/);
  assert.match(favorites, /countFavorites/);
  for (const path of ['src/components/layout/Header.jsx', 'src/components/account/UserProfile.jsx']) {
    assert.doesNotMatch(read(path), /selectFavoriteIds\)\.length/, `${path}: счётчик избранного без проверки каталога`);
  }
});

// ---------- 3. Недоступный объём ----------

test('buildCartLines: объём и цена всегда соответствуют друг другу', () => {
  const lines = buildCartLines([item(rose.id, 50, 3), item('deleted-product', 50)], products);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].volume, 50);
  assert.equal(lines[0].price, priceOf(rose, 50));
  assert.equal(lines[0].lineTotal, priceOf(rose, 50) * 3);
  assert.equal(lines[0].volumeAvailable, true);
  assert.equal(hasUnavailableLines(lines), false);
});

test('buildCartLines: исчезнувший объём не получает цену другого объёма', () => {
  const lines = buildCartLines([item(jasmin.id, 75, 2), item(rose.id, 30)], products);
  const missing = lines.find((l) => l.id === jasmin.id);
  assert.equal(missing.volume, 75);
  assert.equal(missing.volumeAvailable, false);
  assert.equal(missing.price, null);
  assert.equal(missing.lineTotal, 0); // в сумму заказа не входит
  assert.equal(hasUnavailableLines(lines), true);
  // Сумма — только по позициям с подтверждённой ценой
  assert.equal(lines.reduce((s, l) => s + l.lineTotal, 0), priceOf(rose, 30));
});

test('changeItemVolume: выбор другого объёма синхронизирует ключ, объём и цену', () => {
  const items = [item(jasmin.id, 75, 2), item(rose.id, 30)];
  const next = changeItemVolume(items, makeKey(jasmin.id, 75), 50);
  assert.deepEqual(next[0], item(jasmin.id, 50, 2));
  assert.equal(next[1], items[1]); // порядок и остальные позиции не меняются
  assert.deepEqual(items[0], item(jasmin.id, 75, 2)); // исходный массив не изменён

  const [line] = buildCartLines([next[0]], products);
  assert.equal(line.volumeAvailable, true);
  assert.equal(line.price, priceOf(jasmin, 50));
});

test('changeItemVolume: если такой объём уже в корзине — позиции объединяются с лимитом', () => {
  const items = [item(jasmin.id, 75, 6), item(jasmin.id, 50, 7)];
  const next = changeItemVolume(items, makeKey(jasmin.id, 75), 50);
  assert.deepEqual(next, [item(jasmin.id, 50, MAX_QUANTITY)]);
  // Неизвестный ключ или тот же объём — без изменений
  assert.equal(changeItemVolume(items, 'nope__1', 50), items);
  assert.equal(changeItemVolume(items, makeKey(jasmin.id, 50), 50), items);
});

test('оформление заказа блокируется, пока в корзине есть недоступный объём', () => {
  const summary = read('src/components/cart/CartSummary.jsx');
  assert.match(summary, /selectCartHasUnavailable/);
  assert.match(summary, /showCheckout && !hasUnavailable && \(\s*<Link to="\/checkout"/);
  const checkout = read('src/pages/CheckoutPage.jsx');
  assert.match(checkout, /if \(hasUnavailable && !submittedRef\.current && !review\)/);
  // Защита и в самой отправке заказа: свежая проверка каталога (volumeUnavailable → blocked)
  assert.match(checkout, /const placeOrder = async[^]*?const result = checked \|\| \(await verifyCart\(values\)\)/);
});
