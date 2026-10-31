// Проверка данных форм.
// Функции возвращают КЛЮЧ перевода ошибки (например 'validation.required'),
// а компонент переводит его через i18next — так ошибки показываются на выбранном языке.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const isEmail = (v) => EMAIL_RE.test(String(v).trim());

/**
 * Телефон Кыргызстана: +996 XXX XXX XXX или 0XXX XXX XXX.
 * Пробелы, скобки и дефисы разрешены — проверяем только цифры.
 */
export const isPhone = (v) => {
  const value = String(v).trim();
  if (!/^[+\d\s()-]+$/.test(value)) return false;
  const digits = value.replace(/\D/g, '');
  return (digits.startsWith('996') && digits.length === 12) || (digits.startsWith('0') && digits.length === 10);
};

export function validateLogin({ email, password }) {
  const errors = {};
  if (!email.trim()) errors.email = 'validation.required';
  else if (!isEmail(email)) errors.email = 'validation.email';
  if (!password) errors.password = 'validation.required';
  else if (password.length < 6) errors.password = 'validation.passwordMin';
  return errors;
}

export function validateRegister({ name, email, password, confirmPassword, agree }) {
  const errors = {};
  if (!name.trim()) errors.name = 'validation.required';
  else if (name.trim().length < 2) errors.name = 'validation.nameMin';
  if (!email.trim()) errors.email = 'validation.required';
  else if (!isEmail(email)) errors.email = 'validation.email';
  if (!password) errors.password = 'validation.required';
  else if (password.length < 6) errors.password = 'validation.passwordMin';
  if (!confirmPassword) errors.confirmPassword = 'validation.required';
  else if (password !== confirmPassword) errors.confirmPassword = 'validation.passwordMatch';
  if (!agree) errors.agree = 'validation.agree';
  return errors;
}

export function validateCheckout(values) {
  const errors = {};
  if (!values.name.trim()) errors.name = 'validation.required';
  else if (values.name.trim().length < 2) errors.name = 'validation.nameMin';
  if (!values.lastName.trim()) errors.lastName = 'validation.required';
  else if (values.lastName.trim().length < 2) errors.lastName = 'validation.lastNameMin';
  if (!values.phone.trim()) errors.phone = 'validation.required';
  else if (!isPhone(values.phone)) errors.phone = 'validation.phone';
  if (!values.email.trim()) errors.email = 'validation.required';
  else if (!isEmail(values.email)) errors.email = 'validation.email';
  if (values.delivery !== 'pickup') {
    if (!values.region.trim()) errors.region = 'validation.required';
    if (!values.city.trim()) errors.city = 'validation.required';
    if (!values.address.trim()) errors.address = 'validation.required';
    else if (values.address.trim().length < 5) errors.address = 'validation.addressMin';
  }
  if (!values.agree) errors.agree = 'validation.agree';
  return errors;
}

/**
 * Проверка данных банковской карты в DEMO-оплате.
 * Данные карты проверяются только в браузере и никуда не отправляются.
 * now — текущая дата (параметр нужен для тестов).
 */
export function validateCardPayment({ holder, number, expiry, cvv }, now = new Date()) {
  const errors = {};
  const h = String(holder ?? '').trim();
  const digits = String(number ?? '').replace(/\s/g, '');
  if (!h) errors.holder = 'validation.required';
  else if (h.length < 2 || !/^[\p{L}\s'-]+$/u.test(h)) errors.holder = 'validation.cardHolder';
  if (!digits) errors.number = 'validation.required';
  else if (!/^\d{16}$/.test(digits)) errors.number = 'validation.cardNumber';
  const m = /^(\d{2})\/(\d{2})$/.exec(String(expiry ?? '').trim());
  if (!expiry) errors.expiry = 'validation.required';
  else if (!m || +m[1] < 1 || +m[1] > 12) errors.expiry = 'validation.cardExpiry';
  else {
    // Карта действует до конца указанного месяца
    const endOfMonth = new Date(2000 + +m[2], +m[1], 1);
    if (endOfMonth <= now) errors.expiry = 'validation.cardExpired';
  }
  if (!cvv) errors.cvv = 'validation.required';
  else if (!/^\d{3}$/.test(cvv)) errors.cvv = 'validation.cardCvv';
  return errors;
}

// Правила формы обратной связи. Этот же файл импортирует серверная функция api/contact.js,
// поэтому браузер и сервер проверяют данные одинаково.
export const CONTACT_TOPICS = ['question', 'order', 'consultation', 'other'];
export const CONTACT_LIMITS = { nameMin: 2, nameMax: 100, emailMax: 254, messageMin: 10, messageMax: 1000 };

export function validateContact({ name, email, topic, message }) {
  const errors = {};
  const n = String(name ?? '').trim();
  const e = String(email ?? '').trim();
  const m = String(message ?? '').trim();
  if (!n) errors.name = 'validation.required';
  else if (n.length < CONTACT_LIMITS.nameMin) errors.name = 'validation.nameMin';
  else if (n.length > CONTACT_LIMITS.nameMax) errors.name = 'validation.tooLong';
  if (!e) errors.email = 'validation.required';
  else if (e.length > CONTACT_LIMITS.emailMax || !isEmail(e)) errors.email = 'validation.email';
  if (!CONTACT_TOPICS.includes(topic)) errors.topic = 'validation.required';
  if (!m) errors.message = 'validation.required';
  else if (m.length < CONTACT_LIMITS.messageMin) errors.message = 'validation.messageMin';
  else if (m.length > CONTACT_LIMITS.messageMax) errors.message = 'validation.tooLong';
  return errors;
}

// Правила отзыва. Те же ограничения продублированы в firestore.rules — там их проверяет сервер Firebase.
export const REVIEW_LIMITS = { nameMin: 2, nameMax: 50, textMin: 10, textMax: 1000 };

export function validateReview({ name, rating, text }) {
  const errors = {};
  const n = String(name ?? '').trim();
  const t = String(text ?? '').trim();
  if (!n) errors.name = 'validation.required';
  else if (n.length < REVIEW_LIMITS.nameMin) errors.name = 'validation.nameMin';
  else if (n.length > REVIEW_LIMITS.nameMax) errors.name = 'validation.tooLong';
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) errors.rating = 'validation.rating';
  if (!t) errors.text = 'validation.required';
  else if (t.length < REVIEW_LIMITS.textMin) errors.text = 'validation.messageMin';
  else if (t.length > REVIEW_LIMITS.textMax) errors.text = 'validation.tooLong';
  return errors;
}

export const hasErrors = (errors) => Object.keys(errors).length > 0;
