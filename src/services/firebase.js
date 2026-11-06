/**
 * Подключение Firebase.
 *
 * Ключи берутся из переменных окружения (файл .env, см. .env.example).
 * Если ключей нет — Firebase не загружается, и приложение работает в ДЕМО-РЕЖИМЕ.
 *
 * Примечание: apiKey веб-приложения Firebase не является секретом — он идентифицирует
 * проект. Защита данных обеспечивается правилами Firestore (файл firestore.rules)
 * и Firebase Authentication, а не скрытием ключа.
 *
 * ТЕСТОВЫЙ РЕЖИМ С ЭМУЛЯТОРАМИ (только для ручной проверки на своём компьютере):
 * `npm run emulators:dev` и `npm run dev:emulator` (файл .env.emulator, VITE_USE_EMULATORS=true).
 * - Ключи рабочего проекта из .env не используются вообще: только фиктивный проект demo-aroma-donna
 *   (проектов с префиксом demo- в рабочем Firebase не существует).
 * - Auth Emulator и Firestore Emulator подключаются сразу после инициализации, до любого запроса.
 * - Режим работает только на localhost или 127.0.0.1; эмуляторы не отвечают — приложение
 *   останавливается с понятной ошибкой. Перехода на рабочий Firebase нет ни в каком случае.
 */

// import.meta.env подставляет Vite; в тестах node его нет
const env = import.meta.env ?? {};

export const EMULATOR_PROJECT_ID = 'demo-aroma-donna';
export const EMULATOR_HOSTS = {
  auth: 'http://127.0.0.1:9099',
  firestore: { host: '127.0.0.1', port: 8080 },
};
const EMULATOR_CONFIG = {
  apiKey: 'demo-key',
  authDomain: `${EMULATOR_PROJECT_ID}.firebaseapp.com`,
  projectId: EMULATOR_PROJECT_ID,
  appId: 'demo-app',
};
const LOCAL_HOSTNAMES = ['localhost', '127.0.0.1'];

/**
 * Какой Firebase использовать: { mode: 'production' | 'emulator', config, error }.
 * error — тестовый режим запрошен, но запускать его небезопасно:
 * emulator-flag-invalid — VITE_USE_EMULATORS не 'true' и не 'false' (опечатка не должна вести в рабочую базу);
 * emulator-not-local — страница открыта не с localhost или 127.0.0.1.
 */
export function resolveFirebaseSettings(vars, hostname) {
  const flag = vars.VITE_USE_EMULATORS;
  if (flag !== undefined && flag !== '' && flag !== 'true' && flag !== 'false') {
    return { mode: 'emulator', config: { ...EMULATOR_CONFIG }, error: 'emulator-flag-invalid' };
  }
  if (flag === 'true') {
    return {
      mode: 'emulator',
      config: { ...EMULATOR_CONFIG },
      error: LOCAL_HOSTNAMES.includes(hostname) ? null : 'emulator-not-local',
    };
  }
  return {
    mode: 'production',
    config: {
      apiKey: vars.VITE_FIREBASE_API_KEY,
      authDomain: vars.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: vars.VITE_FIREBASE_PROJECT_ID,
      storageBucket: vars.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: vars.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: vars.VITE_FIREBASE_APP_ID,
    },
    error: null,
  };
}

const settings = resolveFirebaseSettings(env, typeof window !== 'undefined' ? window.location.hostname : '');
const { config } = settings;

export const isEmulatorMode = settings.mode === 'emulator';

export const isFirebaseConfigured = Boolean(config.apiKey && config.authDomain && config.projectId && config.appId);

const EMULATOR_ERRORS = {
  'emulator-flag-invalid': 'VITE_USE_EMULATORS должен быть "true" или "false".',
  'emulator-not-local': 'Тестовый режим с эмуляторами работает только на http://localhost или http://127.0.0.1.',
  'emulator-unavailable':
    'Эмуляторы Firebase не отвечают (Auth 127.0.0.1:9099, Firestore 127.0.0.1:8080). Запустите `npm run emulators:dev` и обновите страницу.',
  'emulator-project': 'В тестовом режиме разрешён только проект demo-aroma-donna.',
};

/**
 * Остановить приложение в тестовом режиме: сообщение на экране (обычным текстом) и ошибка в консоли.
 * Рабочий Firebase при этом не подключается.
 */
function stopEmulatorMode(code) {
  const message = `[AROMA DONNA, тестовый режим] ${EMULATOR_ERRORS[code]} Рабочий Firebase не подключается.`;
  if (typeof document !== 'undefined' && document.body) {
    const box = document.createElement('pre');
    box.setAttribute('role', 'alert');
    box.style.cssText = 'margin:24px;padding:16px;white-space:pre-wrap;font:16px/1.5 system-ui,sans-serif;color:#b3363f;background:#fbe9ea;border-radius:12px';
    box.textContent = message;
    document.body.replaceChildren(box);
  }
  const err = new Error(message);
  err.code = code;
  return err;
}

if (settings.error) throw stopEmulatorMode(settings.error);

/** Эмуляторы запущены? Любой ответ (даже без CORS) — да; отказ соединения — нет */
async function emulatorsReachable() {
  const ping = (url) => fetch(url, { mode: 'no-cors', cache: 'no-store' });
  const { host, port } = EMULATOR_HOSTS.firestore;
  try {
    await Promise.all([ping(`${EMULATOR_HOSTS.auth}/`), ping(`http://${host}:${port}/`)]);
    return true;
  } catch {
    return false;
  }
}

let servicesPromise = null;

/**
 * Ленивая загрузка Firebase: библиотека скачивается браузером только если она нужна.
 * Возвращает { app, auth, db, authApi, dbApi } (app нужен App Check — src/services/appCheck.js).
 * В тестовом режиме: сначала проверка, что эмуляторы отвечают; затем подключение к ним
 * до возврата auth и db — ни один запрос не уходит раньше. Ошибка не повторяется и не ведёт в рабочий Firebase.
 */
export function getFirebase() {
  if (!isFirebaseConfigured) {
    return Promise.reject(new Error('firebase-not-configured'));
  }
  if (!servicesPromise) {
    servicesPromise = Promise.all([
      import('firebase/app'),
      import('firebase/auth'),
      import('firebase/firestore'),
      isEmulatorMode ? emulatorsReachable() : true,
    ]).then(([appApi, authApi, dbApi, reachable]) => {
      if (isEmulatorMode && config.projectId !== EMULATOR_PROJECT_ID) throw stopEmulatorMode('emulator-project');
      if (!reachable) throw stopEmulatorMode('emulator-unavailable');
      const app = appApi.initializeApp(config);
      const auth = authApi.getAuth(app);
      const db = dbApi.getFirestore(app);
      if (isEmulatorMode) {
        authApi.connectAuthEmulator(auth, EMULATOR_HOSTS.auth);
        dbApi.connectFirestoreEmulator(db, EMULATOR_HOSTS.firestore.host, EMULATOR_HOSTS.firestore.port);
        console.warn(`[firebase] Тестовый режим: эмуляторы Auth и Firestore, проект ${EMULATOR_PROJECT_ID}`);
      }
      return { app, auth, db, authApi, dbApi };
    });
  }
  return servicesPromise;
}
