// Товары в Firestore для админ-панели (этап 5б): загрузка всех товаров, создание и изменение.
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

/**
 * Одинаковое ли время изменения: Timestamp Firestore сравнивается через isEqual.
 * Нет даты у обоих — одинаково (старый документ без updatedAt).
 */
export function sameUpdatedAt(a, b) {
  if (!a || !b) return !a && !b;
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
 * Возвращает { product, updatedAt }: updatedAt — исходный Timestamp, его нужно передать в updateProduct
 * для проверки конфликта. Повреждённый документ тоже открывается (damaged: true), чтобы его можно было исправить.
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
    };
  } catch (err) {
    throw toAdminError(err);
  }
}

/**
 * Создание товара. Транзакция читает products/{id}: если документ уже есть — ошибка id-taken,
 * ничего не записывается (существующий товар не перезаписывается).
 * Новый товар всегда видимый (hidden: false) — скрытие появится на этапе 5в.
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
