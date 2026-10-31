// Логика серверной функции формы обратной связи.
// Не зависит от Vercel: её вызывают api/contact.js (на Vercel), vite.config.js (в npm run dev) и тесты.
// Папка начинается с «_», поэтому Vercel не превращает этот файл в отдельный адрес /api/...

import { hasErrors, validateContact } from '../../src/utils/validation.js';

// Подписи тем для сообщения в Telegram (владельцу магазина)
const TOPIC_LABELS = {
  question: 'Вопрос об аромате',
  order: 'Вопрос о заказе',
  consultation: 'Консультация по подбору',
  other: 'Другое',
};

const MAX_BODY_BYTES = 10 * 1024;
const TELEGRAM_TIMEOUT_MS = 8000;

/**
 * Ограничение частоты запросов: не больше `limit` запросов с одного IP за `windowMs`.
 * Хранится в памяти функции — на Vercel у каждого экземпляра своя память,
 * поэтому это защита «от случайного спама», а не строгий лимит (см. README).
 */
export function createRateLimiter({ limit = 5, windowMs = 10 * 60 * 1000, now = Date.now } = {}) {
  const hits = new Map();
  return {
    check(key) {
      const t = now();
      const recent = (hits.get(key) || []).filter((ts) => t - ts < windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return { allowed: false, retryAfterSec: Math.ceil((windowMs - (t - recent[0])) / 1000) };
      }
      recent.push(t);
      hits.set(key, recent);
      // Чтобы память не росла бесконечно, иногда удаляем старые записи
      if (hits.size > 5000) {
        for (const [k, list] of hits) if (!list.some((ts) => t - ts < windowMs)) hits.delete(k);
      }
      return { allowed: true };
    },
  };
}

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function formatTelegramMessage({ name, email, topic, message }) {
  return [
    '<b>📩 Новое сообщение с сайта AROMA DONNA</b>',
    '',
    `<b>Имя:</b> ${escapeHtml(name)}`,
    `<b>Email:</b> ${escapeHtml(email)}`,
    `<b>Тема:</b> ${escapeHtml(TOPIC_LABELS[topic] || topic)}`,
    '',
    escapeHtml(message),
  ].join('\n');
}

const reply = (status, body, headers = {}) => ({ status, body, headers });

function getClientIp(headers, fallback) {
  const forwarded = headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return headers['x-real-ip'] || fallback || 'unknown';
}

/**
 * Обрабатывает запрос формы и возвращает { status, body, headers }.
 * env — переменные окружения сервера (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID).
 */
export async function handleContact({ method, headers = {}, body, ip, env, rateLimiter, fetchImpl = fetch }) {
  if (method !== 'POST') return reply(405, { ok: false, error: 'method_not_allowed' }, { Allow: 'POST' });

  // Тело может прийти строкой (локально) или уже разобранным объектом (Vercel)
  let data = body;
  if (typeof data === 'string' || Buffer.isBuffer(data)) {
    if (Buffer.byteLength(data) > MAX_BODY_BYTES) return reply(413, { ok: false, error: 'too_large' });
    try {
      data = JSON.parse(String(data));
    } catch {
      return reply(400, { ok: false, error: 'bad_request' });
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return reply(400, { ok: false, error: 'bad_request' });

  // Скрытое поле-ловушка: человек его не видит и не заполняет, боты — заполняют.
  // Отвечаем «ок», чтобы бот не пытался снова, но ничего не отправляем.
  if (data.hp) return reply(200, { ok: true });

  const values = {
    name: String(data.name ?? '').trim(),
    email: String(data.email ?? '').trim(),
    topic: String(data.topic ?? ''),
    message: String(data.message ?? '').trim(),
  };
  const errors = validateContact(values);
  if (hasErrors(errors)) return reply(422, { ok: false, error: 'validation', fields: errors });

  const limit = rateLimiter.check(getClientIp(headers, ip));
  if (!limit.allowed) {
    return reply(429, { ok: false, error: 'rate_limited', retryAfter: limit.retryAfterSec }, { 'Retry-After': String(limit.retryAfterSec) });
  }

  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.error('[contact] TELEGRAM_BOT_TOKEN или TELEGRAM_CHAT_ID не заданы');
    return reply(500, { ok: false, error: 'not_configured' });
  }

  try {
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: formatTelegramMessage(values),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok || !result.ok) {
      // В лог пишем только описание ошибки Telegram — токен в лог не попадает
      console.error('[contact] Telegram ответил ошибкой:', res.status, result.description);
      return reply(502, { ok: false, error: 'telegram_failed' });
    }
  } catch (err) {
    console.error('[contact] Не удалось связаться с Telegram:', err.name);
    return reply(502, { ok: false, error: 'telegram_failed' });
  }

  return reply(200, { ok: true });
}
