// Firebase Admin SDK для серверных функций (C3.3, этап 3). Только сервер: клиентский код (src/)
// этот модуль не импортирует; секреты читаются из переменных окружения функции, без префикса VITE_.
//
// Режимы:
// - production — ключ сервисного аккаунта из FIREBASE_SERVICE_ACCOUNT_B64 (JSON в base64);
// - emulator — только если заданы ОБА адреса эмуляторов (Firestore и Auth), проект начинается с «demo-»
//   и функция работает не на Vercel. Рабочий ключ и эмуляторы никогда не смешиваются.
// Если настроить безопасно нельзя — возвращается ошибка конфигурации, и API отвечает 503.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { cert, getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getAppCheck } from 'firebase-admin/app-check';

const APP_NAME = 'aroma-orders';
const DEMO_PREFIX = 'demo-';

/** Какой режим допустим при данных переменных окружения: { mode, projectId, credential } или { error } */
export function resolveAdminConfig(env) {
  const firestoreEmu = env.FIRESTORE_EMULATOR_HOST;
  const authEmu = env.FIREBASE_AUTH_EMULATOR_HOST;
  if (firestoreEmu || authEmu) {
    if (env.VERCEL) return { error: 'emulator-on-vercel' };
    if (!firestoreEmu || !authEmu) return { error: 'emulator-incomplete' };
    if (env.FIREBASE_SERVICE_ACCOUNT_B64) return { error: 'emulator-with-credentials' };
    const projectId = env.GCLOUD_PROJECT || env.GOOGLE_CLOUD_PROJECT;
    if (typeof projectId !== 'string' || !projectId.startsWith(DEMO_PREFIX)) return { error: 'emulator-not-demo' };
    return { mode: 'emulator', projectId };
  }
  const b64 = env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (!b64) return { error: 'not-configured' };
  let account;
  try {
    account = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  } catch {
    return { error: 'credentials-invalid' };
  }
  if (
    !account ||
    account.type !== 'service_account' ||
    typeof account.project_id !== 'string' ||
    typeof account.client_email !== 'string' ||
    typeof account.private_key !== 'string'
  ) {
    return { error: 'credentials-invalid' };
  }
  if (account.project_id.startsWith(DEMO_PREFIX)) return { error: 'credentials-demo-project' };
  return { mode: 'production', projectId: account.project_id, credential: account };
}

let cached = null;

/**
 * Admin SDK: { mode, projectId, auth, db, verifyAppCheck } или { error }.
 * Инициализируется один раз на экземпляр функции.
 */
export function getAdmin(env = process.env) {
  if (cached) return cached;
  const config = resolveAdminConfig(env);
  if (config.error) return { error: config.error };
  const options = { projectId: config.projectId };
  if (config.mode === 'production') options.credential = cert(config.credential);
  const app = getApps().some((a) => a.name === APP_NAME) ? getApp(APP_NAME) : initializeApp(options, APP_NAME);
  const db = getFirestore(app);
  cached = {
    mode: config.mode,
    projectId: config.projectId,
    auth: getAuth(app),
    db,
    verifyAppCheck: config.mode === 'production' ? productionAppCheck(app) : emulatorAppCheck(db, env),
  };
  return cached;
}

/** Только для тестов: сбросить кеш (новая конфигурация в том же процессе) */
export function resetAdminForTests() {
  cached = null;
}

/**
 * Рабочая проверка App Check: одноразовый токен (getLimitedUseToken в браузере) с consume: true —
 * повторное использование того же токена отклоняется (alreadyConsumed).
 */
function productionAppCheck(app) {
  const appCheck = getAppCheck(app);
  return async (token) => {
    const result = await appCheck.verifyToken(token, { consume: true });
    if (result.alreadyConsumed) throw Object.assign(new Error('app-check-consumed'), { code: 'app-check/consumed' });
    return { appId: result.appId };
  };
}

// ---------- Тестовая проверка App Check: ТОЛЬКО эмулятор и проект demo-* ----------
// У App Check нет эмулятора. В режиме эмулятора принимаются только токены, подписанные секретом
// APP_CHECK_TEST_SECRET (≥ 32 символов), с коротким сроком и одноразовые (отметка в Firestore эмулятора).
// Без секрета отклоняется любой токен. В рабочем режиме эта ветка недостижима: getAdmin выбирает
// эмулятор только при demo-проекте вне Vercel.

const TEST_TOKEN_TTL_MS = 5 * 60 * 1000;
const testSignature = (secret, nonce, expMs) => createHmac('sha256', secret).update(`appcheck-test\u001f${nonce}\u001f${expMs}`).digest('hex');

/** Тестовый токен App Check для эмулятора (используют только тесты) */
export function createTestAppCheckToken(secret, { nonce, now = Date.now(), ttlMs = TEST_TOKEN_TTL_MS } = {}) {
  const n = nonce || Math.random().toString(36).slice(2) + Date.now().toString(36);
  const expMs = now + ttlMs;
  return `test.${n}.${expMs}.${testSignature(secret, n, expMs)}`;
}

function emulatorAppCheck(db, env) {
  const secret = env.APP_CHECK_TEST_SECRET;
  return async (token, { now = Date.now() } = {}) => {
    if (typeof secret !== 'string' || secret.length < 32) throw Object.assign(new Error('app-check-test-disabled'), { code: 'app-check/disabled' });
    const parts = typeof token === 'string' ? token.split('.') : [];
    if (parts.length !== 4 || parts[0] !== 'test' || !/^[a-z0-9]{8,64}$/.test(parts[1]) || !/^\d{13}$/.test(parts[2])) {
      throw Object.assign(new Error('app-check-invalid'), { code: 'app-check/invalid' });
    }
    const [, nonce, expRaw, sig] = parts;
    const expMs = Number(expRaw);
    const expected = Buffer.from(testSignature(secret, nonce, expMs), 'hex');
    const given = Buffer.from(sig, 'hex');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw Object.assign(new Error('app-check-invalid'), { code: 'app-check/invalid' });
    if (expMs < now || expMs - now > TEST_TOKEN_TTL_MS) throw Object.assign(new Error('app-check-expired'), { code: 'app-check/expired' });
    // Одноразовость: второй create того же nonce падает (ALREADY_EXISTS)
    try {
      await db.collection('appCheckTestTokens').doc(nonce).create({ usedAt: new Date(now).toISOString() });
    } catch {
      throw Object.assign(new Error('app-check-consumed'), { code: 'app-check/consumed' });
    }
    return { appId: 'test-app' };
  };
}
