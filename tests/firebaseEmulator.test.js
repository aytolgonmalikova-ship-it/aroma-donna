// Тесты изоляции тестового режима с эмуляторами Firebase (этап E6): выбор настроек в firebase.js,
// порядок подключения, запрет перехода на рабочий проект, команды package.json, firebase.json и
// скрипт тестовых данных. Запуск: npm test (эмуляторы для этих тестов не нужны).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  EMULATOR_HOSTS,
  EMULATOR_PROJECT_ID,
  isEmulatorMode,
  isFirebaseConfigured,
  resolveFirebaseSettings,
} from '../src/services/firebase.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// Похоже на рабочие ключи (значения выдуманы) — в тестовом режиме ни одно не должно использоваться
const PROD_LIKE = {
  VITE_FIREBASE_API_KEY: 'AIzaProdLikeKey',
  VITE_FIREBASE_AUTH_DOMAIN: 'prod-like.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'prod-like',
  VITE_FIREBASE_STORAGE_BUCKET: 'prod-like.appspot.com',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '123',
  VITE_FIREBASE_APP_ID: '1:123:web:abc',
};

test('без VITE_USE_EMULATORS (и при "false") — прежнее поведение: ключи из .env', () => {
  for (const flag of [undefined, '', 'false']) {
    const s = resolveFirebaseSettings({ ...PROD_LIKE, VITE_USE_EMULATORS: flag }, 'aroma-donna.vercel.app');
    assert.equal(s.mode, 'production', String(flag));
    assert.equal(s.error, null);
    assert.equal(s.config.projectId, 'prod-like');
    assert.equal(s.config.apiKey, 'AIzaProdLikeKey');
  }
  // В тестах node import.meta.env нет — Firebase не настроен, тестовый режим выключен
  assert.equal(isFirebaseConfigured, false);
  assert.equal(isEmulatorMode, false);
});

test('VITE_USE_EMULATORS=true на localhost и 127.0.0.1 — только demo-aroma-donna и фиктивные настройки', () => {
  for (const host of ['localhost', '127.0.0.1']) {
    const s = resolveFirebaseSettings({ ...PROD_LIKE, VITE_USE_EMULATORS: 'true' }, host);
    assert.equal(s.mode, 'emulator');
    assert.equal(s.error, null);
    assert.deepEqual(s.config, {
      apiKey: 'demo-key',
      authDomain: 'demo-aroma-donna.firebaseapp.com',
      projectId: 'demo-aroma-donna',
      appId: 'demo-app',
    });
    // Ни одно значение из .env не попало в настройки
    const values = Object.values(s.config).join(' ');
    for (const v of Object.values(PROD_LIKE)) assert.ok(!values.includes(v), v);
  }
  assert.equal(EMULATOR_PROJECT_ID, 'demo-aroma-donna');
  assert.deepEqual(EMULATOR_HOSTS, { auth: 'http://127.0.0.1:9099', firestore: { host: '127.0.0.1', port: 8080 } });
});

test('тестовый режим не с localhost или 127.0.0.1 — ошибка emulator-not-local', () => {
  for (const host of ['aroma-donna.vercel.app', '192.168.1.3', '0.0.0.0', 'localhost.evil.com', '', undefined]) {
    const s = resolveFirebaseSettings({ VITE_USE_EMULATORS: 'true' }, host);
    assert.equal(s.error, 'emulator-not-local', String(host));
    assert.equal(s.config.projectId, 'demo-aroma-donna', 'даже с ошибкой — не рабочий проект');
  }
});

test('опечатка во флаге не ведёт в рабочую базу — ошибка emulator-flag-invalid', () => {
  for (const flag of ['1', 'TRUE', 'True', 'yes', 'on', ' true']) {
    const s = resolveFirebaseSettings({ ...PROD_LIKE, VITE_USE_EMULATORS: flag }, 'localhost');
    assert.equal(s.error, 'emulator-flag-invalid', flag);
    assert.equal(s.config.projectId, 'demo-aroma-donna', flag);
  }
});

test('firebase.js: эмуляторы проверяются и подключаются до возврата auth и db; перехода на рабочий проект нет', () => {
  const src = read('src/services/firebase.js');
  const init = src.indexOf('appApi.initializeApp(config)');
  const reach = src.indexOf("if (!reachable) throw stopEmulatorMode('emulator-unavailable')");
  const project = src.indexOf("if (isEmulatorMode && config.projectId !== EMULATOR_PROJECT_ID) throw stopEmulatorMode('emulator-project')");
  const connectAuth = src.indexOf('authApi.connectAuthEmulator(auth, EMULATOR_HOSTS.auth)');
  const connectDb = src.indexOf('dbApi.connectFirestoreEmulator(db, EMULATOR_HOSTS.firestore.host, EMULATOR_HOSTS.firestore.port)');
  const ret = src.indexOf('return { app, auth, db, authApi, dbApi };');
  for (const [name, i] of Object.entries({ init, reach, project, connectAuth, connectDb, ret })) assert.ok(i > 0, name);
  assert.ok(project < init && reach < init, 'проверки — до initializeApp');
  assert.ok(init < connectAuth && connectAuth < ret && connectDb < ret, 'подключение — до возврата сервисов');
  // Небезопасные настройки — остановка при загрузке модуля, до любого запроса
  assert.match(src, /if \(settings\.error\) throw stopEmulatorMode\(settings\.error\);/);
  // Сообщение — обычным текстом, без HTML
  assert.match(src, /box\.textContent = message;/);
  assert.doesNotMatch(src, /innerHTML/);
  // Только одна инициализация и нет второй (резервной) конфигурации
  assert.equal(src.match(/initializeApp\(/g).length, 1);
  assert.equal(src.match(/resolveFirebaseSettings\(env/g).length, 1);
});

test('package.json и firebase.json: эмуляторы только на 127.0.0.1 и только с demo-aroma-donna', () => {
  const { scripts } = JSON.parse(read('package.json'));
  assert.equal(scripts['emulators:dev'], 'npx firebase-tools emulators:start --only auth,firestore --project demo-aroma-donna');
  assert.equal(scripts['dev:emulator'], 'vite --mode emulator --host 127.0.0.1 --port 5174 --strictPort');
  assert.equal(scripts['seed:emulator'], 'node tests-emulator/seed-reviews.mjs');
  // Ни одна команда не публикует правила и индексы
  assert.doesNotMatch(Object.values(scripts).join('\n'), /deploy/);
  const fb = JSON.parse(read('firebase.json'));
  assert.deepEqual(fb.emulators, {
    auth: { host: '127.0.0.1', port: 9099 },
    firestore: { host: '127.0.0.1', port: 8080 },
    ui: { enabled: false },
    singleProjectMode: true,
  });
  // Пути к правилам и индексам не изменились
  assert.deepEqual(fb.firestore, { rules: 'firestore.rules', indexes: 'firestore.indexes.json' });
});

test('скрипт тестовых данных: проверки безопасности до любой записи, проект и адреса — из firebase.js', () => {
  const seed = read('tests-emulator/seed-reviews.mjs');
  assert.match(seed, /import \{ EMULATOR_HOSTS, EMULATOR_PROJECT_ID \} from '\.\.\/src\/services\/firebase\.js';/);
  const check = seed.indexOf('await checkSafety();');
  const firstWrite = seed.search(/await request\('(DELETE|POST|PATCH)'|await setDoc\(|await createUser\(/);
  assert.ok(check > 0 && firstWrite > check, 'checkSafety — до первой записи');
  assert.match(seed, /if \(CHECK_ONLY\) \{/);
  assert.match(seed, /if \(checks\.some\(\(c\) => !c\.pass\)\) fail\(/);
  assert.match(seed, /\/\^demo-\[a-z0-9-\]\+\$\/\.test\(PROJECT\)/);
  assert.match(seed, /AUTH\.hostname === '127\.0\.0\.1'/);
  assert.match(seed, /FS === 'http:\/\/127\.0\.0\.1:8080'/);
  // Секреты и рабочие ключи не читаются (process.env — только для проверки *_EMULATOR_HOST и GCLOUD_PROJECT)
  assert.doesNotMatch(seed, /VITE_|TELEGRAM|EMAILJS|readFileSync|dotenv|loadEnv/);
  assert.deepEqual([...new Set(seed.match(/process\.env\.\w+/g))].sort(), [
    'process.env.FIREBASE_AUTH_EMULATOR_HOST',
    'process.env.FIRESTORE_EMULATOR_HOST',
    'process.env.GCLOUD_PROJECT',
  ]);
});

test('.env.emulator (если есть): флаг, пустые ключи Firebase, EmailJS и Telegram', (t) => {
  let text;
  try {
    text = read('.env.emulator');
  } catch {
    t.skip('файла .env.emulator нет (он не хранится в Git)');
    return;
  }
  const vars = Object.fromEntries(
    text
      .split('\n')
      .filter((l) => /^[A-Z_]+=/.test(l))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  );
  assert.equal(vars.VITE_USE_EMULATORS, 'true');
  for (const key of [
    'VITE_FIREBASE_API_KEY',
    'VITE_FIREBASE_AUTH_DOMAIN',
    'VITE_FIREBASE_PROJECT_ID',
    'VITE_FIREBASE_APP_ID',
    'VITE_EMAILJS_SERVICE_ID',
    'VITE_EMAILJS_TEMPLATE_ID',
    'VITE_EMAILJS_PUBLIC_KEY',
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_CHAT_ID',
  ]) {
    assert.equal(vars[key], '', key);
  }
});
