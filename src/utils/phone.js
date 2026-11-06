// Телефон покупателя (Блок 2): единый префикс +996 и 9 цифр после него.
// Чистые функции без React — их используют PhoneField, проверка формы, заказ и админ-панель.
//
// Форматы:
// - в поле формы — только 9 цифр после +996, на экране группами «700 123 456»;
// - в новом заказе — E.164 без пробелов: «+996700123456» (toStoredPhone);
// - старые номера в базе не меняются; в админ-панели кыргызский номер, который распознаётся
//   однозначно, показывается как «+996 700 123 456», любой другой — как есть (displayPhone).

export const PHONE_PREFIX = '+996';
export const PHONE_COUNTRY = '996';
export const PHONE_LOCAL_LENGTH = 9;

// Ошибки ввода (ключи перевода)
export const PHONE_ERRORS = {
  invalid: 'validation.phoneInvalid', // буквы и другие недопустимые символы
  foreign: 'validation.phoneForeign', // номер другой страны (+7…, 00 44…)
  tooLong: 'validation.phoneTooLong', // цифр больше, чем в номере Кыргызстана
};

const ALLOWED = /^[+\d\s().-]*$/;
const onlyDigits = (value) => String(value ?? '').replace(/\D/g, '');

/** Номер после +996: ровно 9 цифр, первая — не 0 (0 — это код выхода на межгород, а не часть номера) */
export const isKgLocal = (local) => typeof local === 'string' && /^[1-9]\d{8}$/.test(local);

/** «700123456» → «700 123 456»; неполный номер группируется так же: «7001» → «700 1» */
export function formatLocal(local) {
  const d = onlyDigits(local).slice(0, PHONE_LOCAL_LENGTH);
  return [d.slice(0, 3), d.slice(3, 6), d.slice(6)].filter(Boolean).join(' ');
}

/**
 * Разбор номера целиком (вставка, автозаполнение браузера): { digits, error }.
 * digits — цифры после +996 (может быть неполным — полноту проверяет isKgLocal), error — ключ из PHONE_ERRORS.
 * Код страны снимается только у полного номера Кыргызстана:
 * «+996 700 123 456», «00996700123456», «996700123456» (12 цифр), «0700 123 456» (10 цифр с 0).
 * Номер другой страны не превращается в +996, лишние цифры не обрезаются молча — возвращается ошибка.
 */
export function parsePhoneInput(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return { digits: '', error: null };
  if (!ALLOWED.test(text) || text.indexOf('+', 1) !== -1) return { digits: '', error: PHONE_ERRORS.invalid };
  const d = onlyDigits(text);
  const international = text.startsWith('+') ? d : d.startsWith('00') ? d.slice(2) : null;
  if (international !== null) {
    if (!international.startsWith(PHONE_COUNTRY)) {
      // «+», «+9», «+99» — начало +996, ещё не номер
      return PHONE_COUNTRY.startsWith(international) ? { digits: '', error: null } : { digits: '', error: PHONE_ERRORS.foreign };
    }
    const local = international.slice(PHONE_COUNTRY.length);
    return local.length > PHONE_LOCAL_LENGTH ? { digits: '', error: PHONE_ERRORS.tooLong } : { digits: local, error: null };
  }
  if (d.length === PHONE_LOCAL_LENGTH + 1 && d.startsWith('0')) return { digits: d.slice(1), error: null };
  if (d.length === PHONE_COUNTRY.length + PHONE_LOCAL_LENGTH && d.startsWith(PHONE_COUNTRY)) {
    return { digits: d.slice(PHONE_COUNTRY.length), error: null };
  }
  if (d.length > PHONE_LOCAL_LENGTH) return { digits: '', error: PHONE_ERRORS.tooLong };
  // Неполный местный номер с 0 в начале («0700 12») — 0 не входит в номер после +996
  return { digits: d.startsWith('0') ? d.slice(1) : d, error: null };
}

/** Сколько цифр в строке до позиции pos */
export function digitsBefore(text, pos) {
  return onlyDigits(String(text ?? '').slice(0, Math.max(0, pos))).length;
}

/** Позиция курсора в отформатированной строке после n-й цифры (пробел после группы не перепрыгивается) */
export function caretAfterDigits(formatted, n) {
  if (n <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < formatted.length; i++) {
    if (/\d/.test(formatted[i])) seen += 1;
    if (seen === n) return i + 1;
  }
  return formatted.length;
}

/**
 * Следующее значение поля при наборе и удалении: { digits, error, caret }.
 * prev — цифры до изменения; raw — новый текст поля (как его изменил браузер); caret — позиция курсора в raw;
 * inputType — InputEvent.inputType. caret в ответе — число цифр перед курсором (и когда изменение отклонено:
 * курсор остаётся там, где был до нажатия).
 * - Набор (insertText…): больше 9 цифр не вводится (изменение отклоняется); буквы игнорируются;
 *   первая цифра 0 в пустом поле игнорируется (привычка набирать 0700…); цифры 996 в начале — обычные цифры.
 * - Удаление пробела (Backspace/Delete рядом с пробелом) удаляет соседнюю цифру — иначе клавиша «не работает».
 * - Прочее (автозаполнение браузера и т. п.) — номер целиком через parsePhoneInput.
 */
export function nextPhoneValue(prev, raw, caret, inputType = '') {
  const prevDigits = onlyDigits(prev);
  const text = String(raw ?? '');
  const pos = caret ?? text.length;
  const typing = inputType.startsWith('insert') && !['insertFromPaste', 'insertFromDrop', 'insertReplacementText'].includes(inputType);
  const deleting = inputType.startsWith('delete');

  if (deleting) {
    let digits = onlyDigits(text);
    let at = digitsBefore(text, pos);
    if (digits === prevDigits && digits) {
      // Удалён только пробел: удалить цифру перед ним (Backspace) или после него (Delete)
      if (inputType === 'deleteContentForward') digits = digits.slice(0, at) + digits.slice(at + 1);
      else if (at > 0) {
        digits = digits.slice(0, at - 1) + digits.slice(at);
        at -= 1;
      }
    }
    return { digits, error: null, caret: at };
  }

  if (typing || (!text.includes('+') && onlyDigits(text).length <= PHONE_LOCAL_LENGTH && inputType === '')) {
    const digits = onlyDigits(text);
    if (digits.length > PHONE_LOCAL_LENGTH) {
      // 10-я цифра не вводится; курсор — где был до нажатия (без вставленных цифр)
      const before = digitsBefore(text, pos) - (digits.length - prevDigits.length);
      return { digits: prevDigits, error: null, caret: Math.min(Math.max(0, before), prevDigits.length) };
    }
    if (!prevDigits && digits === '0') return { digits: '', error: null, caret: 0 };
    return { digits, error: null, caret: digitsBefore(text, pos) };
  }

  const parsed = parsePhoneInput(text);
  if (parsed.error) return { digits: prevDigits, error: parsed.error, caret: prevDigits.length };
  return { digits: parsed.digits, error: null, caret: parsed.digits.length };
}

/**
 * Вставка из буфера обмена: { digits, error, caret }. start, end — выделение в отформатированном тексте поля.
 * Полный номер (с «+», с 00 или от 9 цифр) заменяет содержимое поля и разбирается целиком.
 * Короткий фрагмент вставляется на место выделения. Ошибка — значение поля не меняется, курсор — в начале выделения.
 */
export function pastePhone(prev, start, end, pasted) {
  const prevDigits = onlyDigits(prev);
  const formatted = formatLocal(prevDigits);
  const a = digitsBefore(formatted, start);
  const b = digitsBefore(formatted, end);
  const text = String(pasted ?? '').trim();
  if (!text) return { digits: prevDigits, error: null, caret: a };
  if (!ALLOWED.test(text)) return { digits: prevDigits, error: PHONE_ERRORS.invalid, caret: a };
  const piece = onlyDigits(text);
  const whole = text.startsWith('+') || piece.startsWith('00') || piece.length >= PHONE_LOCAL_LENGTH;
  if (whole) {
    const parsed = parsePhoneInput(text);
    if (parsed.error) return { digits: prevDigits, error: parsed.error, caret: a };
    return { digits: parsed.digits, error: null, caret: parsed.digits.length };
  }
  const digits = prevDigits.slice(0, a) + piece + prevDigits.slice(b);
  if (digits.length > PHONE_LOCAL_LENGTH) return { digits: prevDigits, error: PHONE_ERRORS.tooLong, caret: a };
  return { digits, error: null, caret: a + piece.length };
}

/**
 * Номер для сохранения в заказе: «+996700123456» (E.164).
 * Значение, которое не удаётся однозначно разобрать, возвращается как есть (без пробелов по краям) —
 * цифры не теряются; форма до этого не доходит: validateCheckout пропускает только 9 цифр.
 */
export function toStoredPhone(value) {
  const { digits, error } = parsePhoneInput(value);
  return !error && isKgLocal(digits) ? `${PHONE_PREFIX}${digits}` : String(value ?? '').trim();
}

/**
 * Номер для показа (админ-панель): { text, href }. Данные не меняются — только вид на экране.
 * Номер Кыргызстана, который распознаётся однозначно (+996 / 00996 / 996 и 9 цифр, 0 и 9 цифр,
 * с пробелами, скобками, дефисами), — «+996 700 123 456» и ссылка tel:+996700123456.
 * Иностранный или нестандартный — текст как есть, ссылка — как раньше (цифры и «+»). Пусто — text ''.
 */
export function displayPhone(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return { text: '', href: null };
  const { digits, error } = parsePhoneInput(raw);
  const full = onlyDigits(raw);
  // 9 цифр без кода страны — не однозначно (может быть номер другой страны), показываем как есть
  const kg = !error && isKgLocal(digits) && full.length > PHONE_LOCAL_LENGTH;
  if (kg) return { text: `${PHONE_PREFIX} ${formatLocal(digits)}`, href: `tel:${PHONE_PREFIX}${digits}` };
  const dial = raw.replace(/[^\d+]/g, '');
  return { text: raw, href: /\d/.test(dial) ? `tel:${dial}` : null };
}
