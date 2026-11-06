// Vercel Function: POST /api/order-notify — ручная повторная отправка уведомления о заказе в Telegram
// (только администратор; проверки — api/_lib/notifyHandler.js). Секреты — только в переменных окружения функции.

import { handleNotify } from './_lib/notifyHandler.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (Number(req.headers['content-length']) > 1024) return res.status(400).json({ ok: false, error: 'invalid_request' });
  let body;
  try {
    body = req.body;
  } catch {
    return res.status(400).json({ ok: false, error: 'invalid_request' });
  }
  const result = await handleNotify({ method: req.method, headers: req.headers, body, env: process.env });
  for (const [key, value] of Object.entries(result.headers)) res.setHeader(key, value);
  return res.status(result.status).json(result.body);
}
