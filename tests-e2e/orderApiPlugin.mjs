// Тестовый сервер API заказов для сквозных тестов (C3.3, этапы 4–5): плагин Vite, подключается ТОЛЬКО
// в tests-e2e/admins.e2e.mjs (сервер на порту 5175). vite.config.js не меняется — серверы разработки
// 5173 и 5174 этого кода не содержат.
//
// - POST /api/order и /api/order-notify — те же обработчики, что у функций Vercel (api/_lib), с Admin SDK
//   в режиме эмулятора (проект demo-aroma-donna, адреса 127.0.0.1). Иначе — остановка при запуске.
// - Секреты HMAC и тестового App Check — случайные на каждый запуск; .env не читается.
// - Telegram подменён: запросы в сеть не уходят, учитывается только число «отправок».
// - GET /api/_test/app-check-token — тестовый токен App Check (у App Check нет эмулятора).
// - /api/_test/state — режимы для тестов: App Check (ok | off | invalid), Telegram (ok | fail, задержка).

import { randomBytes } from 'node:crypto';
import { handleOrder } from '../api/_lib/orderHandler.js';
import { handleNotify } from '../api/_lib/notifyHandler.js';
import { createTestAppCheckToken } from '../api/_lib/firebaseAdmin.js';

const PROJECT = 'demo-aroma-donna';
const MAX_BODY = 64 * 1024;

export function orderApiE2E() {
  if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099' || process.env.VERCEL) {
    throw new Error('orderApiE2E: только эмуляторы на 127.0.0.1 (npm run test:e2e)');
  }
  const env = {
    FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST,
    FIREBASE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST,
    GCLOUD_PROJECT: PROJECT,
    ORDER_HMAC_SECRET: randomBytes(32).toString('hex'),
    APP_CHECK_TEST_SECRET: randomBytes(32).toString('hex'),
    TELEGRAM_BOT_TOKEN: 'e2e-stub-token',
    TELEGRAM_CHAT_ID: 'e2e-stub-chat',
  };
  const state = { appCheck: 'ok', telegram: { mode: 'ok', delayMs: 0, calls: 0 } };
  // Подмена Telegram: в сеть ничего не уходит
  const fetchImpl = async (url) => {
    if (!String(url).startsWith('https://api.telegram.org/bote2e-stub-token/')) throw new Error('unexpected fetch');
    state.telegram.calls += 1;
    if (state.telegram.delayMs) await new Promise((r) => setTimeout(r, state.telegram.delayMs));
    return state.telegram.mode === 'fail'
      ? { ok: false, status: 500, json: async () => ({ ok: false }) }
      : { ok: true, status: 200, json: async () => ({ ok: true }) };
  };

  const readRaw = async (req) => {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) break;
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  };
  const send = (res, { status, body, headers = {} }) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    res.end(JSON.stringify(body));
  };

  return {
    name: 'order-api-e2e',
    configureServer(server) {
      server.middlewares.use('/api/order-notify', async (req, res) => {
        const raw = await readRaw(req);
        send(res, await handleNotify({ method: req.method, headers: req.headers, body: raw, env, deps: { fetchImpl } }));
      });
      server.middlewares.use('/api/order', async (req, res) => {
        const raw = await readRaw(req);
        send(res, await handleOrder({ method: req.method, headers: req.headers, body: raw, socketAddress: req.socket.remoteAddress, env, deps: { fetchImpl } }));
      });
      server.middlewares.use('/api/_test/app-check-token', (req, res) => {
        if (state.appCheck === 'off') return send(res, { status: 503, body: { ok: false } });
        const token = state.appCheck === 'invalid' ? createTestAppCheckToken('wrong-secret-wrong-secret-wrong-secret') : createTestAppCheckToken(env.APP_CHECK_TEST_SECRET);
        return send(res, { status: 200, body: { token }, headers: { 'Cache-Control': 'no-store' } });
      });
      server.middlewares.use('/api/_test/state', async (req, res) => {
        if (req.method === 'POST') {
          const next = JSON.parse(String(await readRaw(req)) || '{}');
          if (next.appCheck) state.appCheck = next.appCheck;
          if (next.telegram) Object.assign(state.telegram, next.telegram);
        }
        send(res, { status: 200, body: state });
      });
    },
  };
}
