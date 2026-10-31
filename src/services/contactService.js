// Отправка формы «Контакты» по двум каналам:
//  • e-mail — через EmailJS прямо из браузера (Public Key EmailJS не секретный, он задуман для клиента);
//  • Telegram — через нашу серверную функцию /api/contact (токен бота хранится только на сервере).
import emailjs from '@emailjs/browser';

const EMAILJS = {
  serviceId: import.meta.env.VITE_EMAILJS_SERVICE_ID,
  templateId: import.meta.env.VITE_EMAILJS_TEMPLATE_ID,
  publicKey: import.meta.env.VITE_EMAILJS_PUBLIC_KEY,
};

export const CHANNELS = ['email', 'telegram'];

/** Ошибка с кодом: validation, rate_limited, network, not_configured, failed */
export class ContactError extends Error {
  constructor(code, fields) {
    super(code);
    this.code = code;
    this.fields = fields;
  }
}

async function sendEmail(values, topicLabel) {
  if (!EMAILJS.serviceId || !EMAILJS.templateId || !EMAILJS.publicKey) throw new ContactError('not_configured');
  // Названия параметров совпадают с переменными шаблона EmailJS: {{name}}, {{email}}, {{title}}, {{message}}, {{time}}
  const params = {
    name: values.name.trim(),
    email: values.email.trim(),
    reply_to: values.email.trim(),
    title: topicLabel,
    topic: values.topic,
    message: values.message.trim(),
    time: new Date().toLocaleString('ru-RU'),
  };
  try {
    await emailjs.send(EMAILJS.serviceId, EMAILJS.templateId, params, {
      publicKey: EMAILJS.publicKey,
      // Встроенная защита SDK: не чаще одного письма в 10 секунд из этого браузера
      limitRate: { id: 'aroma-contact', throttle: 10000 },
      blockHeadless: true,
    });
  } catch (err) {
    if (err?.status === 429) throw new ContactError('rate_limited');
    if (err instanceof TypeError || err?.status === 0) throw new ContactError('network');
    console.error('[contact] EmailJS:', err?.status, err?.text);
    throw new ContactError('failed');
  }
}

async function sendTelegram(values) {
  let res;
  try {
    res = await fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: values.name,
        email: values.email,
        topic: values.topic,
        message: values.message,
        hp: values.hp,
      }),
    });
  } catch {
    throw new ContactError('network');
  }
  const data = await res.json().catch(() => null);
  if (res.ok && data?.ok) return;
  if (res.status === 422) throw new ContactError('validation', data?.fields);
  if (res.status === 429) throw new ContactError('rate_limited');
  // 404 — функция не развёрнута (например, `npm run preview`), 500 not_configured — нет переменных окружения
  if (res.status === 404 || data?.error === 'not_configured') throw new ContactError('not_configured');
  throw new ContactError('failed');
}

/**
 * Отправляет сообщение во все каналы, кроме уже доставленных (`skip`).
 * Возвращает { delivered: ['email', ...], errors: { telegram: ContactError, ... } }.
 */
export async function sendContactMessage(values, { topicLabel, skip = [] } = {}) {
  const senders = { email: () => sendEmail(values, topicLabel), telegram: () => sendTelegram(values) };
  const channels = CHANNELS.filter((c) => !skip.includes(c));
  const results = await Promise.allSettled(channels.map((c) => senders[c]()));
  const delivered = [];
  const errors = {};
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') delivered.push(channels[i]);
    else errors[channels[i]] = r.reason instanceof ContactError ? r.reason : new ContactError('failed');
  });
  return { delivered, errors };
}
