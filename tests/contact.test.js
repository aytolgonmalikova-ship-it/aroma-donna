// Тесты формы обратной связи: проверка данных, лимит частоты и серверная функция.
// Запуск: npm test (встроенный в Node.js тест-раннер, библиотеки не нужны).
// Настоящий Telegram не вызывается — вместо fetch подставляется заглушка.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateContact } from '../src/utils/validation.js';
import { createRateLimiter, formatTelegramMessage, handleContact } from '../api/_lib/contactHandler.js';

const VALID = { name: 'Айгерим', email: 'aigerim@mail.com', topic: 'order', message: 'Где мой заказ номер 15?' };
const ENV = { TELEGRAM_BOT_TOKEN: '123:test-token', TELEGRAM_CHAT_ID: '42' };

function fakeFetch(response = { ok: true, status: 200, body: { ok: true } }) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    if (response instanceof Error) throw response;
    return { ok: response.ok, status: response.status, json: async () => response.body };
  };
  fn.calls = calls;
  return fn;
}

const call = (overrides = {}) =>
  handleContact({
    method: 'POST',
    headers: { 'x-forwarded-for': '1.2.3.4' },
    body: JSON.stringify(VALID),
    env: ENV,
    rateLimiter: createRateLimiter(),
    fetchImpl: fakeFetch(),
    ...overrides,
  });

test('validateContact: корректные данные проходят', () => {
  assert.deepEqual(validateContact(VALID), {});
});

test('validateContact: ловит пустые, короткие, длинные поля и чужую тему', () => {
  const errors = validateContact({ name: 'A', email: 'not-email', topic: 'hack', message: 'коротко' });
  assert.equal(errors.name, 'validation.nameMin');
  assert.equal(errors.email, 'validation.email');
  assert.equal(errors.topic, 'validation.required');
  assert.equal(errors.message, 'validation.messageMin');
  assert.equal(validateContact({ ...VALID, message: 'x'.repeat(1001) }).message, 'validation.tooLong');
  assert.equal(validateContact({ ...VALID, name: '   ' }).name, 'validation.required');
});

test('rate limiter: пропускает лимит и блокирует следующий запрос', () => {
  let now = 0;
  const limiter = createRateLimiter({ limit: 2, windowMs: 1000, now: () => now });
  assert.equal(limiter.check('ip').allowed, true);
  assert.equal(limiter.check('ip').allowed, true);
  const blocked = limiter.check('ip');
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSec > 0);
  assert.equal(limiter.check('other-ip').allowed, true);
  now = 1001;
  assert.equal(limiter.check('ip').allowed, true);
});

test('formatTelegramMessage экранирует HTML', () => {
  const text = formatTelegramMessage({ ...VALID, name: '<b>x</b> & co' });
  assert.ok(text.includes('&lt;b&gt;x&lt;/b&gt; &amp; co'));
  assert.ok(text.includes('Вопрос о заказе'));
});

test('handleContact: успешная отправка в Telegram', async () => {
  const fetchImpl = fakeFetch();
  const result = await call({ fetchImpl });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true });
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(fetchImpl.calls[0].url, 'https://api.telegram.org/bot123:test-token/sendMessage');
  const sent = JSON.parse(fetchImpl.calls[0].init.body);
  assert.equal(sent.chat_id, '42');
  assert.equal(sent.parse_mode, 'HTML');
});

test('handleContact: принимает уже разобранное тело (как на Vercel)', async () => {
  const result = await call({ body: VALID });
  assert.equal(result.status, 200);
});

test('handleContact: только POST', async () => {
  const result = await call({ method: 'GET' });
  assert.equal(result.status, 405);
  assert.equal(result.headers.Allow, 'POST');
});

test('handleContact: неверный JSON и слишком большое тело', async () => {
  assert.equal((await call({ body: '{oops' })).status, 400);
  assert.equal((await call({ body: 'x'.repeat(20000) })).status, 413);
  assert.equal((await call({ body: [] })).status, 400);
});

test('handleContact: ошибки проверки возвращают 422 и не вызывают Telegram', async () => {
  const fetchImpl = fakeFetch();
  const result = await call({ body: { ...VALID, email: 'bad' }, fetchImpl });
  assert.equal(result.status, 422);
  assert.equal(result.body.fields.email, 'validation.email');
  assert.equal(fetchImpl.calls.length, 0);
});

test('handleContact: ловушка для ботов — ответ 200 без отправки', async () => {
  const fetchImpl = fakeFetch();
  const result = await call({ body: { ...VALID, hp: 'http://spam' }, fetchImpl });
  assert.equal(result.status, 200);
  assert.equal(fetchImpl.calls.length, 0);
});

test('handleContact: 429 после превышения лимита', async () => {
  const rateLimiter = createRateLimiter({ limit: 1, windowMs: 60000 });
  assert.equal((await call({ rateLimiter })).status, 200);
  const blocked = await call({ rateLimiter });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers['Retry-After']) > 0);
});

test('handleContact: нет переменных окружения → 500 not_configured', async () => {
  const fetchImpl = fakeFetch();
  const result = await call({ env: {}, fetchImpl });
  assert.equal(result.status, 500);
  assert.equal(result.body.error, 'not_configured');
  assert.equal(fetchImpl.calls.length, 0);
});

test('handleContact: ошибка Telegram или сети → 502, токен не утекает в ответ', async () => {
  const bad = await call({ fetchImpl: fakeFetch({ ok: false, status: 401, body: { ok: false, description: 'Unauthorized' } }) });
  assert.equal(bad.status, 502);
  assert.ok(!JSON.stringify(bad.body).includes('test-token'));
  const down = await call({ fetchImpl: fakeFetch(new TypeError('fetch failed')) });
  assert.equal(down.status, 502);
});
