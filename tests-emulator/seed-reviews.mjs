// Тестовые данные для ручной проверки модерации отзывов (этап E6) и ролей администраторов (этап A3) —
// ТОЛЬКО в эмуляторах Firebase.
//
// Запуск: `npm run emulators:dev` (в отдельном окне), затем `npm run seed:emulator`.
// `node tests-emulator/seed-reviews.mjs --check` — только проверки безопасности, без записи.
//
// До любой записи скрипт проверяет: проект — demo-aroma-donna (тот же, что в src/services/firebase.js),
// адреса — только 127.0.0.1, переменные *_EMULATOR_HOST не указывают в другое место,
// а по адресам отвечают именно эмуляторы Auth и Firestore. Не прошла хоть одна проверка — выход без записи.
// Новых пакетов не нужно: только REST-адреса эмуляторов. Ключей и секретов из .env скрипт не читает.
//
// Скрипт ОЧИЩАЕТ эмулятор (все документы и пользователи проекта demo-aroma-donna) и создаёт данные заново.

import { EMULATOR_HOSTS, EMULATOR_PROJECT_ID } from '../src/services/firebase.js';

const CHECK_ONLY = process.argv.includes('--check');
const PROJECT = EMULATOR_PROJECT_ID;
const AUTH = new URL(EMULATOR_HOSTS.auth);
const FS = `http://${EMULATOR_HOSTS.firestore.host}:${EMULATOR_HOSTS.firestore.port}`;
const DOCS = `${FS}/v1/projects/${PROJECT}/databases/(default)/documents`;
// В эмуляторе Firestore «Bearer owner» — служебный доступ в обход правил (как Firebase Console в рабочей базе)
const OWNER = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };

// Роли: ADMIN — главный администратор (adminConfig/primary.ownerUid), MANAGER — обычный администратор,
// CANDIDATE — администратор, которому предложена роль владельца, CUSTOMER — покупатель без прав
export const ADMIN = { email: 'admin@test.local', password: 'admin-test-123', name: 'Админ (тест)' };
export const MANAGER = { email: 'manager@test.local', password: 'manager-test-123', name: 'Менеджер (тест)' };
export const CANDIDATE = { email: 'candidate@test.local', password: 'candidate-test-123', name: 'Кандидат (тест)' };
export const CUSTOMER = { email: 'user@test.local', password: 'user-test-123', name: 'Покупатель (тест)' };

function fail(message) {
  console.error(`✖ ${message}\nНичего не записано.`);
  process.exit(1);
}

// ---------- Проверки безопасности (до любой записи) ----------

async function checkSafety() {
  const checks = [];
  const ok = (name, pass, detail = '') => {
    checks.push({ name, pass, detail });
    console.log(`${pass ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`);
  };

  ok('ID проекта начинается с demo-', /^demo-[a-z0-9-]+$/.test(PROJECT), PROJECT);
  ok('ID проекта совпадает с src/services/firebase.js', PROJECT === 'demo-aroma-donna');
  ok('Auth Emulator — 127.0.0.1:9099', AUTH.protocol === 'http:' && AUTH.hostname === '127.0.0.1' && AUTH.port === '9099');
  ok('Firestore Emulator — 127.0.0.1:8080', FS === 'http://127.0.0.1:8080');

  // Переменные окружения не должны направлять в другое место
  const envAuth = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const envFs = process.env.FIRESTORE_EMULATOR_HOST;
  ok('FIREBASE_AUTH_EMULATOR_HOST не задан или 127.0.0.1:9099', !envAuth || envAuth === '127.0.0.1:9099', envAuth || 'не задан');
  ok('FIRESTORE_EMULATOR_HOST не задан или 127.0.0.1:8080', !envFs || envFs === '127.0.0.1:8080', envFs || 'не задан');
  ok('GCLOUD_PROJECT не задан или demo-', !process.env.GCLOUD_PROJECT || process.env.GCLOUD_PROJECT.startsWith('demo-'));

  // По адресам отвечают именно эмуляторы (рабочий Firebase так не отвечает)
  let authInfo = null;
  try {
    authInfo = await (await fetch(`${AUTH.origin}/`, { signal: AbortSignal.timeout(3000) })).json();
  } catch {
    /* не отвечает */
  }
  ok('Auth Emulator отвечает', Boolean(authInfo?.authEmulator?.ready), authInfo ? 'authEmulator.ready' : 'нет ответа');

  let fsText = null;
  try {
    fsText = (await (await fetch(`${FS}/`, { signal: AbortSignal.timeout(3000) })).text()).trim();
  } catch {
    /* не отвечает */
  }
  ok('Firestore Emulator отвечает', fsText === 'Ok', fsText === null ? 'нет ответа' : `«${fsText.slice(0, 20)}»`);

  if (checks.some((c) => !c.pass)) fail('Проверки безопасности не пройдены.');
  console.log('Все проверки безопасности пройдены.\n');
}

// ---------- REST эмуляторов ----------

async function request(method, url, body, headers = OWNER) {
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url.replace(FS, '').replace(AUTH.origin, '')} → ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}

/** Значение JS → поле Firestore REST */
function toValue(v) {
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === 'string') return { stringValue: v };
  if (Number.isInteger(v)) return { integerValue: String(v) };
  if (typeof v === 'number') return { doubleValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (v === null) return { nullValue: null };
  throw new Error(`неподдерживаемое значение ${v}`);
}
const toFields = (data) => Object.fromEntries(Object.entries(data).map(([k, v]) => [k, toValue(v)]));

const setDoc = (path, data) => request('PATCH', `${DOCS}/${path}`, { fields: toFields(data) });

async function createUser({ email, password }) {
  const res = await request(
    'POST',
    `${AUTH.origin}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`,
    { email, password, returnSecureToken: true },
    { 'Content-Type': 'application/json' },
  );
  return res.localId;
}

// ---------- Данные ----------

const at = (iso) => new Date(iso);
const LONG_TEXT = [
  'Заказывала Rose Poudrée впервые и очень довольна. Аромат раскрывается постепенно: сначала свежая роза',
  'с лёгкой кислинкой, через полчаса появляется пудровая ирисовая нота, а к вечеру остаётся тёплый мускус.',
  '',
  'Стойкость — около восьми часов на коже и больше суток на шарфе. Шлейф умеренный, в офисе никому не мешает.',
  'Флакон тяжёлый, крышка плотная, распылитель даёт мелкое облако. Доставили на следующий день, упаковка целая.',
  '',
  'Из минусов: в жару аромат становится слаще, чем хотелось бы. Но в целом это мой новый любимый аромат на осень,',
  'обязательно возьму ещё объём побольше.',
].join('\n');

const REVIEWS = {
  'seed-pending-long': { name: 'Айгерим', rating: 5, text: LONG_TEXT, lang: 'ru', status: 'pending', createdAt: at('2026-11-03T09:15:00Z') },
  'seed-pending-html': {
    name: 'Тест <b>HTML</b>',
    rating: 3,
    text: "<img src=x onerror=alert('xss')> Проверка: разметка должна показываться обычным текстом.",
    lang: 'en',
    status: 'pending',
    createdAt: at('2026-11-02T18:40:00Z'),
  },
  'seed-pending-low': { name: 'Bakyt', rating: 2, text: 'Слишком сладкий для меня, на коже держится всего пару часов.', lang: 'ky', status: 'pending', createdAt: at('2026-11-01T12:00:00Z') },
  'seed-pending-nolang': { name: 'Гость', rating: 4, text: 'Красивый флакон и приятный шлейф, но хотелось бы пробник.', status: 'pending', createdAt: at('2026-10-31T08:30:00Z') },
  'seed-approved-1': {
    name: 'Нурлан',
    rating: 5,
    text: 'Отличный подарок жене, ей очень понравилось. Спасибо за быструю доставку!',
    lang: 'ru',
    status: 'approved',
    createdAt: at('2026-10-28T10:00:00Z'),
    moderatedAt: at('2026-10-29T09:00:00Z'),
  },
  'seed-approved-2': {
    name: 'Elena',
    rating: 4,
    text: 'Lovely powdery rose, lasts the whole day.',
    lang: 'en',
    status: 'approved',
    createdAt: at('2026-10-25T15:20:00Z'),
    moderatedAt: at('2026-10-26T08:00:00Z'),
  },
  'seed-approved-3': {
    name: 'Айжан',
    rating: 3,
    text: 'Нормальный аромат, но ожидала большего от верхних нот.',
    lang: 'ky',
    status: 'approved',
    createdAt: at('2026-10-22T11:45:00Z'),
    moderatedAt: at('2026-10-23T10:00:00Z'),
  },
  'seed-rejected-spam': {
    name: 'Спам',
    rating: 1,
    text: 'Купите дешёвые часы по ссылке!!! Скидки только сегодня.',
    lang: 'ru',
    status: 'rejected',
    createdAt: at('2026-10-30T22:10:00Z'),
    moderatedAt: at('2026-10-30T23:00:00Z'),
  },
  'seed-rejected-test': {
    name: 'Test',
    rating: 1,
    text: 'тест тест тест тест',
    lang: 'en',
    status: 'rejected',
    createdAt: at('2026-10-20T07:00:00Z'),
    moderatedAt: at('2026-10-21T07:30:00Z'),
  },
  'seed-rejected-rude': {
    name: 'Аноним',
    rating: 2,
    text: 'Не понравилось, но без подробностей и с грубыми словами.',
    lang: 'ru',
    status: 'rejected',
    createdAt: at('2026-10-24T19:00:00Z'),
    moderatedAt: at('2026-10-24T20:00:00Z'),
  },
  // Повреждённый документ: оценка строкой (так бывает при ручной правке в Console) — запись в обход правил
  'seed-damaged-rating': { name: 'Повреждённый', rating: 'пять', text: 'Документ с оценкой строкой.', lang: 'ru', status: 'pending', createdAt: at('2026-10-29T13:00:00Z') },
};

// ---------- Запуск ----------

await checkSafety();
if (CHECK_ONLY) {
  console.log('Режим --check: данные не записывались.');
  process.exit(0);
}

console.log(`Очистка эмуляторов проекта ${PROJECT}…`);
await request('DELETE', `${FS}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`);
await request('DELETE', `${AUTH.origin}/emulator/v1/projects/${PROJECT}/accounts`);

const adminUid = await createUser(ADMIN);
const managerUid = await createUser(MANAGER);
const candidateUid = await createUser(CANDIDATE);
const customerUid = await createUser(CUSTOMER);
const now = new Date();
for (const [uid, person] of [[adminUid, ADMIN], [managerUid, MANAGER], [candidateUid, CANDIDATE], [customerUid, CUSTOMER]]) {
  await setDoc(`users/${uid}`, { name: person.name, email: person.email, createdAt: now });
}
// Документы администраторов — формат этапа A3 (grantedAt, grantedBy, label); первого создаёт «Console»
await setDoc(`admins/${adminUid}`, { grantedAt: now, grantedBy: 'console', label: 'Владелец (тест)' });
await setDoc(`admins/${managerUid}`, { grantedAt: now, grantedBy: adminUid, label: 'Менеджер (тест)' });
await setDoc(`admins/${candidateUid}`, { grantedAt: now, grantedBy: adminUid, label: 'Кандидат (тест)' });
// Главный администратор и действующее предложение роли кандидату
await setDoc('adminConfig/primary', {
  ownerUid: adminUid,
  pendingOwnerUid: candidateUid,
  previousOwnerUid: null,
  updatedAt: now,
  updatedBy: 'console',
});

for (const [id, data] of Object.entries(REVIEWS)) await setDoc(`reviews/${id}`, data);

// Проверка: что реально лежит в эмуляторе
const list = await request('GET', `${DOCS}/reviews?pageSize=100`);
const stored = (list.documents || []).map((d) => ({
  id: d.name.split('/').pop(),
  status: d.fields.status?.stringValue,
  rating: d.fields.rating?.integerValue ?? d.fields.rating?.stringValue,
}));
const admins = await request('GET', `${DOCS}/admins`);

console.log(`\nСоздано в эмуляторе (${PROJECT}):`);
console.log(`  владелец:      ${ADMIN.email} / ${ADMIN.password} (uid ${adminUid}, adminConfig/primary.ownerUid)`);
console.log(`  администратор: ${MANAGER.email} / ${MANAGER.password} (uid ${managerUid})`);
console.log(`  кандидат:      ${CANDIDATE.email} / ${CANDIDATE.password} (uid ${candidateUid}, ему предложена роль владельца)`);
console.log(`  покупатель:    ${CUSTOMER.email} / ${CUSTOMER.password} (uid ${customerUid}, без admins)`);
console.log(`  документов admins: ${(admins.documents || []).length}`);
console.log(`  отзывов: ${stored.length}`);
console.table(stored);
