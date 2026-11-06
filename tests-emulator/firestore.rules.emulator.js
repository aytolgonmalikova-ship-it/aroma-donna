// Тесты firestore.rules на локальном Firebase Emulator (движок правил — настоящий).
// Модерация отзывов (этап D), роли администраторов owner и admin (этап A3)
// и проверка, что правила users, orders, products не сломаны.
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
  writeBatch,
} from 'firebase/firestore';
import {
  ADMIN2_UID,
  BAD_UIDS,
  CANDIDATE_UID,
  GHOST_UID,
  NEWBIE2_UID,
  NEWBIE_UID,
  OWNER_UID,
  T0,
  seedAdminRoles,
} from './fixtures/adminRoles.js';

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
  test('покупатель читает только свои заказы; создать (даже свой, C3.3 — только сервер) и менять не может', async () => {
    const db = customerDb();
    await assertFails(setDoc(doc(db, 'users', CUSTOMER_UID, 'orders', 'order3'), order(CUSTOMER_UID, 'order3')));
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

// ==================== Администраторы: роли owner и admin (этап A3) ====================
// owner — UID в adminConfig/primary.ownerUid; admin — любой документ admins/{uid}.
// Общий seed() выше не создаёт adminConfig (так проверяется «конфигурации ещё нет»);
// здесь роли засеиваются отдельно — seedRoles().

const ownerDb = () => env.authenticatedContext(OWNER_UID).firestore();
const admin2Db = () => env.authenticatedContext(ADMIN2_UID).firestore();
const candidateDb = () => env.authenticatedContext(CANDIDATE_UID).firestore();
const newbieDb = () => env.authenticatedContext(NEWBIE_UID).firestore();
const configRef = (db) => doc(db, 'adminConfig', 'primary');
const adminRef = (db, uid) => doc(db, 'admins', uid);

const grant = (by, extra = {}) => ({ grantedAt: serverTimestamp(), grantedBy: by, ...extra });
// Изменение adminConfig так, как его делает интерфейс: только нужные поля + updatedAt/updatedBy
const configChange = (uid, changes) => ({ ...changes, updatedAt: serverTimestamp(), updatedBy: uid });
const offer = (to) => configChange(OWNER_UID, { pendingOwnerUid: to });
const accept = (uid, previous = OWNER_UID) => configChange(uid, { ownerUid: uid, previousOwnerUid: previous, pendingOwnerUid: null });
const clearOffer = (uid) => configChange(uid, { pendingOwnerUid: null });

/** Роли: владелец, обычный администратор, кандидат; config = null — без adminConfig/primary */
const seedRoles = (options) => seedAdminRoles(env, options);

/** Прочитать документ в обход правил (проверка результата) */
async function readRaw(path) {
  let data;
  await env.withSecurityRulesDisabled(async (ctx) => {
    const snap = await getDoc(doc(ctx.firestore(), ...path.split('/')));
    data = snap.exists() ? snap.data() : null;
  });
  return data;
}

/** Может ли пользователь пользоваться админ-разделами (все заказы — только isAdmin()) */
const canUseAdminSections = (db) => getDocs(collectionGroup(db, 'orders'));

describe('администраторы: чтение', () => {
  test('свой документ admins читает каждый вошедший (нет документа — «не админ»), гость — нет', async () => {
    await seedRoles();
    for (const [uid, db] of [[OWNER_UID, ownerDb], [ADMIN2_UID, admin2Db], [ADMIN_UID, adminDb], [NEWBIE_UID, newbieDb], [CUSTOMER_UID, customerDb]]) {
      await assertSucceeds(getDoc(adminRef(db(), uid)));
    }
    await assertFails(getDoc(adminRef(guestDb(), OWNER_UID)));
  });

  test('чужой документ и список администраторов — только владельцу', async () => {
    await seedRoles();
    await assertSucceeds(getDoc(adminRef(ownerDb(), ADMIN2_UID)));
    const list = await assertSucceeds(getDocs(collection(ownerDb(), 'admins')));
    assert.deepEqual(ids(list), [ADMIN_UID, ADMIN2_UID, CANDIDATE_UID, OWNER_UID].sort());
    for (const db of [admin2Db, candidateDb, adminDb, customerDb, newbieDb, guestDb]) {
      await assertFails(getDoc(adminRef(db(), OWNER_UID)));
      await assertFails(getDocs(collection(db(), 'admins')));
    }
  });

  test('adminConfig/primary читает владелец и тот, кому предложена роль; список — никто', async () => {
    await seedRoles({ pending: CANDIDATE_UID });
    await assertSucceeds(getDoc(configRef(ownerDb())));
    await assertSucceeds(getDoc(configRef(candidateDb())));
    for (const db of [admin2Db, adminDb, customerDb, newbieDb, guestDb]) await assertFails(getDoc(configRef(db())));
    for (const db of [ownerDb, candidateDb, admin2Db]) await assertFails(getDocs(collection(db(), 'adminConfig')));
  });

  test('без предложения кандидат adminConfig не читает', async () => {
    await seedRoles();
    await assertFails(getDoc(configRef(candidateDb())));
  });
});

describe('администраторы: назначение', () => {
  test('владелец назначает зарегистрированного пользователя; новый администратор сразу работает в разделах', async () => {
    await seedRoles();
    await assertFails(canUseAdminSections(newbieDb()));
    await assertSucceeds(setDoc(adminRef(ownerDb(), NEWBIE_UID), grant(OWNER_UID)));
    await assertSucceeds(setDoc(adminRef(ownerDb(), NEWBIE2_UID), grant(OWNER_UID, { label: 'С'.repeat(100) })));
    await assertSucceeds(canUseAdminSections(newbieDb()));
    // ...но управлять администраторами новый администратор не может
    await assertFails(getDocs(collection(newbieDb(), 'admins')));
    const saved = await readRaw(`admins/${NEWBIE_UID}`);
    assert.equal(saved.grantedBy, OWNER_UID);
    assert.ok(saved.grantedAt instanceof Timestamp);
  });

  test('никто, кроме владельца, не назначает администраторов, в том числе самого себя', async () => {
    await seedRoles();
    for (const [uid, db] of [[ADMIN2_UID, admin2Db], [CANDIDATE_UID, candidateDb], [ADMIN_UID, adminDb], [NEWBIE_UID, newbieDb], [CUSTOMER_UID, customerDb]]) {
      await assertFails(setDoc(adminRef(db(), NEWBIE2_UID), grant(uid)));
      await assertFails(setDoc(adminRef(db(), uid), grant(uid))); // самоназначение
    }
    await assertFails(setDoc(adminRef(guestDb(), NEWBIE_UID), grant('guest')));
    // Владелец не создаёт документ себе (свой документ у него уже есть — это изменение, а изменение запрещено)
    await assertFails(setDoc(adminRef(ownerDb(), OWNER_UID), grant(OWNER_UID)));
  });

  test('нельзя назначить UID без профиля users/{uid} или UID неверного формата', async () => {
    await seedRoles();
    await assertFails(setDoc(adminRef(ownerDb(), GHOST_UID), grant(OWNER_UID)));
    for (const uid of BAD_UIDS) await assertFails(setDoc(adminRef(ownerDb(), uid), grant(OWNER_UID)));
  });

  test('строгий формат документа: только grantedAt, grantedBy и необязательный label', async () => {
    await seedRoles();
    const bad = [
      { ...grant(OWNER_UID), role: 'owner' },
      { ...grant(OWNER_UID), email: 'x@example.com' },
      { grantedAt: serverTimestamp() },
      { grantedBy: OWNER_UID },
      grant(ADMIN2_UID), // чужой UID в grantedBy
      { grantedAt: T0, grantedBy: OWNER_UID }, // своё время вместо серверного
      grant(OWNER_UID, { label: '' }),
      grant(OWNER_UID, { label: '   ' }),
      grant(OWNER_UID, { label: 'x'.repeat(101) }),
      grant(OWNER_UID, { label: 42 }),
    ];
    for (const data of bad) await assertFails(setDoc(adminRef(ownerDb(), NEWBIE_UID), data));
    assert.equal(await readRaw(`admins/${NEWBIE_UID}`), null);
  });

  test('существующий документ администратора нельзя перезаписать', async () => {
    await seedRoles();
    await assertFails(setDoc(adminRef(ownerDb(), ADMIN2_UID), grant(OWNER_UID)));
    await assertFails(setDoc(adminRef(ownerDb(), ADMIN2_UID), grant(OWNER_UID, { label: 'Новая подпись' })));
  });
});

describe('администраторы: изменение и отзыв доступа', () => {
  test('документы admins не изменяет никто, включая владельца и самого администратора', async () => {
    await seedRoles();
    await assertFails(updateDoc(adminRef(ownerDb(), ADMIN2_UID), { label: 'Другая' }));
    await assertFails(updateDoc(adminRef(ownerDb(), OWNER_UID), { label: 'Я' }));
    await assertFails(updateDoc(adminRef(admin2Db(), ADMIN2_UID), { role: 'owner' }));
    await assertFails(updateDoc(adminRef(adminDb(), ADMIN_UID), { role: 'owner' }));
  });

  test('владелец отзывает доступ обычного администратора — права пропадают сразу', async () => {
    await seedRoles();
    await assertSucceeds(canUseAdminSections(admin2Db()));
    await assertSucceeds(deleteDoc(adminRef(ownerDb(), ADMIN2_UID)));
    await assertFails(canUseAdminSections(admin2Db()));
    await assertFails(getDocs(query(collection(admin2Db(), 'reviews'), where('status', '==', 'pending'))));
    // Старый документ (поле role) тоже отзывается
    await assertSucceeds(deleteDoc(adminRef(ownerDb(), ADMIN_UID)));
  });

  test('нельзя отозвать доступ у себя, у владельца и у того, кому предложена роль', async () => {
    await seedRoles({ pending: CANDIDATE_UID });
    await assertFails(deleteDoc(adminRef(ownerDb(), OWNER_UID)));
    await assertFails(deleteDoc(adminRef(ownerDb(), CANDIDATE_UID)));
    // После отмены предложения — можно
    await assertSucceeds(updateDoc(configRef(ownerDb()), clearOffer(OWNER_UID)));
    await assertSucceeds(deleteDoc(adminRef(ownerDb(), CANDIDATE_UID)));
  });

  test('обычный администратор и посетители никого не удаляют', async () => {
    await seedRoles();
    for (const db of [admin2Db, candidateDb, adminDb, customerDb, guestDb]) {
      for (const uid of [OWNER_UID, ADMIN2_UID, CANDIDATE_UID]) await assertFails(deleteDoc(adminRef(db(), uid)));
    }
  });
});

describe('передача роли владельца: предложение', () => {
  test('владелец предлагает роль действующему администратору и может заменить предложение', async () => {
    await seedRoles();
    await assertSucceeds(updateDoc(configRef(ownerDb()), offer(ADMIN2_UID)));
    await assertSucceeds(updateDoc(configRef(ownerDb()), offer(CANDIDATE_UID)));
    const cfg = await readRaw('adminConfig/primary');
    assert.equal(cfg.pendingOwnerUid, CANDIDATE_UID);
    assert.equal(cfg.ownerUid, OWNER_UID, 'предложение не меняет владельца');
    assert.equal(cfg.updatedBy, OWNER_UID);
  });

  test('нельзя предложить роль себе, не администратору, UID без профиля или неверного формата', async () => {
    await seedRoles();
    for (const to of [OWNER_UID, NEWBIE_UID, GHOST_UID, 'bad.uid', '', 42]) {
      await assertFails(updateDoc(configRef(ownerDb()), offer(to)));
    }
  });

  test('обычный администратор и посетители предложение не делают — себе тоже', async () => {
    await seedRoles();
    for (const [uid, db] of [[ADMIN2_UID, admin2Db], [CANDIDATE_UID, candidateDb], [ADMIN_UID, adminDb], [NEWBIE_UID, newbieDb]]) {
      await assertFails(updateDoc(configRef(db()), configChange(uid, { pendingOwnerUid: uid })));
      await assertFails(updateDoc(configRef(db()), configChange(uid, { pendingOwnerUid: CANDIDATE_UID })));
    }
  });

  test('предложение не меняет ownerUid и previousOwnerUid, только с updatedAt = время сервера и updatedBy = свой UID', async () => {
    await seedRoles();
    const cfg = configRef(ownerDb());
    await assertFails(updateDoc(cfg, configChange(OWNER_UID, { pendingOwnerUid: CANDIDATE_UID, ownerUid: CANDIDATE_UID })));
    await assertFails(updateDoc(cfg, configChange(OWNER_UID, { pendingOwnerUid: CANDIDATE_UID, previousOwnerUid: ADMIN2_UID })));
    await assertFails(updateDoc(cfg, { pendingOwnerUid: CANDIDATE_UID, updatedAt: T0, updatedBy: OWNER_UID }));
    await assertFails(updateDoc(cfg, { pendingOwnerUid: CANDIDATE_UID, updatedAt: serverTimestamp(), updatedBy: ADMIN2_UID }));
    await assertFails(updateDoc(cfg, { pendingOwnerUid: CANDIDATE_UID, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(cfg, { ...offer(CANDIDATE_UID), note: 'лишнее поле' }));
    await assertFails(updateDoc(cfg, { ...offer(CANDIDATE_UID), updatedBy: deleteField() }));
    await assertFails(updateDoc(cfg, { ...offer(CANDIDATE_UID), previousOwnerUid: deleteField() }));
  });
});

describe('передача роли владельца: принятие, отмена, отклонение', () => {
  test('кандидат принимает роль: он — владелец, прежний владелец — обычный администратор', async () => {
    await seedRoles({ pending: CANDIDATE_UID });
    await assertSucceeds(updateDoc(configRef(candidateDb()), accept(CANDIDATE_UID)));
    const cfg = await readRaw('adminConfig/primary');
    assert.deepEqual(
      { ownerUid: cfg.ownerUid, pendingOwnerUid: cfg.pendingOwnerUid, previousOwnerUid: cfg.previousOwnerUid, updatedBy: cfg.updatedBy },
      { ownerUid: CANDIDATE_UID, pendingOwnerUid: null, previousOwnerUid: OWNER_UID, updatedBy: CANDIDATE_UID },
    );
    // Новый владелец управляет администраторами
    await assertSucceeds(getDocs(collection(candidateDb(), 'admins')));
    await assertSucceeds(setDoc(adminRef(candidateDb(), NEWBIE_UID), grant(CANDIDATE_UID)));
    // Прежний владелец — обычный администратор: разделы работают, управление ролями — нет
    await assertSucceeds(canUseAdminSections(ownerDb()));
    await assertFails(getDocs(collection(ownerDb(), 'admins')));
    await assertFails(getDoc(configRef(ownerDb())));
    await assertFails(updateDoc(configRef(ownerDb()), offer(ADMIN2_UID)));
    await assertFails(deleteDoc(adminRef(ownerDb(), NEWBIE_UID)));
    // Новый владелец может отозвать доступ прежнего
    await assertSucceeds(deleteDoc(adminRef(candidateDb(), OWNER_UID)));
  });

  test('ownerUid меняется только при принятии самим назначенным администратором', async () => {
    await seedRoles({ pending: CANDIDATE_UID });
    // Владелец не может «принять» за кандидата
    await assertFails(updateDoc(configRef(ownerDb()), configChange(OWNER_UID, { ownerUid: CANDIDATE_UID, previousOwnerUid: OWNER_UID, pendingOwnerUid: null })));
    // Другой администратор не может принять чужое предложение ни на себя, ни на кандидата
    await assertFails(updateDoc(configRef(admin2Db()), accept(ADMIN2_UID)));
    await assertFails(updateDoc(configRef(admin2Db()), configChange(ADMIN2_UID, { ownerUid: CANDIDATE_UID, previousOwnerUid: OWNER_UID, pendingOwnerUid: null })));
    await assertFails(updateDoc(configRef(newbieDb()), accept(NEWBIE_UID)));
    await assertFails(updateDoc(configRef(guestDb()), accept(GHOST_UID)));
    assert.equal((await readRaw('adminConfig/primary')).ownerUid, OWNER_UID);
  });

  test('принятие — только точным набором значений', async () => {
    await seedRoles({ pending: CANDIDATE_UID });
    const cfg = configRef(candidateDb());
    await assertFails(updateDoc(cfg, accept(CANDIDATE_UID, ADMIN2_UID))); // чужой previousOwnerUid
    await assertFails(updateDoc(cfg, configChange(CANDIDATE_UID, { ownerUid: CANDIDATE_UID, previousOwnerUid: OWNER_UID }))); // предложение не снято
    await assertFails(updateDoc(cfg, configChange(CANDIDATE_UID, { ownerUid: ADMIN2_UID, previousOwnerUid: OWNER_UID, pendingOwnerUid: null })));
    await assertFails(updateDoc(cfg, { ...accept(CANDIDATE_UID), updatedAt: T0 }));
    await assertFails(updateDoc(cfg, { ...accept(CANDIDATE_UID), updatedBy: OWNER_UID }));
  });

  test('без действующего предложения принять роль нельзя', async () => {
    await seedRoles();
    for (const [uid, db] of [[CANDIDATE_UID, candidateDb], [ADMIN2_UID, admin2Db]]) {
      await assertFails(updateDoc(configRef(db()), accept(uid)));
    }
  });

  test('отмена — только владельцем и только при действующем предложении', async () => {
    await seedRoles({ pending: CANDIDATE_UID });
    await assertFails(updateDoc(configRef(admin2Db()), clearOffer(ADMIN2_UID)));
    await assertSucceeds(updateDoc(configRef(ownerDb()), clearOffer(OWNER_UID)));
    assert.equal((await readRaw('adminConfig/primary')).pendingOwnerUid, null);
    await assertFails(updateDoc(configRef(ownerDb()), clearOffer(OWNER_UID))); // отменять нечего
  });

  test('отклонить может только тот, кому предложено', async () => {
    await seedRoles({ pending: CANDIDATE_UID });
    await assertFails(updateDoc(configRef(admin2Db()), clearOffer(ADMIN2_UID)));
    await assertSucceeds(updateDoc(configRef(candidateDb()), clearOffer(CANDIDATE_UID)));
    const cfg = await readRaw('adminConfig/primary');
    assert.equal(cfg.pendingOwnerUid, null);
    assert.equal(cfg.ownerUid, OWNER_UID);
  });

  test('гонка: после отмены или отклонения принять уже нельзя', async () => {
    await seedRoles({ pending: CANDIDATE_UID });
    await assertSucceeds(updateDoc(configRef(ownerDb()), clearOffer(OWNER_UID)));
    await assertFails(updateDoc(configRef(candidateDb()), accept(CANDIDATE_UID)));
    await assertSucceeds(updateDoc(configRef(ownerDb()), offer(CANDIDATE_UID)));
    await assertSucceeds(updateDoc(configRef(candidateDb()), clearOffer(CANDIDATE_UID)));
    await assertFails(updateDoc(configRef(candidateDb()), accept(CANDIDATE_UID)));
  });

  test('гонка: роль не переходит к тому, кто уже не администратор', async () => {
    // Предложение «зависло» (доступ отозвали одновременно с предложением или через Console)
    await seedRoles({ pending: CANDIDATE_UID });
    await env.withSecurityRulesDisabled((ctx) => deleteDoc(doc(ctx.firestore(), 'admins', CANDIDATE_UID)));
    await assertFails(updateDoc(configRef(candidateDb()), accept(CANDIDATE_UID)));
    await assertFails(updateDoc(configRef(candidateDb()), clearOffer(CANDIDATE_UID)));
    assert.equal((await readRaw('adminConfig/primary')).ownerUid, OWNER_UID);
    // Владелец снимает зависшее предложение
    await assertSucceeds(updateDoc(configRef(ownerDb()), clearOffer(OWNER_UID)));
  });

  test('гонка: после передачи прежний владелец не отменяет и не меняет предложение, повторно принять нельзя', async () => {
    await seedRoles({ pending: CANDIDATE_UID });
    await assertSucceeds(updateDoc(configRef(candidateDb()), accept(CANDIDATE_UID)));
    await assertFails(updateDoc(configRef(ownerDb()), clearOffer(OWNER_UID)));
    await assertFails(updateDoc(configRef(ownerDb()), offer(ADMIN2_UID)));
    await assertFails(updateDoc(configRef(ownerDb()), accept(OWNER_UID, CANDIDATE_UID)));
    await assertFails(updateDoc(configRef(candidateDb()), accept(CANDIDATE_UID)));
    // Новый владелец может вернуть роль обычным путём: предложение → принятие
    await assertSucceeds(updateDoc(configRef(candidateDb()), configChange(CANDIDATE_UID, { pendingOwnerUid: OWNER_UID })));
    await assertSucceeds(updateDoc(configRef(ownerDb()), accept(OWNER_UID, CANDIDATE_UID)));
  });
});

describe('adminConfig: создание и удаление; без adminConfig; старые документы', () => {
  test('adminConfig/primary не создаётся, не перезаписывается и не удаляется из браузера', async () => {
    await seedRoles({ config: null });
    const full = { ownerUid: ADMIN2_UID, pendingOwnerUid: null, previousOwnerUid: null, updatedAt: serverTimestamp(), updatedBy: ADMIN2_UID };
    for (const [uid, db] of [[ADMIN2_UID, admin2Db], [OWNER_UID, ownerDb], [ADMIN_UID, adminDb], [CUSTOMER_UID, customerDb]]) {
      await assertFails(setDoc(configRef(db()), { ...full, ownerUid: uid, updatedBy: uid }));
    }
    await assertFails(setDoc(doc(admin2Db(), 'adminConfig', 'other'), full));
    await seedRoles();
    await assertFails(setDoc(configRef(ownerDb()), { ownerUid: ADMIN2_UID, pendingOwnerUid: null, previousOwnerUid: OWNER_UID, updatedAt: serverTimestamp(), updatedBy: OWNER_UID }));
    await assertFails(deleteDoc(configRef(ownerDb())));
    await assertFails(deleteDoc(configRef(admin2Db())));
  });

  test('без adminConfig управлять ролями не может никто, админ-разделы работают', async () => {
    await seedRoles({ config: null });
    for (const db of [ownerDb, admin2Db, adminDb]) {
      await assertSucceeds(canUseAdminSections(db()));
      await assertFails(getDocs(collection(db(), 'admins')));
      await assertFails(setDoc(adminRef(db(), NEWBIE_UID), grant('x')));
      await assertFails(deleteDoc(adminRef(db(), CANDIDATE_UID)));
      await assertFails(getDoc(configRef(db())));
    }
    // Свой документ читается — проверка «я администратор?» работает
    await assertSucceeds(getDoc(adminRef(ownerDb(), OWNER_UID)));
  });

  test('старые документы admins работают, а поле role не даёт прав владельца', async () => {
    await seedRoles();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'admins', 'legacy-owner-uid'), { role: 'owner' });
      await setDoc(doc(ctx.firestore(), 'admins', 'legacy-named-uid'), { email: 'a@example.com', name: 'Админ', createdAt: T0 });
    });
    const legacyOwner = () => env.authenticatedContext('legacy-owner-uid').firestore();
    const legacyNamed = () => env.authenticatedContext('legacy-named-uid').firestore();
    for (const db of [legacyOwner, legacyNamed, adminDb]) {
      await assertSucceeds(canUseAdminSections(db()));
      await assertSucceeds(getDocs(query(collection(db(), 'reviews'), where('status', '==', 'pending'))));
      await assertFails(getDocs(collection(db(), 'admins')));
      await assertFails(setDoc(adminRef(db(), NEWBIE_UID), grant('legacy-owner-uid')));
      await assertFails(updateDoc(configRef(db()), configChange('legacy-owner-uid', { pendingOwnerUid: CANDIDATE_UID })));
    }
  });

  test('владелец из adminConfig без документа admins/{uid} (ошибка в Console) не управляет администраторами', async () => {
    await seedRoles();
    await env.withSecurityRulesDisabled((ctx) => deleteDoc(doc(ctx.firestore(), 'admins', OWNER_UID)));
    await assertFails(getDocs(collection(ownerDb(), 'admins')));
    await assertFails(getDoc(adminRef(ownerDb(), ADMIN2_UID)));
    await assertFails(setDoc(adminRef(ownerDb(), NEWBIE_UID), grant(OWNER_UID)));
    await assertFails(deleteDoc(adminRef(ownerDb(), ADMIN2_UID)));
    await assertFails(getDoc(configRef(ownerDb())));
    await assertFails(updateDoc(configRef(ownerDb()), offer(ADMIN2_UID)));
    await assertFails(canUseAdminSections(ownerDb()));
  });

  test('роль владельца нельзя предложить документу admins с ID неверного формата (созданному в Console)', async () => {
    await seedRoles();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'admins', 'legacy.admin'), { role: 'admin' });
      await setDoc(doc(ctx.firestore(), 'users', 'legacy.admin'), { name: 'Старый', email: 'l@example.com', createdAt: T0 });
    });
    await assertFails(updateDoc(configRef(ownerDb()), offer('legacy.admin')));
    assert.equal((await readRaw('adminConfig/primary')).pendingOwnerUid, null);
  });

  test('регрессия: владелец и обычный администратор — те же права в заказах, товарах, отзывах и профилях', async () => {
    await seedRoles();
    for (const db of [ownerDb, admin2Db]) {
      await assertSucceeds(getDocs(collectionGroup(db(), 'orders')));
      await assertSucceeds(updateDoc(doc(db(), 'users', CUSTOMER_UID, 'orders', 'order1'), { status: 'confirmed', statusUpdatedAt: serverTimestamp() }));
      await assertSucceeds(getDoc(doc(db(), 'users', CUSTOMER_UID)));
      await assertFails(updateDoc(doc(db(), 'users', CUSTOMER_UID), { name: 'Взлом' }));
      await assertSucceeds(getDocs(collection(db(), 'products')));
      await assertSucceeds(updateDoc(doc(db(), 'reviews', 'pending1'), moderation('approved')));
      await assertFails(deleteDoc(doc(db(), 'reviews', 'approved1')));
    }
  });
});

// ==================== A3.1: пакетные записи и дополнительные проверки ====================

describe('A3.1: пакетные записи (writeBatch) и дополнительные проверки ролей', () => {
  test('пакет «предложить роль + отозвать доступ кандидата» отклоняется целиком, в любом порядке', async () => {
    await seedRoles();
    for (const order of ['offer-first', 'delete-first']) {
      const db = ownerDb();
      const batch = writeBatch(db);
      if (order === 'offer-first') {
        batch.update(configRef(db), offer(ADMIN2_UID));
        batch.delete(adminRef(db, ADMIN2_UID));
      } else {
        batch.delete(adminRef(db, ADMIN2_UID));
        batch.update(configRef(db), offer(ADMIN2_UID));
      }
      await assertFails(batch.commit());
    }
    // Ничего не записано: предложения нет, администратор на месте и работает
    assert.equal((await readRaw('adminConfig/primary')).pendingOwnerUid, null);
    assert.ok(await readRaw(`admins/${ADMIN2_UID}`));
    await assertSucceeds(canUseAdminSections(admin2Db()));
    // По отдельности те же операции разрешены (обычный порядок работы)
    await assertSucceeds(deleteDoc(adminRef(ownerDb(), ADMIN2_UID)));
    await assertSucceeds(updateDoc(configRef(ownerDb()), offer(CANDIDATE_UID)));
  });

  test('пакет «отменить предложение + отозвать доступ кандидата» тоже отклоняется: сначала отмена, потом отзыв', async () => {
    await seedRoles({ pending: CANDIDATE_UID });
    const db = ownerDb();
    const batch = writeBatch(db);
    batch.update(configRef(db), clearOffer(OWNER_UID));
    batch.delete(adminRef(db, CANDIDATE_UID));
    await assertFails(batch.commit());
    assert.equal((await readRaw('adminConfig/primary')).pendingOwnerUid, CANDIDATE_UID);
    assert.ok(await readRaw(`admins/${CANDIDATE_UID}`));
  });

  test('пакет «назначить администратора + предложить ему роль» проходит: он администратор после пакета, принимает сам', async () => {
    await seedRoles();
    const db = ownerDb();
    const batch = writeBatch(db);
    batch.set(adminRef(db, NEWBIE_UID), grant(OWNER_UID));
    batch.update(configRef(db), offer(NEWBIE_UID));
    await assertSucceeds(batch.commit());
    const cfg = await readRaw('adminConfig/primary');
    assert.equal(cfg.pendingOwnerUid, NEWBIE_UID);
    assert.equal(cfg.ownerUid, OWNER_UID, 'роль ещё не передана');
    await assertSucceeds(updateDoc(configRef(newbieDb()), accept(NEWBIE_UID)));
  });

  test('прежний владелец после передачи не назначает администраторов и не читает чужие документы admins', async () => {
    await seedRoles({ pending: CANDIDATE_UID });
    await assertSucceeds(updateDoc(configRef(candidateDb()), accept(CANDIDATE_UID)));
    await assertFails(setDoc(adminRef(ownerDb(), NEWBIE_UID), grant(OWNER_UID)));
    await assertFails(getDoc(adminRef(ownerDb(), ADMIN2_UID)));
    await assertFails(getDoc(adminRef(ownerDb(), CANDIDATE_UID)));
    // Свой документ он по-прежнему читает — он обычный администратор
    await assertSucceeds(getDoc(adminRef(ownerDb(), OWNER_UID)));
    assert.equal(await readRaw(`admins/${NEWBIE_UID}`), null);
  });

  test('покупатель и гость не удаляют adminConfig/primary', async () => {
    await seedRoles({ pending: CANDIDATE_UID });
    for (const db of [customerDb, newbieDb, guestDb]) await assertFails(deleteDoc(configRef(db())));
    assert.ok(await readRaw('adminConfig/primary'));
  });

  test('отмена предложения: updatedAt и updatedBy подделать нельзя', async () => {
    await seedRoles({ pending: CANDIDATE_UID });
    const cfg = configRef(ownerDb());
    await assertFails(updateDoc(cfg, { pendingOwnerUid: null, updatedAt: T0, updatedBy: OWNER_UID }));
    await assertFails(updateDoc(cfg, { pendingOwnerUid: null, updatedAt: serverTimestamp(), updatedBy: CANDIDATE_UID }));
    await assertFails(updateDoc(cfg, { pendingOwnerUid: null, updatedAt: serverTimestamp() })); // updatedBy остался «console»
    await assertFails(updateDoc(cfg, { pendingOwnerUid: null, updatedBy: OWNER_UID })); // updatedAt остался старым
    assert.equal((await readRaw('adminConfig/primary')).pendingOwnerUid, CANDIDATE_UID);
  });

  test('отклонение предложения: updatedAt и updatedBy подделать нельзя', async () => {
    await seedRoles({ pending: CANDIDATE_UID });
    const cfg = configRef(candidateDb());
    await assertFails(updateDoc(cfg, { pendingOwnerUid: null, updatedAt: T0, updatedBy: CANDIDATE_UID }));
    await assertFails(updateDoc(cfg, { pendingOwnerUid: null, updatedAt: serverTimestamp(), updatedBy: OWNER_UID }));
    await assertFails(updateDoc(cfg, { pendingOwnerUid: null, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(cfg, { pendingOwnerUid: null, updatedBy: CANDIDATE_UID }));
    assert.equal((await readRaw('adminConfig/primary')).pendingOwnerUid, CANDIDATE_UID);
  });
});
