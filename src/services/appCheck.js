/**
 * Firebase App Check для гостевого оформления заказа (C3.3, этап 4).
 * Сервер принимает гостевой заказ только с действительным одноразовым токеном App Check
 * (серверный обработчик /api/order); обхода нет: если токен получить нельзя — заказ не отправляется,
 * покупатель видит понятное сообщение.
 *
 * - Рабочий сайт: reCAPTCHA Enterprise (Google Cloud Fraud Defense) — провайдер ReCaptchaEnterpriseProvider,
 *   ключ VITE_RECAPTCHA_SITE_KEY (ключ Enterprise типа Web, по оценке; публичный, не секрет).
 *   Классический reCAPTCHA v3 Firebase пометил устаревшим — его провайдер не используется.
 *   Одноразовый токен getLimitedUseToken — сервер проверяет его с consume: true.
 *   Автообновление токенов выключено: сайту нужны только одноразовые токены при оформлении заказа,
 *   а каждое обновление — отдельная платная проверка reCAPTCHA.
 * - Тестовый режим с эмуляторами (только localhost и проект demo-aroma-donna): у App Check нет эмулятора,
 *   токен выдаёт тестовый сервер (tests-e2e/orderApiPlugin.mjs, только сквозные тесты); рабочий сервер его не принимает.
 */
import { getFirebase, isEmulatorMode } from './firebase';

const env = import.meta.env ?? {};

export class AppCheckUnavailableError extends Error {
  constructor(reason, httpStatus = null) {
    super(reason);
    this.code = 'app_check_unavailable';
    this.reason = reason;
    this.httpStatus = httpStatus;
  }
}

let appCheckPromise = null;

async function getAppCheckInstance() {
  const siteKey = env.VITE_RECAPTCHA_SITE_KEY;
  if (!siteKey) throw new AppCheckUnavailableError('no-site-key');
  if (!appCheckPromise) {
    appCheckPromise = Promise.all([getFirebase(), import('firebase/app-check')]).then(([{ app }, api]) => ({
      api,
      instance: api.initializeAppCheck(app, { provider: new api.ReCaptchaEnterpriseProvider(siteKey), isTokenAutoRefreshEnabled: false }),
    }));
    appCheckPromise.catch(() => {
      appCheckPromise = null;
    });
  }
  return appCheckPromise;
}

/** Одноразовый токен App Check для одного запроса гостевого заказа. Бросает AppCheckUnavailableError. */
export async function getGuestAppCheckToken() {
  try {
    if (isEmulatorMode) {
      const res = await fetch('/api/_test/app-check-token', { cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || typeof body.token !== 'string') throw new Error('test-token');
      return body.token;
    }
    const { api, instance } = await getAppCheckInstance();
    const { token } = await api.getLimitedUseToken(instance);
    if (!token) throw new Error('empty-token');
    return token;
  } catch (err) {
    if (err instanceof AppCheckUnavailableError) throw err;
    // httpStatus — ответ обмена токена reCAPTCHA в Firebase App Check (exchangeRecaptchaEnterpriseToken)
    throw new AppCheckUnavailableError(err?.code || err?.message || 'failed', err?.customData?.httpStatus ?? null);
  }
}
