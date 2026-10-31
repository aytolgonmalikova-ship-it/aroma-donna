// Vercel Function: POST /api/contact — отправляет сообщение формы «Контакты» в Telegram.
// Токен бота берётся из переменных окружения Vercel и никогда не попадает в браузер.

import { createRateLimiter, handleContact } from './_lib/contactHandler.js';

// Живёт, пока «тёплый» экземпляр функции не выгружен
const rateLimiter = createRateLimiter({ limit: 5, windowMs: 10 * 60 * 1000 });

export default async function handler(req, res) {
  // Vercel разбирает JSON сам и бросает исключение, если JSON испорчен
  let body;
  try {
    body = req.body;
  } catch {
    return res.status(400).json({ ok: false, error: 'bad_request' });
  }
  const result = await handleContact({
    method: req.method,
    headers: req.headers,
    body,
    ip: req.socket?.remoteAddress,
    env: process.env,
    rateLimiter,
  });
  res.setHeader('Cache-Control', 'no-store');
  for (const [key, value] of Object.entries(result.headers)) res.setHeader(key, value);
  res.status(result.status).json(result.body);
}
