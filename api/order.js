// Vercel Function: POST /api/order — серверное оформление заказа (C3.3, этап 3).
// Вся логика — в api/_lib/orderHandler.js: браузер присылает только «намерение» заказа, сервер сам
// проверяет покупателя (ID-токен Firebase или App Check гостя), считает цены и итог по каталогу,
// сохраняет заказ и отправляет уведомление в Telegram. Секреты — только в переменных окружения функции.

import { handleOrder } from './_lib/orderHandler.js';
import { MAX_BODY_BYTES } from './_lib/orderCore.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  // Размер — до разбора тела: Vercel разбирает JSON при первом обращении к req.body
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return res.status(413).json({ ok: false, error: 'too_large' });
  }
  let body;
  try {
    body = req.body;
  } catch {
    return res.status(400).json({ ok: false, error: 'bad_json' });
  }
  const result = await handleOrder({
    method: req.method,
    headers: req.headers,
    body,
    socketAddress: req.socket?.remoteAddress,
    env: process.env,
  });
  for (const [key, value] of Object.entries(result.headers)) res.setHeader(key, value);
  return res.status(result.status).json(result.body);
}
