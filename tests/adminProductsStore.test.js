// Тесты сервиса управления товарами: загрузка, создание и изменение (этап 5б), скрытие и удаление (этап 5в),
// удаление со страницы товара с JSON-копией (подэтап 5в.4), видимость на странице товара (подэтап 5в.5)
// на модели Firestore в памяти (транзакции, serverTimestamp, ошибки доступа и сети). Запуск: npm test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { products } from '../src/data/products.js';
import { toCatalogProduct, toFirestoreProduct } from '../src/utils/products.js';
import { formToProduct, productToForm } from '../src/utils/productForm.js';
import {
  buildProductBackup,
  countProductVisibility,
  deleteBlockReason,
  productVisibilityState,
  visibilityErrorAction,
} from '../src/utils/adminProducts.js';
import { AdminError, toAdminError } from '../src/services/adminErrors.js';
import {
  createProduct,
  deleteProduct,
  fetchAllProducts,
  fetchProductForEdit,
  sameUpdatedAt,
  setProductHidden,
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
    collection: (db, name) => ({ name, filters: [] }),
    // Поддерживается только фильтр «==» — другого в коде нет
    where: (field, op, value) => {
      assert.equal(op, '==');
      return { field, value };
    },
    query: (col, ...filters) => ({ ...col, filters: [...col.filters, ...filters] }),
    doc: (db, name, id) => {
      assert.equal(name, 'products');
      return { name, id };
    },
    serverTimestamp: () => SERVER_TIMESTAMP,
    async getDocs(col) {
      maybeFail();
      assert.equal(col.name, 'products');
      // Как в Firestore: документ без поля не попадает под фильтр «поле == значение»
      const ids = [...docs.keys()].filter((id) => col.filters.every((f) => docs.get(id)[f.field] === f.value));
      stats.reads += ids.length;
      return { empty: ids.length === 0, docs: ids.map(snapshot) };
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
      let wrote = false;
      const tx = {
        get: async (ref) => {
          // Как в Firestore: все чтения транзакции — до первой записи
          assert.equal(wrote, false, 'чтение после записи в транзакции');
          stats.reads += 1;
          return snapshot(ref.id);
        },
        set: (ref, data) => {
          wrote = true;
          writes.push(['set', ref.id, data]);
        },
        update: (ref, data) => {
          wrote = true;
          writes.push(['update', ref.id, data]);
        },
        delete: (ref) => {
          wrote = true;
          writes.push(['delete', ref.id]);
        },
      };
      const result = await fn(tx); // ошибка внутри — ничего не записывается
      clock += 1000;
      writes.forEach(([kind, id, data]) => {
        stats.writes += 1;
        if (kind === 'delete') {
          docs.delete(id);
          return;
        }
        // update несуществующего документа в Firestore — ошибка not-found
        if (kind === 'update') assert.ok(docs.has(id), `update несуществующего ${id}`);
        const stored = clone(data);
        Object.keys(stored).forEach((k) => {
          if (stored[k] === SERVER_TIMESTAMP) stored[k] = new FakeTimestamp(clock);
        });
        docs.set(id, kind === 'update' ? { ...docs.get(id), ...stored } : stored);
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

// ---------- setProductHidden (этап 5в) ----------

const third = products[2];

/** Два видимых товара (rose, third), скрытый (jasmin) и повреждённый видимый (broken) */
const seedTwoVisible = () =>
  fakeFirebase({
    [rose.id]: stored(rose),
    [third.id]: stored(third),
    [jasmin.id]: stored(jasmin, { hidden: true }),
    broken: { name: 'Без объёмов', volumes: [], hidden: false },
  });

/** id товаров, которые увидит витрина: тот же запрос и та же проверка, что в productsApi.js */
async function storefrontIds(fb) {
  const { db, dbApi } = fb;
  const snap = await dbApi.getDocs(dbApi.query(dbApi.collection(db, 'products'), dbApi.where('hidden', '==', false)));
  return snap.docs
    .filter((d) => toCatalogProduct(d.id, d.data()))
    .map((d) => d.id)
    .sort();
}

test('setProductHidden: скрытие меняет только hidden и updatedAt, витрина товар больше не видит', async () => {
  const fb = seedTwoVisible();
  const before = clone(fb.docs.get(rose.id));
  const res = await setProductHidden(fb, rose.id, true, T0);
  assert.deepEqual(res, { id: rose.id, hidden: true, changed: true });

  const { updatedAt, hidden, ...rest } = fb.docs.get(rose.id);
  const { updatedAt: _t, hidden: _h, ...restBefore } = before;
  assert.deepEqual(rest, restBefore); // название, цены, объёмы и т.д. не изменились
  assert.equal(hidden, true);
  assert.ok(updatedAt instanceof FakeTimestamp && !updatedAt.isEqual(T0));
  assert.equal(fb.stats.writes, 1);
  assert.deepEqual(await storefrontIds(fb), [third.id]);
  // Документ в Firestore остался — администратор его видит
  const { products: list } = await fetchAllProducts(fb);
  assert.equal(list.find((p) => p.id === rose.id).hidden, true);
});

test('setProductHidden: возвращение на витрину; затем снова скрыть с новой датой', async () => {
  const fb = seedTwoVisible();
  assert.deepEqual(await setProductHidden(fb, jasmin.id, false, T0), { id: jasmin.id, hidden: false, changed: true });
  assert.equal(fb.docs.get(jasmin.id).hidden, false);
  assert.deepEqual(await storefrontIds(fb), [jasmin.id, rose.id, third.id].sort());

  const { updatedAt } = await fetchProductForEdit(fb, jasmin.id);
  await setProductHidden(fb, jasmin.id, true, updatedAt);
  assert.equal(fb.docs.get(jasmin.id).hidden, true);
});

test('setProductHidden: принимает дату из списка (ISO-строка) и из формы (Timestamp)', async () => {
  const fb = seedTwoVisible();
  const { products: list } = await fetchAllProducts(fb);
  const fromList = list.find((p) => p.id === rose.id).updatedAt;
  assert.equal(typeof fromList, 'string');
  await setProductHidden(fb, rose.id, true, fromList);
  const fromForm = (await fetchProductForEdit(fb, rose.id)).updatedAt;
  await setProductHidden(fb, rose.id, false, fromForm);
  assert.equal(fb.docs.get(rose.id).hidden, false);
});

test('setProductHidden: статус уже такой — ничего не записывается', async () => {
  const fb = seedTwoVisible();
  assert.deepEqual(await setProductHidden(fb, jasmin.id, true, T0), { id: jasmin.id, hidden: true, changed: false });
  assert.deepEqual(await setProductHidden(fb, rose.id, false, T0), { id: rose.id, hidden: false, changed: false });
  assert.equal(fb.stats.writes, 0);
  assert.ok(fb.docs.get(jasmin.id).updatedAt.isEqual(T0));
});

test('setProductHidden: товар изменили после загрузки — conflict, ничего не записано', async () => {
  const fb = seedTwoVisible();
  const { product, updatedAt } = await fetchProductForEdit(fb, rose.id);
  const { products: list } = await fetchAllProducts(fb);
  const listDate = list.find((p) => p.id === rose.id).updatedAt;
  // Во второй вкладке изменили цену
  const form = productToForm(product);
  form.volumes[50].price = '9100';
  await updateProduct(fb, rose.id, formToProduct(form), updatedAt);
  const writes = fb.stats.writes;

  await rejectsWith(setProductHidden(fb, rose.id, true, updatedAt), 'conflict');
  await rejectsWith(setProductHidden(fb, rose.id, true, listDate), 'conflict');
  await rejectsWith(setProductHidden(fb, rose.id, true, null), 'conflict');
  assert.equal(fb.docs.get(rose.id).hidden, false);
  assert.equal(fb.stats.writes, writes);
});

test('setProductHidden: нет товара — not-found; некорректный id и hidden — без запросов', async () => {
  const fb = seedTwoVisible();
  await rejectsWith(setProductHidden(fb, 'no-such-scent', true, T0), 'not-found');
  assert.equal(fb.docs.has('no-such-scent'), false);
  const reads = fb.stats.reads;
  for (const id of ['', 'Rose', 'a/b', '../admins/x', 'a'.repeat(61), undefined]) {
    await rejectsWith(setProductHidden(fb, id, true, T0), 'not-found');
  }
  for (const hidden of ['true', 1, null, undefined]) {
    await rejectsWith(setProductHidden(fb, rose.id, hidden, T0), 'invalid');
  }
  assert.equal(fb.stats.reads, reads);
  assert.equal(fb.stats.writes, 0);
});

test('setProductHidden: повреждённый документ — damaged (правила отклонили бы запись)', async () => {
  const fb = seedTwoVisible();
  await rejectsWith(setProductHidden(fb, 'broken', true, null), 'damaged');
  // id в данных не совпадает с id документа — правила тоже отклонят
  fb.docs.set('copy-of-rose', stored(rose, { hidden: true }));
  await rejectsWith(setProductHidden(fb, 'copy-of-rose', false, T0), 'damaged');
  // Неизвестное поле
  fb.docs.set(third.id, stored(third, { extra: 1 }));
  await rejectsWith(setProductHidden(fb, third.id, true, T0), 'damaged');
  assert.equal(fb.stats.writes, 0);
});

test('setProductHidden: последний видимый товар скрыть нельзя — last-visible, демо-каталог не появится', async () => {
  // rose — единственный корректный видимый товар (broken тоже hidden: false, но витрина его не покажет)
  const fb = seed();
  await rejectsWith(setProductHidden(fb, rose.id, true, T0), 'last-visible');
  assert.equal(fb.docs.get(rose.id).hidden, false);
  assert.deepEqual(await storefrontIds(fb), [rose.id]);
  assert.equal(fb.stats.writes, 0);
  // Вернуть другой товар на витрину можно — после этого rose скрывается
  await setProductHidden(fb, jasmin.id, false, T0);
  await setProductHidden(fb, rose.id, true, T0);
  assert.deepEqual(await storefrontIds(fb), [jasmin.id]);
});

test('setProductHidden: другой видимый товар скрыли одновременно — проверка внутри транзакции даёт last-visible', async () => {
  const fb = seedTwoVisible();
  // Запрос кандидатов уже видел third видимым, но до транзакции его скрыли в другой вкладке
  const runTransaction = fb.dbApi.runTransaction;
  fb.dbApi.runTransaction = (db, fn) => {
    fb.docs.get(third.id).hidden = true;
    return runTransaction(db, fn);
  };
  await rejectsWith(setProductHidden(fb, rose.id, true, T0), 'last-visible');
  assert.equal(fb.docs.get(rose.id).hidden, false);
});

// ---------- deleteProduct (этап 5в) ----------

test('deleteProduct: скрытый товар удаляется, остальные документы и витрина не меняются', async () => {
  const fb = seedTwoVisible();
  const others = [rose.id, third.id, 'broken'].map((id) => [id, clone(fb.docs.get(id))]);
  const shelf = await storefrontIds(fb);

  assert.equal(await deleteProduct(fb, jasmin.id, T0), jasmin.id);
  assert.equal(fb.docs.has(jasmin.id), false);
  assert.equal(fb.stats.writes, 1);
  others.forEach(([id, data]) => assert.deepEqual(fb.docs.get(id), data));
  assert.deepEqual(await storefrontIds(fb), shelf);
  // Тот же id больше не открывается
  await rejectsWith(fetchProductForEdit(fb, jasmin.id), 'not-found');
});

test('deleteProduct: видимый товар удалить нельзя — not-hidden, документ на месте', async () => {
  const fb = seedTwoVisible();
  await rejectsWith(deleteProduct(fb, rose.id, T0), 'not-hidden');
  // Повреждённый, но с hidden: false — тоже нельзя (сначала исправить и скрыть)
  await rejectsWith(deleteProduct(fb, 'broken', null), 'not-hidden');
  assert.ok(fb.docs.has(rose.id));
  assert.ok(fb.docs.has('broken'));
  assert.equal(fb.stats.writes, 0);
});

test('deleteProduct: hidden не равно true (поля нет или не boolean) — not-hidden, как в firestore.rules', async () => {
  const { hidden: _omit, ...noHidden } = stored(jasmin);
  for (const data of [noHidden, { ...stored(jasmin), hidden: 'true' }, { ...stored(jasmin), hidden: null }]) {
    const fb = fakeFirebase({ [rose.id]: stored(rose), [jasmin.id]: data });
    await rejectsWith(deleteProduct(fb, jasmin.id, T0), 'not-hidden');
    assert.deepEqual(fb.docs.get(jasmin.id), data);
    assert.equal(fb.stats.writes, 0);
  }
});

test('deleteProduct: товар изменили или вернули на витрину после открытия — conflict, не удалён', async () => {
  const fb = seedTwoVisible();
  // Во второй вкладке товар вернули на витрину и снова скрыли — дата изменилась
  await setProductHidden(fb, jasmin.id, false, T0);
  const { updatedAt } = await fetchProductForEdit(fb, jasmin.id);
  await setProductHidden(fb, jasmin.id, true, updatedAt);
  const writes = fb.stats.writes;

  await rejectsWith(deleteProduct(fb, jasmin.id, T0), 'conflict');
  await rejectsWith(deleteProduct(fb, jasmin.id, null), 'conflict');
  assert.ok(fb.docs.has(jasmin.id));
  assert.equal(fb.stats.writes, writes);
});

test('deleteProduct: нет товара — not-found; некорректный id — без запросов', async () => {
  const fb = seedTwoVisible();
  await rejectsWith(deleteProduct(fb, 'no-such-scent', T0), 'not-found');
  const reads = fb.stats.reads;
  for (const id of ['', 'Rose', 'a/b', '../admins/x', 'a'.repeat(61), undefined]) {
    await rejectsWith(deleteProduct(fb, id, T0), 'not-found');
  }
  assert.equal(fb.stats.reads, reads);
  assert.equal(fb.stats.writes, 0);
});

test('deleteProduct: на витрине нет видимых товаров — last-visible (демо-каталог не закрепляется)', async () => {
  const fb = fakeFirebase({
    [rose.id]: stored(rose, { hidden: true }),
    [jasmin.id]: stored(jasmin, { hidden: true }),
  });
  await rejectsWith(deleteProduct(fb, jasmin.id, T0), 'last-visible');
  assert.equal(fb.docs.size, 2);
  // Последний документ коллекции удалить нельзя: появились бы резервный каталог и кнопка импорта
  const single = fakeFirebase({ [jasmin.id]: stored(jasmin, { hidden: true }) });
  await rejectsWith(deleteProduct(single, jasmin.id, T0), 'last-visible');
  assert.equal(single.docs.size, 1);
});

test('скрытие и удаление затрагивают только коллекцию products (заказы и профили не читаются и не пишутся)', async () => {
  // Модель Firestore проверяет имя коллекции в doc() и getDocs(): любое обращение не к products упадёт
  const fb = seedTwoVisible();
  await setProductHidden(fb, rose.id, true, T0);
  await deleteProduct(fb, rose.id, (await fetchProductForEdit(fb, rose.id)).updatedAt);
  assert.equal(fb.docs.has(rose.id), false);
});

test('fetchProductForEdit: raw — исходный документ целиком (для JSON-копии перед удалением)', async () => {
  const fb = seed();
  const res = await fetchProductForEdit(fb, jasmin.id);
  assert.deepEqual(res.raw, fb.docs.get(jasmin.id));
  assert.ok(res.raw.updatedAt.isEqual(T0));
  assert.deepEqual((await fetchProductForEdit(fb, 'broken')).raw, fb.docs.get('broken'));
});

test('удаление со страницы товара: копия → deleteProduct с updatedAt формы; копия восстанавливает товар', async () => {
  const fb = seedTwoVisible();
  const before = clone(fb.docs.get(jasmin.id));
  const loaded = await fetchProductForEdit(fb, jasmin.id);
  assert.equal(deleteBlockReason(loaded.product, null), null);
  const backup = buildProductBackup(jasmin.id, loaded.raw, new Date('2026-11-02T00:00:00Z'));

  assert.equal(await deleteProduct(fb, jasmin.id, loaded.updatedAt), jasmin.id);
  assert.equal(fb.docs.has(jasmin.id), false);

  // В копии — все поля документа; без updatedAt это корректный товар, который можно записать обратно
  const { updatedAt, ...restored } = backup.document;
  assert.equal(updatedAt, T0.toDate().toISOString());
  const { updatedAt: _ts, ...original } = before;
  assert.deepEqual(restored, original);
  assert.ok(toCatalogProduct(jasmin.id, restored));
});

test('удаление со страницы товара: видимый товар заблокирован и в интерфейсе, и в сервисе', async () => {
  const fb = seedTwoVisible();
  const loaded = await fetchProductForEdit(fb, rose.id);
  assert.equal(deleteBlockReason(loaded.product, null), 'not-hidden');
  await rejectsWith(deleteProduct(fb, rose.id, loaded.updatedAt), 'not-hidden');
  assert.ok(fb.docs.has(rose.id));
});

test('удаление со страницы товара: витрина не остаётся пустой (демо-каталог не появляется)', async () => {
  const fb = seedTwoVisible();
  const shelf = await storefrontIds(fb);
  const loaded = await fetchProductForEdit(fb, jasmin.id);
  await deleteProduct(fb, jasmin.id, loaded.updatedAt);
  // Видимые товары те же — витрина продолжает читать Firestore, а не резервный каталог
  assert.deepEqual(await storefrontIds(fb), shelf);
  assert.ok(shelf.length > 0);
  // Счётчики списка после перезагрузки: удалённого товара нет
  const counts = countProductVisibility(await fetchAllProducts(fb));
  assert.equal(counts.total, fb.docs.size);
  assert.equal(counts.visible, shelf.length);
});

// ---------- Видимость на странице товара (подэтап 5в.5) ----------

test('видимость со страницы товара: скрыть с updatedAt формы → перечитать → сохранить форму без conflict', async () => {
  const fb = seedTwoVisible();
  const loaded = await fetchProductForEdit(fb, rose.id);
  const form = productToForm(loaded.product);
  const state = productVisibilityState({ product: loaded.product, damaged: loaded.damaged });
  assert.deepEqual(state, { status: 'visible', action: 'hide', blocked: null });

  const before = clone(fb.docs.get(rose.id));
  assert.deepEqual(await setProductHidden(fb, rose.id, state.action === 'hide', loaded.updatedAt), {
    id: rose.id,
    hidden: true,
    changed: true,
  });
  // Изменились только hidden и updatedAt
  const { updatedAt: _a, hidden: _b, ...rest } = fb.docs.get(rose.id);
  const { updatedAt: _c, hidden: _d, ...restBefore } = before;
  assert.deepEqual(rest, restBefore);

  // Страница перечитывает товар: форма та же, состояние «Скрыт», дата новая
  const fresh = await fetchProductForEdit(fb, rose.id);
  assert.equal(JSON.stringify(productToForm(fresh.product)), JSON.stringify(form));
  assert.equal(productVisibilityState({ product: fresh.product }).status, 'hidden');
  assert.ok(!fresh.updatedAt.isEqual(loaded.updatedAt));
  // Удаление теперь доступно
  assert.equal(deleteBlockReason(fresh.product, null), null);

  // Сохранение формы с новой датой проходит и не возвращает товар на витрину
  await updateProduct(fb, rose.id, formToProduct(form), fresh.updatedAt);
  assert.equal(fb.docs.get(rose.id).hidden, true);
  // Со старой датой — conflict (поэтому страница и перечитывает товар)
  await rejectsWith(updateProduct(fb, rose.id, formToProduct(form), loaded.updatedAt), 'conflict');
});

test('видимость со страницы товара: вернуть скрытый товар на витрину', async () => {
  const fb = seedTwoVisible();
  const loaded = await fetchProductForEdit(fb, jasmin.id);
  const state = productVisibilityState({ product: loaded.product });
  assert.deepEqual(state, { status: 'hidden', action: 'show', blocked: null });
  await setProductHidden(fb, jasmin.id, state.action === 'hide', loaded.updatedAt);
  assert.equal(fb.docs.get(jasmin.id).hidden, false);
  assert.ok((await storefrontIds(fb)).includes(jasmin.id));
  const fresh = await fetchProductForEdit(fb, jasmin.id);
  assert.equal(deleteBlockReason(fresh.product, null), 'not-hidden');
});

test('видимость со страницы товара: изменён в другой вкладке — conflict, предлагается загрузить версию', async () => {
  const fb = seedTwoVisible();
  const loaded = await fetchProductForEdit(fb, rose.id);
  // Другая вкладка сохранила товар
  const other = await fetchProductForEdit(fb, rose.id);
  await updateProduct(fb, rose.id, formToProduct(productToForm({ ...other.product, name: 'Другое название' })), other.updatedAt);
  const snapshot = clone(fb.docs.get(rose.id));

  await rejectsWith(setProductHidden(fb, rose.id, true, loaded.updatedAt), 'conflict');
  assert.deepEqual(fb.docs.get(rose.id), snapshot);
  assert.equal(visibilityErrorAction('conflict'), 'reload');
});

test('видимость со страницы товара: удалён в другой вкладке — not-found, возврат к списку', async () => {
  const fb = seedTwoVisible();
  const loaded = await fetchProductForEdit(fb, jasmin.id);
  await deleteProduct(fb, jasmin.id, loaded.updatedAt); // другая вкладка
  await rejectsWith(setProductHidden(fb, jasmin.id, false, loaded.updatedAt), 'not-found');
  assert.equal(fb.docs.has(jasmin.id), false); // документ не создан заново
  assert.equal(visibilityErrorAction('not-found'), 'list');
});

test('видимость со страницы товара: повреждённый документ — кнопка заблокирована, сервис отвечает damaged', async () => {
  const fb = seedTwoVisible();
  const loaded = await fetchProductForEdit(fb, 'broken');
  assert.equal(loaded.damaged, true);
  assert.deepEqual(productVisibilityState({ product: loaded.product, damaged: loaded.damaged }), {
    status: 'damaged',
    action: null,
    blocked: 'damaged',
  });
  await rejectsWith(setProductHidden(fb, 'broken', true, loaded.updatedAt), 'damaged');
});

test('видимость со страницы товара: последний видимый товар — last-visible, витрина не пустеет', async () => {
  const fb = seedTwoVisible();
  const third0 = await fetchProductForEdit(fb, third.id);
  await setProductHidden(fb, third.id, true, third0.updatedAt);
  const loaded = await fetchProductForEdit(fb, rose.id);
  await rejectsWith(setProductHidden(fb, rose.id, true, loaded.updatedAt), 'last-visible');
  assert.deepEqual(await storefrontIds(fb), [rose.id]);
  assert.equal(visibilityErrorAction('last-visible'), null);
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
    const fb = seedTwoVisible();
    const { product, updatedAt } = await fetchProductForEdit(fb, rose.id);
    const data = formToProduct(productToForm(product));
    const calls = [
      () => fetchAllProducts(fb),
      () => fetchProductForEdit(fb, rose.id),
      () => createProduct(fb, newProductData()),
      () => updateProduct(fb, rose.id, data, updatedAt),
      () => setProductHidden(fb, rose.id, true, updatedAt),
      () => setProductHidden(fb, jasmin.id, false, T0),
      () => deleteProduct(fb, jasmin.id, T0),
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

test('adminService: функции товаров подключены, удаление только в транзакции, правила не изменены', () => {
  const service = read('src/services/adminService.js');
  const names = ['fetchAllProducts', 'fetchProductForEdit', 'createProduct', 'updateProduct', 'setProductHidden', 'deleteProduct'];
  for (const name of names) {
    assert.match(service, new RegExp(`export const ${name} = [^;]*withFirebase\\(productsStore\\.${name}`), name);
  }
  assert.match(service, /export \{ AdminError \}/);
  const store = read('src/services/adminProductsStore.js');
  // Удаление — только tx.delete внутри транзакции deleteProduct, без deleteDoc и без batch
  for (const src of [service, store]) {
    assert.doesNotMatch(src, /deleteDoc|writeBatch/);
  }
  assert.doesNotMatch(service, /\.delete\(/);
  assert.equal(store.match(/\.delete\(/g).length, 1);
  assert.match(store, /tx\.delete\(ref\)/);
  // создание, изменение, скрытие и удаление — в транзакциях, время — от сервера
  assert.equal(store.match(/runTransaction\(/g).length, 4);
  assert.equal(store.match(/updatedAt: dbApi\.serverTimestamp\(\)/g).length, 3);
  // Правила products зафиксированы после ужесточения правила удаления (подэтап 5в.8).
  // Хешируется только блок products — правила других коллекций проверяются в своих тестах
  const rules = read('firestore.rules');
  const productsRules = rules.slice(rules.indexOf('match /products/{productId}'), rules.indexOf('// Всё остальное закрыто'));
  const hash = createHash('sha256').update(productsRules).digest('hex');
  assert.equal(hash, '3814cbafe602e328443bd9bcf0d23b85087c6624c430d8a06fe3d213c70b7837');
});

// ---------- Демо-каталог не подменяет реальный (подэтап 5в.6) ----------

test('весь каталог: скрыть всё по очереди, затем удалить скрытые — на витрине остаётся товар из Firestore', async () => {
  const fb = fakeFirebase(Object.fromEntries(products.map((p) => [p.id, stored(p)])));
  // Скрываем каждый товар со свежей датой из списка, как это делает страница «Товары»
  let blocked = 0;
  for (const p of products) {
    const { products: list } = await fetchAllProducts(fb);
    const row = list.find((x) => x.id === p.id);
    try {
      await setProductHidden(fb, p.id, true, row.updatedAt);
    } catch (err) {
      assert.equal(err.code, 'last-visible');
      blocked += 1;
    }
  }
  assert.equal(blocked, 1);
  const shelf = await storefrontIds(fb);
  assert.equal(shelf.length, 1);

  // Удаляем все скрытые со страницы товара
  for (const p of products) {
    if (shelf.includes(p.id)) continue;
    const loaded = await fetchProductForEdit(fb, p.id);
    await deleteProduct(fb, p.id, loaded.updatedAt);
  }
  // Видимый товар остался: запрос витрины hidden == false не пуст, резервный каталог не включится
  assert.deepEqual(await storefrontIds(fb), shelf);
  assert.equal(fb.docs.size, 1);
  const counts = countProductVisibility(await fetchAllProducts(fb));
  assert.deepEqual(counts, { total: 1, visible: 1, hidden: 0, damaged: 0 });
  // Последний товар нельзя ни скрыть, ни удалить
  const last = await fetchProductForEdit(fb, shelf[0]);
  await rejectsWith(setProductHidden(fb, shelf[0], true, last.updatedAt), 'last-visible');
  await rejectsWith(deleteProduct(fb, shelf[0], last.updatedAt), 'not-hidden');
});

test('витрина: резервный каталог включается только при пустом запросе hidden == false', () => {
  const api = read('src/services/productsApi.js');
  assert.match(api, /dbApi\.where\('hidden', '==', false\)/);
  assert.match(api, /if \(snap\.empty\) \{[^}]*source: 'fallback'/);
  // Документы есть, но ни один нельзя показать — ошибка, а не демо-каталог
  assert.match(api, /if \(items\.length === 0\) throw new Error\('invalidCatalog'\)/);
});
