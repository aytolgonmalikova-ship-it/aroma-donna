// Тесты сервиса управления товарами (этап 5б): загрузка, создание и изменение товаров
// на модели Firestore в памяти (транзакции, serverTimestamp, ошибки доступа и сети). Запуск: npm test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { products } from '../src/data/products.js';
import { toCatalogProduct, toFirestoreProduct } from '../src/utils/products.js';
import { formToProduct, productToForm } from '../src/utils/productForm.js';
import { AdminError, toAdminError } from '../src/services/adminErrors.js';
import {
  createProduct,
  fetchAllProducts,
  fetchProductForEdit,
  sameUpdatedAt,
  updateProduct,
} from '../src/services/adminProductsStore.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// ---------- Модель Firestore ----------

class FakeTimestamp {
  constructor(ms) {
    this.ms = ms;
  }
  toMillis() {
    return this.ms;
  }
  toDate() {
    return new Date(this.ms);
  }
  isEqual(other) {
    return other instanceof FakeTimestamp && other.ms === this.ms;
  }
}

const SERVER_TIMESTAMP = Symbol('serverTimestamp');
// Копия данных документа: обычные объекты и массивы копируются, Timestamp остаётся тем же объектом
const clone = (v) =>
  Array.isArray(v)
    ? v.map(clone)
    : v && v.constructor === Object
      ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)]))
      : v;

/**
 * Коллекция products в памяти. failNext — ошибка (например { code: 'permission-denied' }),
 * которую выбросит следующая операция. Транзакция записывает данные только если функция
 * завершилась без ошибки — как в Firestore.
 */
function fakeFirebase(initial = {}) {
  const docs = new Map(Object.entries(initial).map(([id, data]) => [id, clone(data)]));
  const stats = { reads: 0, transactions: 0, writes: 0 };
  let clock = Date.parse('2026-11-01T00:00:00Z');
  const fb = { docs, stats, failNext: null };

  const maybeFail = () => {
    if (fb.failNext) {
      const err = Object.assign(new Error(fb.failNext.code), fb.failNext);
      fb.failNext = null;
      throw err;
    }
  };
  const snapshot = (id) => ({ id, exists: () => docs.has(id), data: () => clone(docs.get(id)) });

  fb.db = { name: 'fake-db' };
  fb.dbApi = {
    collection: (db, name) => ({ name }),
    doc: (db, name, id) => {
      assert.equal(name, 'products');
      return { name, id };
    },
    serverTimestamp: () => SERVER_TIMESTAMP,
    async getDocs(col) {
      maybeFail();
      assert.equal(col.name, 'products');
      stats.reads += docs.size;
      return { empty: docs.size === 0, docs: [...docs.keys()].map(snapshot) };
    },
    async getDoc(ref) {
      maybeFail();
      stats.reads += 1;
      return snapshot(ref.id);
    },
    async runTransaction(db, fn) {
      maybeFail();
      stats.transactions += 1;
      const writes = [];
      const tx = {
        get: async (ref) => {
          stats.reads += 1;
          return snapshot(ref.id);
        },
        set: (ref, data) => writes.push([ref.id, data]),
      };
      const result = await fn(tx); // ошибка внутри — ничего не записывается
      clock += 1000;
      writes.forEach(([id, data]) => {
        const stored = clone(data);
        Object.keys(stored).forEach((k) => {
          if (stored[k] === SERVER_TIMESTAMP) stored[k] = new FakeTimestamp(clock);
        });
        docs.set(id, stored);
        stats.writes += 1;
      });
      return result;
    },
  };
  return fb;
}

const T0 = new FakeTimestamp(Date.parse('2026-10-01T10:00:00Z'));
const stored = (product, extra = {}) => ({ ...toFirestoreProduct(product), updatedAt: T0, ...extra });
const [rose, jasmin] = products;

/** Каталог из трёх товаров: видимый, скрытый и повреждённый */
const seed = () =>
  fakeFirebase({
    [rose.id]: stored(rose),
    [jasmin.id]: stored(jasmin, { hidden: true }),
    broken: { name: 'Без объёмов', volumes: [], hidden: false },
  });

/** Данные нового товара — из модели формы, как это будет делать страница */
function newProductData(overrides = {}) {
  const form = productToForm({ ...rose, id: 'new-scent', name: 'New Scent', image: '' });
  return { ...formToProduct(form), ...overrides };
}

async function rejectsWith(promise, code) {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof AdminError, `ожидалась AdminError, получено ${err}`);
    assert.equal(err.code, code);
    return true;
  });
}

// ---------- fetchAllProducts ----------

test('fetchAllProducts: все товары, включая скрытые; повреждённые — отдельным списком', async () => {
  const fb = seed();
  const { products: list, invalidIds } = await fetchAllProducts(fb);
  assert.deepEqual(list.map((p) => p.id).sort(), [jasmin.id, rose.id].sort());
  assert.equal(list.find((p) => p.id === jasmin.id).hidden, true);
  assert.deepEqual(invalidIds, ['broken']);
  // Формат витрины: дата — строка ISO, цены и объёмы на месте
  const r = list.find((p) => p.id === rose.id);
  assert.equal(r.updatedAt, '2026-10-01T10:00:00.000Z');
  assert.deepEqual(r.volumes, rose.volumes);
});

// ---------- fetchProductForEdit ----------

test('fetchProductForEdit: товар и исходный Timestamp для проверки конфликта', async () => {
  const fb = seed();
  const res = await fetchProductForEdit(fb, rose.id);
  assert.equal(res.product.id, rose.id);
  assert.equal(res.product.name, rose.name);
  assert.equal(res.damaged, false);
  assert.ok(res.updatedAt.isEqual(T0));
});

test('fetchProductForEdit: нет товара или некорректный id — not-found (некорректный id — без запроса)', async () => {
  const fb = seed();
  await rejectsWith(fetchProductForEdit(fb, 'no-such-scent'), 'not-found');
  const reads = fb.stats.reads;
  for (const id of ['', 'Rose', 'a/b', '../admins/x', 'a'.repeat(61), undefined]) {
    await rejectsWith(fetchProductForEdit(fb, id), 'not-found');
  }
  assert.equal(fb.stats.reads, reads);
});

test('fetchProductForEdit: повреждённый документ открывается для исправления (damaged)', async () => {
  const res = await fetchProductForEdit(seed(), 'broken');
  assert.equal(res.damaged, true);
  assert.equal(res.product.id, 'broken');
  assert.equal(res.product.name, 'Без объёмов');
  assert.equal(res.updatedAt, null);
});

// ---------- createProduct ----------

test('createProduct: успешное создание — полный документ, hidden: false, updatedAt от сервера', async () => {
  const fb = seed();
  const data = newProductData();
  assert.equal(await createProduct(fb, data), 'new-scent');
  const doc = fb.docs.get('new-scent');
  const { updatedAt, ...rest } = doc;
  assert.deepEqual(rest, { ...data, hidden: false });
  assert.ok(updatedAt instanceof FakeTimestamp);
  assert.equal(fb.stats.writes, 1);
  // Новый товар сразу читается витриной в прежнем формате
  const product = toCatalogProduct('new-scent', doc);
  assert.equal(product.price, Math.min(...data.volumes.map((v) => v.price)));
  assert.equal(product.image, '/images/products/new-scent.jpg');
});

test('createProduct: новый товар всегда видимый, даже если в данных hidden: true', async () => {
  const fb = seed();
  await createProduct(fb, newProductData({ hidden: true }));
  assert.equal(fb.docs.get('new-scent').hidden, false);
});

test('createProduct: занятый id — id-taken, существующий товар не перезаписан', async () => {
  const fb = seed();
  const before = clone(fb.docs.get(rose.id));
  await rejectsWith(createProduct(fb, newProductData({ id: rose.id, name: 'Подмена' })), 'id-taken');
  assert.deepEqual(fb.docs.get(rose.id), before);
  assert.equal(fb.stats.writes, 0);
  // Скрытый товар тоже защищён
  await rejectsWith(createProduct(fb, newProductData({ id: jasmin.id })), 'id-taken');
  assert.equal(fb.docs.get(jasmin.id).hidden, true);
  assert.equal(fb.stats.writes, 0);
});

test('createProduct: неверный формат — invalid со списком полей, запроса к базе нет', async () => {
  const fb = seed();
  await assert.rejects(createProduct(fb, newProductData({ name: '', price: 1, extra: 'x' })), (err) => {
    assert.equal(err.code, 'invalid');
    assert.ok(err.fields.includes('name'));
    assert.ok(err.fields.includes('price'));
    assert.ok(err.fields.includes('unknown.extra'));
    return true;
  });
  await rejectsWith(createProduct(fb, newProductData({ id: 'Bad Id' })), 'invalid');
  assert.equal(fb.stats.transactions, 0);
  assert.equal(fb.stats.writes, 0);
});

// ---------- updateProduct ----------

test('updateProduct: успешное изменение — новые данные и новый updatedAt', async () => {
  const fb = seed();
  const { product, updatedAt } = await fetchProductForEdit(fb, rose.id);
  const form = productToForm(product);
  form.name = 'Rose Poudrée Intense';
  form.volumes[50].price = '9000';
  await updateProduct(fb, rose.id, formToProduct(form), updatedAt);

  const doc = fb.docs.get(rose.id);
  assert.equal(doc.name, 'Rose Poudrée Intense');
  assert.equal(doc.volumes.find((v) => v.ml === 50).price, 9000);
  assert.equal(doc.price, Math.min(...doc.volumes.map((v) => v.price)));
  assert.ok(doc.updatedAt instanceof FakeTimestamp);
  assert.equal(doc.updatedAt.isEqual(updatedAt), false);
  assert.equal(fb.stats.writes, 1);
});

test('updateProduct: id документа сохраняется, подмена id в данных не создаёт другой товар', async () => {
  const fb = seed();
  const { product, updatedAt } = await fetchProductForEdit(fb, rose.id);
  await updateProduct(fb, rose.id, { ...formToProduct(productToForm(product)), id: 'hacked-id' }, updatedAt);
  assert.equal(fb.docs.get(rose.id).id, rose.id);
  assert.equal(fb.docs.has('hacked-id'), false);
});

test('updateProduct: hidden берётся из текущего документа, а не из данных формы', async () => {
  const fb = seed();
  // Скрытый товар не становится видимым
  const hiddenOne = await fetchProductForEdit(fb, jasmin.id);
  await updateProduct(fb, jasmin.id, { ...formToProduct(productToForm(hiddenOne.product)), hidden: false }, hiddenOne.updatedAt);
  assert.equal(fb.docs.get(jasmin.id).hidden, true);
  // Видимый товар не становится скрытым
  const visible = await fetchProductForEdit(fb, rose.id);
  await updateProduct(fb, rose.id, { ...formToProduct(productToForm(visible.product)), hidden: true }, visible.updatedAt);
  assert.equal(fb.docs.get(rose.id).hidden, false);
});

test('updateProduct: документ без поля hidden (витрина его не показывает) остаётся скрытым', async () => {
  const { hidden: _omit, ...noHidden } = stored(rose);
  const fb = fakeFirebase({ [rose.id]: noHidden });
  const { product, updatedAt } = await fetchProductForEdit(fb, rose.id);
  await updateProduct(fb, rose.id, formToProduct(productToForm(product)), updatedAt);
  assert.equal(fb.docs.get(rose.id).hidden, true);
});

test('updateProduct: товара больше нет — not-found, новый документ не создаётся', async () => {
  const fb = seed();
  const { product, updatedAt } = await fetchProductForEdit(fb, rose.id);
  fb.docs.delete(rose.id); // удалили в консоли, пока форма была открыта
  await rejectsWith(updateProduct(fb, rose.id, formToProduct(productToForm(product)), updatedAt), 'not-found');
  assert.equal(fb.docs.has(rose.id), false);
  assert.equal(fb.stats.writes, 0);
  await rejectsWith(updateProduct(fb, 'a/b', formToProduct(productToForm(product)), updatedAt), 'not-found');
});

test('updateProduct: товар изменили после открытия формы — conflict, чужие правки не затёрты', async () => {
  const fb = seed();
  const tabA = await fetchProductForEdit(fb, rose.id);
  const tabB = await fetchProductForEdit(fb, rose.id);

  const formB = productToForm(tabB.product);
  formB.brand = 'Изменено во вкладке B';
  await updateProduct(fb, rose.id, formToProduct(formB), tabB.updatedAt);

  const formA = productToForm(tabA.product);
  formA.name = 'Изменено во вкладке A';
  await rejectsWith(updateProduct(fb, rose.id, formToProduct(formA), tabA.updatedAt), 'conflict');
  assert.equal(fb.docs.get(rose.id).brand, 'Изменено во вкладке B');
  assert.equal(fb.docs.get(rose.id).name, rose.name);
  assert.equal(fb.stats.writes, 1);

  // Без даты открытия формы изменить товар с датой нельзя
  await rejectsWith(updateProduct(fb, rose.id, formToProduct(formA), null), 'conflict');
});

test('updateProduct: неверный формат — invalid до обращения к базе', async () => {
  const fb = seed();
  const { product, updatedAt } = await fetchProductForEdit(fb, rose.id);
  const data = { ...formToProduct(productToForm(product)), volumes: [] };
  await rejectsWith(updateProduct(fb, rose.id, data, updatedAt), 'invalid');
  assert.equal(fb.stats.transactions, 0);
});

// ---------- Ошибки доступа и сети ----------

test('ошибки Firebase: нет прав → denied, нет сети → network, прочее → failed (во всех функциях)', async () => {
  const cases = [
    ['permission-denied', 'denied'],
    ['unavailable', 'network'],
    ['deadline-exceeded', 'network'],
    ['internal', 'failed'],
  ];
  for (const [firebaseCode, code] of cases) {
    const fb = seed();
    const { product, updatedAt } = await fetchProductForEdit(fb, rose.id);
    const data = formToProduct(productToForm(product));
    const calls = [
      () => fetchAllProducts(fb),
      () => fetchProductForEdit(fb, rose.id),
      () => createProduct(fb, newProductData()),
      () => updateProduct(fb, rose.id, data, updatedAt),
    ];
    for (const call of calls) {
      fb.failNext = { code: firebaseCode };
      await rejectsWith(call(), code);
    }
    assert.equal(fb.stats.writes, 0, firebaseCode);
  }
});

test('toAdminError: Firebase не подключён, AdminError проходит без изменений', () => {
  assert.equal(toAdminError(new Error('firebase-not-configured')).code, 'not-configured');
  const own = new AdminError('id-taken');
  assert.equal(toAdminError(own), own);
  assert.equal(toAdminError(undefined).code, 'failed');
});

test('sameUpdatedAt: сравнение Timestamp и отсутствующих дат', () => {
  assert.equal(sameUpdatedAt(T0, new FakeTimestamp(T0.ms)), true);
  assert.equal(sameUpdatedAt(T0, new FakeTimestamp(T0.ms + 1)), false);
  assert.equal(sameUpdatedAt(null, null), true);
  assert.equal(sameUpdatedAt(undefined, null), true);
  assert.equal(sameUpdatedAt(T0, null), false);
  assert.equal(sameUpdatedAt(null, T0), false);
});

// ---------- Подключение в adminService и границы этапа ----------

test('adminService: четыре функции товаров подключены, удаления нет, правила не изменены', () => {
  const service = read('src/services/adminService.js');
  for (const name of ['fetchAllProducts', 'fetchProductForEdit', 'createProduct', 'updateProduct']) {
    assert.match(service, new RegExp(`export const ${name} = [^;]*withFirebase\\(productsStore\\.${name}`), name);
  }
  assert.match(service, /export \{ AdminError \}/);
  const store = read('src/services/adminProductsStore.js');
  for (const src of [service, store]) {
    assert.doesNotMatch(src, /deleteDoc|\.delete\(/); // удаление — этап 5в
  }
  assert.match(store, /runTransaction[^]*runTransaction/); // создание и изменение — в транзакциях
  assert.match(store, /serverTimestamp\(\)[^]*serverTimestamp\(\)/);
  // firestore.rules этапа 5а без изменений
  const hash = createHash('sha256').update(read('firestore.rules')).digest('hex');
  assert.equal(hash, '257b26e98e1e4caa823f5ba69e53116c8b7266d1f8d2ec184b13093536b01dea');
});
