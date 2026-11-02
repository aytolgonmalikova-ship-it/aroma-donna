// Товары в Firestore для админ-панели: загрузка всех товаров, создание и изменение (этап 5б),
// скрытие, возвращение на витрину и окончательное удаление (этап 5в).
// Функции получают подключение { db, dbApi } параметром — adminService.js передаёт настоящий Firebase,
// а tests/adminProductsStore.test.js — модель Firestore в памяти.
//
// Правила firestore.rules: читать все товары (и скрытые) и писать может только администратор,
// документ проверяется функцией isValidProduct — тот же формат проверяет validateProductData.
// Правила разрешают create и update одинаково, поэтому защита от перезаписи — транзакция здесь.

import { AdminError, toAdminError } from './adminErrors.js';
import { ID_PATTERN, LIMITS, toCatalogProduct, validateProductData } from '../utils/products.js';

const COLLECTION = 'products';

/** Ошибка формата: список полей — в err.fields (как у validateProductData) */
function invalidError(fields) {
  const err = new AdminError('invalid');
  err.fields = fields;
  return err;
}

const isProductId = (id) => typeof id === 'string' && id.length <= LIMITS.id && ID_PATTERN.test(id);

/** Timestamp Firestore или строка → ISO-строка (для сравнения с датой из списка товаров) */
const toIso = (v) => (typeof v === 'string' ? v : v?.toDate ? v.toDate().toISOString() : null);

/**
 * Одинаковое ли время изменения: Timestamp Firestore сравнивается через isEqual.
 * Нет даты у обоих — одинаково (старый документ без updatedAt).
 * Список товаров хранит дату ISO-строкой — тогда сравниваются ISO-строки.
 */
export function sameUpdatedAt(a, b) {
  if (!a || !b) return !a && !b;
  if (typeof a === 'string' || typeof b === 'string') return toIso(a) === toIso(b);
  if (typeof a.isEqual === 'function') return a.isEqual(b);
  return a === b;
}

/**
 * Все товары, включая скрытые (запрос без фильтра разрешён только администратору).
 * Возвращает { products, invalidIds }: повреждённые документы не ломают список, их id показываются отдельно.
 */
export async function fetchAllProducts({ db, dbApi }) {
  try {
    const snap = await dbApi.getDocs(dbApi.collection(db, COLLECTION));
    const products = [];
    const invalidIds = [];
    snap.docs.forEach((d) => {
      const product = toCatalogProduct(d.id, d.data());
      if (product) products.push(product);
      else invalidIds.push(d.id);
    });
    return { products, invalidIds };
  } catch (err) {
    throw toAdminError(err);
  }
}

/**
 * Один товар для формы редактирования.
 * Возвращает { product, damaged, updatedAt, raw }: updatedAt — исходный Timestamp, его нужно передать
 * в updateProduct и deleteProduct для проверки конфликта; raw — документ как есть (для JSON-копии перед удалением).
 * Повреждённый документ тоже открывается (damaged: true), чтобы его можно было исправить.
 */
export async function fetchProductForEdit({ db, dbApi }, id) {
  try {
    if (!isProductId(id)) throw new AdminError('not-found');
    const snap = await dbApi.getDoc(dbApi.doc(db, COLLECTION, id));
    if (!snap.exists()) throw new AdminError('not-found');
    const data = snap.data();
    const product = toCatalogProduct(id, data);
    return {
      product: product || { ...data, id },
      damaged: !product,
      updatedAt: data.updatedAt ?? null,
      raw: data,
    };
  } catch (err) {
    throw toAdminError(err);
  }
}

/**
 * Создание товара. Транзакция читает products/{id}: если документ уже есть — ошибка id-taken,
 * ничего не записывается (существующий товар не перезаписывается).
 * Новый товар всегда видимый (hidden: false); скрыть его можно потом через setProductHidden.
 * Возвращает id созданного товара.
 */
export async function createProduct({ db, dbApi }, data) {
  try {
    const product = { ...data, hidden: false };
    const errors = validateProductData(product);
    if (errors.length) throw invalidError(errors);

    const ref = dbApi.doc(db, COLLECTION, product.id);
    await dbApi.runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists()) throw new AdminError('id-taken');
      tx.set(ref, { ...product, updatedAt: dbApi.serverTimestamp() });
    });
    return product.id;
  } catch (err) {
    throw toAdminError(err);
  }
}

/**
 * Изменение товара. Транзакция:
 * 1) читает текущий документ — нет документа → not-found;
 * 2) сравнивает updatedAt с тем, что был при открытии формы — отличается → conflict
 *    (товар изменили в другой вкладке, чужие правки не затираются);
 * 3) сохраняет исходный id (id документа) и hidden (из текущего документа, а не из формы);
 * 4) записывает документ целиком с updatedAt = serverTimestamp().
 * Документ без поля hidden витрина и так не показывает, поэтому он остаётся скрытым (hidden: true).
 */
export async function updateProduct({ db, dbApi }, id, data, loadedUpdatedAt) {
  try {
    if (!isProductId(id)) throw new AdminError('not-found');
    // Ранняя проверка формата — без обращения к серверу (hidden уточняется в транзакции)
    const precheck = validateProductData({ ...data, id, hidden: false });
    if (precheck.length) throw invalidError(precheck);

    const ref = dbApi.doc(db, COLLECTION, id);
    await dbApi.runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new AdminError('not-found');
      const current = snap.data();
      if (!sameUpdatedAt(current.updatedAt ?? null, loadedUpdatedAt ?? null)) throw new AdminError('conflict');

      const product = { ...data, id, hidden: current.hidden !== false };
      const errors = validateProductData(product);
      if (errors.length) throw invalidError(errors);
      tx.set(ref, { ...product, updatedAt: dbApi.serverTimestamp() });
    });
    return id;
  } catch (err) {
    throw toAdminError(err);
  }
}

// ---------- Скрытие и удаление (этап 5в) ----------
// Главное правило: на витрине всегда остаётся хотя бы один видимый корректный товар.
// Если видимых товаров нет, витрина показывает резервный демо-каталог (productsApi.js),
// и покупатели увидели бы демо-товары, в том числе скрытые и удалённые.

/** Товар видим на витрине: hidden == false (как в запросе витрины) и документ можно показать */
const isStorefrontVisible = (id, data) => data?.hidden === false && toCatalogProduct(id, data) !== null;

/** Документ проходит проверку формата целиком, как isValidProduct в правилах (иначе любое изменение отклонят) */
function isIntactProduct(id, data) {
  const { updatedAt: _ignored, ...rest } = data;
  return rest.id === id && validateProductData(rest).length === 0;
}

/** id видимых на витрине товаров, кроме exceptId — кандидаты, которые останутся после действия */
async function findOtherVisibleIds({ db, dbApi }, exceptId) {
  const snap = await dbApi.getDocs(
    dbApi.query(dbApi.collection(db, COLLECTION), dbApi.where('hidden', '==', false)),
  );
  return snap.docs.filter((d) => d.id !== exceptId && isStorefrontVisible(d.id, d.data())).map((d) => d.id);
}

/**
 * Внутри транзакции: убедиться, что хотя бы один из кандидатов всё ещё видим, иначе last-visible.
 * Прочитанный документ попадает в транзакцию: если его одновременно скроют в другой вкладке,
 * Firestore повторит транзакцию, и два администратора не смогут вместе скрыть последние товары.
 */
async function ensureAnotherVisible(tx, { db, dbApi }, candidateIds) {
  for (const otherId of candidateIds) {
    const snap = await tx.get(dbApi.doc(db, COLLECTION, otherId));
    if (snap.exists() && isStorefrontVisible(otherId, snap.data())) return;
  }
  throw new AdminError('last-visible');
}

/**
 * Скрыть (hidden: true) или вернуть на витрину (hidden: false) товар.
 * Транзакция:
 * 1) нет документа → not-found; updatedAt не совпадает с тем, что видел администратор → conflict;
 * 2) повреждённый документ → damaged (правила всё равно отклонили бы запись — сначала исправить в форме);
 * 3) статус уже такой → ничего не записывается (changed: false);
 * 4) скрытие последнего видимого товара → last-visible;
 * 5) записываются только поля hidden и updatedAt = serverTimestamp() — остальные данные не меняются.
 * loadedUpdatedAt — Timestamp (форма) или ISO-строка (список). Возвращает { id, hidden, changed }.
 */
export async function setProductHidden(fb, id, hidden, loadedUpdatedAt) {
  const { db, dbApi } = fb;
  try {
    if (!isProductId(id)) throw new AdminError('not-found');
    if (typeof hidden !== 'boolean') throw new AdminError('invalid');
    const candidates = hidden ? await findOtherVisibleIds(fb, id) : [];

    const ref = dbApi.doc(db, COLLECTION, id);
    return await dbApi.runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new AdminError('not-found');
      const current = snap.data();
      if (!sameUpdatedAt(current.updatedAt ?? null, loadedUpdatedAt ?? null)) throw new AdminError('conflict');
      if (!isIntactProduct(id, current)) throw new AdminError('damaged');
      if (current.hidden === hidden) return { id, hidden, changed: false };
      if (hidden) await ensureAnotherVisible(tx, fb, candidates);
      tx.update(ref, { hidden, updatedAt: dbApi.serverTimestamp() });
      return { id, hidden, changed: true };
    });
  } catch (err) {
    throw toAdminError(err);
  }
}

/**
 * Окончательное удаление товара. Удалить можно только скрытый товар («сначала скрыть, потом удалить»):
 * тогда удаление не меняет витрину, корзины и избранное покупателей. Заказы не затрагиваются —
 * в них хранится копия позиции (название, бренд, объём, цена).
 * Транзакция:
 * 1) нет документа → not-found; updatedAt не совпадает → conflict (товар изменили или вернули на витрину);
 * 2) hidden !== true → not-hidden: удалить можно только скрытый товар (то же требует правило delete в firestore.rules).
 *    Документ без поля hidden или с hidden не boolean сначала нужно исправить в форме и скрыть;
 * 3) на витрине не останется видимых товаров → last-visible (иначе покупатели увидят демо-каталог);
 * 4) tx.delete.
 * Возвращает id удалённого товара.
 */
export async function deleteProduct(fb, id, loadedUpdatedAt) {
  const { db, dbApi } = fb;
  try {
    if (!isProductId(id)) throw new AdminError('not-found');
    const candidates = await findOtherVisibleIds(fb, id);

    const ref = dbApi.doc(db, COLLECTION, id);
    await dbApi.runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new AdminError('not-found');
      const current = snap.data();
      if (!sameUpdatedAt(current.updatedAt ?? null, loadedUpdatedAt ?? null)) throw new AdminError('conflict');
      if (current.hidden !== true) throw new AdminError('not-hidden');
      await ensureAnotherVisible(tx, fb, candidates);
      tx.delete(ref);
    });
    return id;
  } catch (err) {
    throw toAdminError(err);
  }
}
