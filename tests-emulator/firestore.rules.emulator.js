// Тесты firestore.rules на локальном Firebase Emulator (движок правил — настоящий).
// Модерация отзывов (этап D) и проверка, что правила users, orders, products, admins не сломаны.
//
// Запуск: npm run test:rules
// (= firebase emulators:exec --only firestore --project demo-aroma-donna "node --test tests-emulator/...")
// Проект demo-aroma-donna существует только в эмуляторе: настоящая база aroma-donna не используется.
// Нужна Java 21+. В обычный npm test этот файл не входит — без эмулятора он не запустится.
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import {
  addDoc,
  average,
  collection,
  collectionGroup,
  count,
  deleteDoc,
  deleteField,
  doc,
  getAggregateFromServer,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';

const PROJECT_ID = 'demo-aroma-donna';
const ADMIN_UID = 'admin-uid';
const CUSTOMER_UID = 'customer-uid';
const OTHER_UID = 'other-customer-uid';

let env;

// ---------- Тестовые данные (только в эмуляторе) ----------

const at = (iso) => Timestamp.fromDate(new Date(iso));
const REVIEWS = {
  approved1: { name: 'Айгерим', rating: 5, text: 'Одобренный отзыв номер один.', lang: 'ru', status: 'approved', createdAt: at('2026-11-01T07:08:12Z') },
  approved2: { name: 'Нурлан', rating: 4, text: 'Одобренный отзыв номер два.', lang: 'ky', status: 'approved', createdAt: at('2026-11-01T05:29:24Z') },
  pending1: { name: 'Гость', rating: 1, text: 'Отзыв ждёт модерации.', lang: 'ru', status: 'pending', createdAt: at('2026-11-04T10:00:00Z') },
  rejected1: { name: 'Спам', rating: 1, text: 'Отклонённый отзыв со спамом.', lang: 'en', status: 'rejected', createdAt: at('2026-11-04T11:00:00Z') },
};

const product = (id, hidden) => ({
  id,
  name: 'Test',
  brand: 'Brand',
  category: 'women',
  concentration: 'edp',
  fragranceFamily: 'floral',
  intensity: 'moderate',
  notes: { top: [], heart: [], base: [] },
  rating: 4.5,
  popularity: 50,
  availability: 'inStock',
  isNew: false,
  isBestseller: false,
  description: { ru: 'Описание', ky: 'Сүрөттөмө', en: 'Description' },
  volumes: [{ ml: 50, price: 1000 }],
  price: 1000,
  image: '/img.jpg',
  hidden,
  updatedAt: at('2026-11-01T00:00:00Z'),
});

const order = (uid, id) => ({ id, userId: uid, total: 1000, items: [{ id: 'p1', qty: 1 }], status: 'new', createdAt: at('2026-11-02T00:00:00Z') });

async function seed() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'admins', ADMIN_UID), { role: 'admin' });
    for (const [id, data] of Object.entries(REVIEWS)) await setDoc(doc(db, 'reviews', id), data);
    await setDoc(doc(db, 'users', CUSTOMER_UID), { name: 'Покупатель', email: 'c@example.com', createdAt: at('2026-10-01T00:00:00Z') });
    await setDoc(doc(db, 'users', OTHER_UID), { name: 'Другой', email: 'o@example.com', createdAt: at('2026-10-01T00:00:00Z') });
    await setDoc(doc(db, 'users', CUSTOMER_UID, 'orders', 'order1'), order(CUSTOMER_UID, 'order1'));
    await setDoc(doc(db, 'users', OTHER_UID, 'orders', 'order2'), order(OTHER_UID, 'order2'));
    await setDoc(doc(db, 'products', 'visible-one'), product('visible-one', false));
    await setDoc(doc(db, 'products', 'visible-two'), product('visible-two', false));
    await setDoc(doc(db, 'products', 'hidden-one'), product('hidden-one', true));
  });
}

// ---------- Пользователи ----------

const guestDb = () => env.unauthenticatedContext().firestore();
const customerDb = () => env.authenticatedContext(CUSTOMER_UID).firestore();
// Анонимный вход Firebase Authentication (signInAnonymously): uid есть, но это не администратор
const anonymousDb = () => env.authenticatedContext('anon-uid', { firebase: { sign_in_provider: 'anonymous' } }).firestore();
const adminDb = () => env.authenticatedContext(ADMIN_UID).firestore();

const VISITORS = [
  ['гость без входа', guestDb],
  ['обычный покупатель', customerDb],
  ['анонимный пользователь', anonymousDb],
];

// Отзыв так, как его отправляет сайт (reviewsStore.createReview)
const newReview = (overrides = {}) => ({
  name: 'Гость',
  rating: 5,
  text: 'Очень стойкий аромат, советую.',
  lang: 'ru',
  status: 'pending',
  createdAt: serverTimestamp(),
  ...overrides,
});
const approvedQuery = (db) => query(collection(db, 'reviews'), where('status', '==', 'approved'), orderBy('createdAt', 'desc'), limit(9));
const ids = (snap) => snap.docs.map((d) => d.id).sort();
const moderation = (status) => ({ status, moderatedAt: serverTimestamp() });

before(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
  });
  // Защита: тесты идут только в эмулятор и только в demo-проект
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'FIRESTORE_EMULATOR_HOST не задан — запускайте через npm run test:rules');
  assert.ok(PROJECT_ID.startsWith('demo-'));
});

beforeEach(async () => {
  await env.clearFirestore();
  await seed();
});

after(async () => {
  await env?.cleanup();
});

// ==================== reviews: создание ====================

describe('reviews: создание', () => {
  for (const [who, db] of VISITORS) {
    test(`${who}: может создать отзыв со статусом pending`, async () => {
      await assertSucceeds(addDoc(collection(db(), 'reviews'), newReview()));
    });

    test(`${who}: не может создать отзыв со статусом approved или rejected`, async () => {
      await assertFails(addDoc(collection(db(), 'reviews'), newReview({ status: 'approved' })));
      await assertFails(addDoc(collection(db(), 'reviews'), newReview({ status: 'rejected' })));
    });
  }

  test('гость: анонимный отзыв без входа и без lang (необязательное поле) — принимается', async () => {
    const { lang: _omit, ...withoutLang } = newReview();
    await assertSucceeds(addDoc(collection(guestDb(), 'reviews'), withoutLang));
    await assertSucceeds(setDoc(doc(guestDb(), 'reviews', 'guest-chosen-id'), newReview({ lang: 'en' })));
  });

  test('администратор тоже создаёт отзыв только со статусом pending', async () => {
    await assertSucceeds(addDoc(collection(adminDb(), 'reviews'), newReview()));
    await assertFails(addDoc(collection(adminDb(), 'reviews'), newReview({ status: 'approved' })));
  });

  test('без status, с неизвестным status или с moderatedAt — отклоняется', async () => {
    const { status: _omit, ...withoutStatus } = newReview();
    const db = guestDb();
    await assertFails(addDoc(collection(db, 'reviews'), withoutStatus));
    await assertFails(addDoc(collection(db, 'reviews'), newReview({ status: 'spam' })));
    await assertFails(addDoc(collection(db, 'reviews'), newReview({ status: 'Pending' })));
    await assertFails(addDoc(collection(db, 'reviews'), newReview({ moderatedAt: serverTimestamp() })));
  });

  test('формат отзыва проверяется: оценка, длины, язык, лишние поля, дата', async () => {
    const db = guestDb();
    const bad = [
      { rating: 6 },
      { rating: 0 },
      { rating: 4.5 },
      { rating: '5' },
      { name: 'A' },
      { name: 'x'.repeat(51) },
      { text: 'Коротко' },
      { text: 'x'.repeat(1001) },
      { lang: 'de' },
      { userId: 'someone' },
      { createdAt: at('2020-01-01T00:00:00Z') }, // дату ставит только сервер
    ];
    for (const overrides of bad) {
      await assertFails(addDoc(collection(db, 'reviews'), newReview(overrides)), JSON.stringify(overrides));
    }
  });

  test('нельзя перезаписать существующий отзыв через setDoc (это update, а не create)', async () => {
    await assertFails(setDoc(doc(guestDb(), 'reviews', 'approved1'), newReview()));
    await assertFails(setDoc(doc(customerDb(), 'reviews', 'rejected1'), newReview()));
  });
});

// ==================== reviews: чтение ====================

describe('reviews: чтение', () => {
  for (const [who, db] of VISITORS) {
    test(`${who}: публичный запрос (status == approved + orderBy createdAt) возвращает только approved`, async () => {
      const snap = await assertSucceeds(getDocs(approvedQuery(db())));
      assert.deepEqual(ids(snap), ['approved1', 'approved2']);
    });

    test(`${who}: может прочитать одобренный отзыв по ID`, async () => {
      const snap = await assertSucceeds(getDoc(doc(db(), 'reviews', 'approved1')));
      assert.equal(snap.data().status, 'approved');
    });

    test(`${who}: не может прочитать pending и rejected даже по ID`, async () => {
      await assertFails(getDoc(doc(db(), 'reviews', 'pending1')));
      await assertFails(getDoc(doc(db(), 'reviews', 'rejected1')));
    });

    test(`${who}: запрос без фильтра или с фильтром pending/rejected отклоняется целиком`, async () => {
      await assertFails(getDocs(collection(db(), 'reviews')));
      await assertFails(getDocs(query(collection(db(), 'reviews'), orderBy('createdAt', 'desc'))));
      await assertFails(getDocs(query(collection(db(), 'reviews'), where('status', '==', 'pending'))));
      await assertFails(getDocs(query(collection(db(), 'reviews'), where('status', 'in', ['approved', 'rejected']))));
    });

    test(`${who}: статистика (count + average) — только по approved, без фильтра отклоняется`, async () => {
      const approved = query(collection(db(), 'reviews'), where('status', '==', 'approved'));
      const snap = await assertSucceeds(getAggregateFromServer(approved, { count: count(), average: average('rating') }));
      assert.deepEqual(snap.data(), { count: 2, average: 4.5 });
      await assertFails(getAggregateFromServer(collection(db(), 'reviews'), { count: count() }));
    });
  }

  test('свой только что созданный pending-отзыв гость тоже не читает', async () => {
    const ref = await assertSucceeds(addDoc(collection(guestDb(), 'reviews'), newReview()));
    await assertFails(getDoc(doc(guestDb(), 'reviews', ref.id)));
  });

  test('администратор читает отзывы всех статусов: по ID, без фильтра, по любому статусу', async () => {
    const db = adminDb();
    for (const id of Object.keys(REVIEWS)) await assertSucceeds(getDoc(doc(db, 'reviews', id)));
    const all = await assertSucceeds(getDocs(query(collection(db, 'reviews'), orderBy('createdAt', 'desc'))));
    assert.deepEqual(ids(all), Object.keys(REVIEWS).sort());
    const pending = await assertSucceeds(getDocs(query(collection(db, 'reviews'), where('status', '==', 'pending'))));
    assert.deepEqual(ids(pending), ['pending1']);
    const total = await assertSucceeds(getAggregateFromServer(collection(db, 'reviews'), { count: count() }));
    assert.equal(total.data().count, 4);
  });
});

// ==================== reviews: модерация (update) ====================

describe('reviews: модерация', () => {
  test('администратор меняет статус на approved, rejected и обратно на pending (moderatedAt = время сервера)', async () => {
    const db = adminDb();
    const ref = doc(db, 'reviews', 'pending1');
    await assertSucceeds(updateDoc(ref, moderation('approved')));
    await assertSucceeds(updateDoc(ref, moderation('rejected')));
    await assertSucceeds(updateDoc(ref, moderation('pending')));
    const saved = (await getDoc(ref)).data();
    assert.equal(saved.status, 'pending');
    assert.ok(saved.moderatedAt instanceof Timestamp);
    // Остальные поля не изменились
    const { status: _s, moderatedAt: _m, ...rest } = saved;
    const { status: _s2, ...original } = REVIEWS.pending1;
    assert.deepEqual(rest, original);
  });

  test('moderatedAt должен быть временем запроса: своё время, отсутствие или удаление поля — отклоняются', async () => {
    const ref = doc(adminDb(), 'reviews', 'pending1');
    await assertFails(updateDoc(ref, { status: 'approved' }));
    await assertFails(updateDoc(ref, { status: 'approved', moderatedAt: at('2026-11-04T12:00:00Z') }));
    await assertFails(updateDoc(ref, { status: 'approved', moderatedAt: Timestamp.now() }));
    await assertFails(updateDoc(ref, { status: 'approved', moderatedAt: '2026-11-04' }));
    await assertSucceeds(updateDoc(ref, moderation('approved')));
    await assertFails(updateDoc(ref, { moderatedAt: deleteField() }));
  });

  test('администратор не может менять ничего, кроме status и moderatedAt', async () => {
    const ref = doc(adminDb(), 'reviews', 'pending1');
    for (const extra of [{ text: 'Подменённый текст отзыва.' }, { rating: 5 }, { name: 'Другое имя' }, { lang: 'en' }, { createdAt: serverTimestamp() }, { approvedBy: ADMIN_UID }]) {
      await assertFails(updateDoc(ref, { ...moderation('approved'), ...extra }), JSON.stringify(Object.keys(extra)));
    }
    // Только текст (с moderatedAt) — тоже нельзя
    await assertFails(updateDoc(ref, { text: 'Подменённый текст отзыва.', moderatedAt: serverTimestamp() }));
  });

  test('администратор не может поставить неизвестный статус или удалить status', async () => {
    const ref = doc(adminDb(), 'reviews', 'pending1');
    for (const status of ['spam', 'Approved', '', null, true]) {
      await assertFails(updateDoc(ref, { status, moderatedAt: serverTimestamp() }), String(status));
    }
    await assertFails(updateDoc(ref, { status: deleteField(), moderatedAt: serverTimestamp() }));
  });

  for (const [who, db] of VISITORS) {
    test(`${who}: не может изменить отзыв (ни статус, ни текст)`, async () => {
      await assertFails(updateDoc(doc(db(), 'reviews', 'pending1'), moderation('approved')));
      await assertFails(updateDoc(doc(db(), 'reviews', 'approved1'), moderation('rejected')));
      await assertFails(updateDoc(doc(db(), 'reviews', 'approved1'), { text: 'Подменённый текст отзыва.' }));
    });
  }
});

// ==================== reviews: удаление ====================

describe('reviews: удаление', () => {
  test('администратор навсегда удаляет только отклонённый отзыв', async () => {
    const db = adminDb();
    await assertSucceeds(deleteDoc(doc(db, 'reviews', 'rejected1')));
    assert.equal((await getDoc(doc(db, 'reviews', 'rejected1'))).exists(), false);
  });

  test('администратор не может удалить approved и pending', async () => {
    const db = adminDb();
    await assertFails(deleteDoc(doc(db, 'reviews', 'approved1')));
    await assertFails(deleteDoc(doc(db, 'reviews', 'pending1')));
  });

  test('удаление после отклонения: pending → rejected → delete', async () => {
    const ref = doc(adminDb(), 'reviews', 'pending1');
    await assertFails(deleteDoc(ref));
    await assertSucceeds(updateDoc(ref, moderation('rejected')));
    await assertSucceeds(deleteDoc(ref));
  });

  for (const [who, db] of VISITORS) {
    test(`${who}: не может удалить ни один отзыв, даже отклонённый`, async () => {
      for (const id of Object.keys(REVIEWS)) await assertFails(deleteDoc(doc(db(), 'reviews', id)));
    });
  }
});

// ==================== Остальные коллекции не сломаны ====================

describe('users', () => {
  test('покупатель читает и создаёт только свой профиль', async () => {
    const db = customerDb();
    await assertSucceeds(getDoc(doc(db, 'users', CUSTOMER_UID)));
    await assertFails(getDoc(doc(db, 'users', OTHER_UID)));
    await assertFails(getDocs(collection(db, 'users')));
    const fresh = env.authenticatedContext('new-uid').firestore();
    await assertSucceeds(setDoc(doc(fresh, 'users', 'new-uid'), { name: 'Новый', email: 'n@example.com', createdAt: serverTimestamp() }));
    await assertFails(setDoc(doc(fresh, 'users', 'someone-else'), { name: 'X', email: 'x@example.com', createdAt: serverTimestamp() }));
  });

  test('нельзя записать себе роль; удалить профиль нельзя', async () => {
    const db = customerDb();
    await assertFails(updateDoc(doc(db, 'users', CUSTOMER_UID), { isAdmin: true }));
    await assertFails(updateDoc(doc(db, 'users', CUSTOMER_UID), { role: 'admin' }));
    await assertSucceeds(updateDoc(doc(db, 'users', CUSTOMER_UID), { name: 'Новое имя' }));
    await assertFails(deleteDoc(doc(db, 'users', CUSTOMER_UID)));
  });

  test('администратор только читает профили; гость не читает', async () => {
    await assertSucceeds(getDoc(doc(adminDb(), 'users', CUSTOMER_UID)));
    await assertSucceeds(getDocs(collection(adminDb(), 'users')));
    await assertFails(updateDoc(doc(adminDb(), 'users', CUSTOMER_UID), { name: 'Админ поменял' }));
    await assertFails(getDoc(doc(guestDb(), 'users', CUSTOMER_UID)));
  });
});

describe('orders', () => {
  test('покупатель создаёт и читает только свои заказы, менять не может', async () => {
    const db = customerDb();
    await assertSucceeds(setDoc(doc(db, 'users', CUSTOMER_UID, 'orders', 'order3'), order(CUSTOMER_UID, 'order3')));
    await assertFails(setDoc(doc(db, 'users', CUSTOMER_UID, 'orders', 'order4'), { ...order(CUSTOMER_UID, 'order4'), status: 'delivered' }));
    await assertFails(setDoc(doc(db, 'users', OTHER_UID, 'orders', 'order5'), order(OTHER_UID, 'order5')));
    await assertSucceeds(getDoc(doc(db, 'users', CUSTOMER_UID, 'orders', 'order1')));
    await assertFails(getDoc(doc(db, 'users', OTHER_UID, 'orders', 'order2')));
    await assertFails(updateDoc(doc(db, 'users', CUSTOMER_UID, 'orders', 'order1'), { status: 'cancelled', statusUpdatedAt: serverTimestamp() }));
    await assertFails(deleteDoc(doc(db, 'users', CUSTOMER_UID, 'orders', 'order1')));
    await assertFails(getDocs(collectionGroup(db, 'orders')));
  });

  test('администратор читает все заказы и меняет только статус', async () => {
    const db = adminDb();
    const all = await assertSucceeds(getDocs(collectionGroup(db, 'orders')));
    assert.deepEqual(ids(all), ['order1', 'order2']);
    const ref = doc(db, 'users', CUSTOMER_UID, 'orders', 'order1');
    await assertSucceeds(updateDoc(ref, { status: 'shipped', statusUpdatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { status: 'lost', statusUpdatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { total: 1, statusUpdatedAt: serverTimestamp() }));
    await assertFails(deleteDoc(ref));
  });
});

describe('products', () => {
  test('посетитель читает только видимые товары (запрос с hidden == false)', async () => {
    const db = guestDb();
    const snap = await assertSucceeds(getDocs(query(collection(db, 'products'), where('hidden', '==', false))));
    assert.deepEqual(ids(snap), ['visible-one', 'visible-two']);
    await assertSucceeds(getDoc(doc(db, 'products', 'visible-one')));
    await assertFails(getDoc(doc(db, 'products', 'hidden-one')));
    await assertFails(getDocs(collection(db, 'products')));
  });

  test('посетитель и покупатель не пишут товары', async () => {
    for (const db of [guestDb(), customerDb()]) {
      await assertFails(setDoc(doc(db, 'products', 'new-one'), { ...product('new-one', false), updatedAt: serverTimestamp() }));
      await assertFails(updateDoc(doc(db, 'products', 'visible-one'), { price: 1 }));
      await assertFails(deleteDoc(doc(db, 'products', 'hidden-one')));
    }
  });

  test('администратор: читает все, создаёт в строгом формате, удаляет только скрытые (5c.8)', async () => {
    const db = adminDb();
    await assertSucceeds(getDocs(collection(db, 'products')));
    await assertSucceeds(setDoc(doc(db, 'products', 'new-one'), { ...product('new-one', false), updatedAt: serverTimestamp() }));
    await assertFails(setDoc(doc(db, 'products', 'bad-one'), { ...product('bad-one', false), price: -1, updatedAt: serverTimestamp() }));
    await assertFails(deleteDoc(doc(db, 'products', 'visible-one')));
    await assertSucceeds(deleteDoc(doc(db, 'products', 'hidden-one')));
  });
});

describe('admins и остальное', () => {
  test('пользователь читает только свой документ admins; список и запись запрещены всем', async () => {
    await assertSucceeds(getDoc(doc(adminDb(), 'admins', ADMIN_UID)));
    await assertSucceeds(getDoc(doc(customerDb(), 'admins', CUSTOMER_UID))); // «документа нет» → не админ
    await assertFails(getDoc(doc(customerDb(), 'admins', ADMIN_UID)));
    await assertFails(getDoc(doc(guestDb(), 'admins', ADMIN_UID)));
    await assertFails(getDocs(collection(adminDb(), 'admins')));
    await assertFails(setDoc(doc(customerDb(), 'admins', CUSTOMER_UID), { role: 'admin' }));
    await assertFails(setDoc(doc(adminDb(), 'admins', 'new-admin'), { role: 'admin' }));
    await assertFails(deleteDoc(doc(adminDb(), 'admins', ADMIN_UID)));
  });

  test('неописанные коллекции закрыты для всех, включая администратора', async () => {
    for (const db of [guestDb(), customerDb(), adminDb()]) {
      await assertFails(getDoc(doc(db, 'secrets', 'x')));
      await assertFails(setDoc(doc(db, 'secrets', 'x'), { a: 1 }));
    }
  });
});
