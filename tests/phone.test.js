// Тесты утилиты телефона (Блок 2, этап 1): разбор ввода и вставки, набор и удаление, курсор,
// формат хранения E.164 и показ старых номеров без изменения данных. Запуск: npm test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PHONE_ERRORS,
  caretAfterDigits,
  digitsBefore,
  displayPhone,
  formatLocal,
  isKgLocal,
  nextPhoneValue,
  parsePhoneInput,
  pastePhone,
  toStoredPhone,
} from '../src/utils/phone.js';

test('parsePhoneInput: полный номер Кыргызстана в любом привычном виде → 9 цифр', () => {
  for (const input of [
    '+996 700 123 456',
    '+996700123456',
    '+996-700-12-34-56',
    '+996 (700) 12-34-56',
    '  +996 700 123 456  ',
    '996700123456',
    '996 700 123 456',
    '00996 700 123 456',
    '0700 123 456',
    '0700123456',
    '(0700) 12-34-56',
    '0 700 12 34 56',
    '700 123 456',
    '700.123.456',
  ]) {
    assert.deepEqual(parsePhoneInput(input), { digits: '700123456', error: null }, input);
  }
});

test('parsePhoneInput: иностранный номер не превращается в +996', () => {
  for (const input of ['+7 912 345 67 89', '+79123456789', '+1 (212) 555-0100', '0044 20 7946 0958', '+44 20 7946 0958', '+997 555 123 456']) {
    assert.deepEqual(parsePhoneInput(input), { digits: '', error: PHONE_ERRORS.foreign }, input);
  }
});

test('parsePhoneInput: слишком длинный номер — ошибка, а не молчаливая обрезка', () => {
  for (const input of ['+996 700 123 4567', '9967001234567', '07001234567', '1234567890', '700 123 456 7', '+996 0700 123 456']) {
    assert.deepEqual(parsePhoneInput(input), { digits: '', error: PHONE_ERRORS.tooLong }, input);
  }
});

test('parsePhoneInput: недопустимые символы — ошибка; пустой ввод и начало «+996» — без ошибки', () => {
  for (const input of ['70O 123 456', 'тел. 700123456', '700#123', '+996+700123456', '700_123_456']) {
    assert.deepEqual(parsePhoneInput(input), { digits: '', error: PHONE_ERRORS.invalid }, input);
  }
  for (const input of ['', '   ', null, undefined, '+', '+9', '+99', '+996']) {
    assert.deepEqual(parsePhoneInput(input), { digits: '', error: null }, String(input));
  }
  // Неполный номер: цифры сохраняются, полноту проверяет isKgLocal
  assert.deepEqual(parsePhoneInput('+996 700'), { digits: '700', error: null });
  assert.deepEqual(parsePhoneInput('0700 12'), { digits: '70012', error: null });
});

test('parsePhoneInput: 996 в начале 9-значного номера — часть номера, а не код страны', () => {
  assert.deepEqual(parsePhoneInput('996123456'), { digits: '996123456', error: null });
  assert.deepEqual(parsePhoneInput('996 12'), { digits: '99612', error: null });
  assert.deepEqual(parsePhoneInput('+996 996 123 456'), { digits: '996123456', error: null });
  assert.deepEqual(parsePhoneInput('996996123456'), { digits: '996123456', error: null });
});

test('isKgLocal: ровно 9 цифр, первая не 0', () => {
  for (const ok of ['700123456', '555000000', '996123456', '312123456', '220123456']) assert.equal(isKgLocal(ok), true, ok);
  for (const bad of ['', '70012345', '7001234567', '070012345', '700 123 456', '+996700123456', null, 700123456]) {
    assert.equal(isKgLocal(bad), false, String(bad));
  }
});

test('formatLocal: группы 3-3-3 для 0–9 цифр', () => {
  const expected = ['', '7', '70', '700', '700 1', '700 12', '700 123', '700 123 4', '700 123 45', '700 123 456'];
  for (let n = 0; n <= 9; n++) assert.equal(formatLocal('700123456'.slice(0, n)), expected[n], String(n));
  assert.equal(formatLocal('7001234567'), '700 123 456', 'не больше 9 цифр');
});

test('курсор: digitsBefore и caretAfterDigits', () => {
  const f = '700 123 456';
  assert.equal(digitsBefore(f, 0), 0);
  assert.equal(digitsBefore(f, 3), 3);
  assert.equal(digitsBefore(f, 4), 3, 'пробел не цифра');
  assert.equal(digitsBefore(f, 11), 9);
  assert.equal(caretAfterDigits(f, 0), 0);
  assert.equal(caretAfterDigits(f, 3), 3, 'после группы курсор остаётся перед пробелом');
  assert.equal(caretAfterDigits(f, 4), 5);
  assert.equal(caretAfterDigits(f, 9), 11);
  assert.equal(caretAfterDigits('700', 5), 3);
});

test('набор: цифра за цифрой до 9, десятая не вводится, буквы игнорируются', () => {
  let digits = '';
  for (const ch of '7001234567') {
    const formatted = formatLocal(digits);
    const r = nextPhoneValue(digits, formatted + ch, formatted.length + 1, 'insertText');
    digits = r.digits;
    assert.equal(r.error, null);
  }
  assert.equal(digits, '700123456', '10-я цифра отклонена');
  assert.deepEqual(nextPhoneValue('700', '700a', 4, 'insertText'), { digits: '700', error: null, caret: 3 });
  assert.deepEqual(nextPhoneValue('700', '700+', 4, 'insertText'), { digits: '700', error: null, caret: 3 });
});

test('набор: начальные 996 сохраняются; 0 в пустом поле игнорируется (привычка набирать 0700)', () => {
  let digits = '';
  for (const ch of '996123456') {
    const formatted = formatLocal(digits);
    digits = nextPhoneValue(digits, formatted + ch, formatted.length + 1, 'insertText').digits;
  }
  assert.equal(digits, '996123456');
  assert.deepEqual(nextPhoneValue('', '0', 1, 'insertText'), { digits: '', error: null, caret: 0 });
  digits = '';
  for (const ch of '0700123456') {
    const formatted = formatLocal(digits);
    digits = nextPhoneValue(digits, formatted + ch, formatted.length + 1, 'insertText').digits;
  }
  assert.equal(digits, '700123456');
});

test('редактирование: вставка цифры в середину, замена выделения, курсор', () => {
  // «700 12|3 45» + «9» → «700 129 345», курсор после 6-й цифры
  assert.deepEqual(nextPhoneValue('70012345', '700 129|3 45'.replace('|', ''), 7, 'insertText'), { digits: '700129345', error: null, caret: 6 });
  // Полное поле: замена выделенной цифры не увеличивает длину
  assert.deepEqual(nextPhoneValue('700123456', '800 123 456', 1, 'insertText'), { digits: '800123456', error: null, caret: 1 });
  // Полное поле, ввод без выделения — отклонён, курсор остаётся там, где был (после 3-й цифры, в конце)
  assert.deepEqual(nextPhoneValue('700123456', '7000 123 456', 4, 'insertText'), { digits: '700123456', error: null, caret: 3 });
  assert.deepEqual(nextPhoneValue('700123456', '700 123 4567', 12, 'insertText'), { digits: '700123456', error: null, caret: 9 });
});

test('удаление: Backspace и Delete, в том числе рядом с пробелом', () => {
  // «700 123 456|» Backspace → «700 123 45»
  assert.deepEqual(nextPhoneValue('700123456', '700 123 45', 10, 'deleteContentBackward'), { digits: '70012345', error: null, caret: 8 });
  // «700 |123» Backspace удаляет пробел → браузер даёт «700123»; удаляется цифра перед пробелом
  assert.deepEqual(nextPhoneValue('700123', '700123', 3, 'deleteContentBackward'), { digits: '70123', error: null, caret: 2 });
  // «700| 123» Delete удаляет пробел → удаляется цифра после него
  assert.deepEqual(nextPhoneValue('700123', '700123', 3, 'deleteContentForward'), { digits: '70023', error: null, caret: 3 });
  // Удаление выделенного фрагмента
  assert.deepEqual(nextPhoneValue('700123456', '700 456', 4, 'deleteContentBackward'), { digits: '700456', error: null, caret: 3 });
  // Всё стёрто
  assert.deepEqual(nextPhoneValue('7', '', 0, 'deleteContentBackward'), { digits: '', error: null, caret: 0 });
});

test('автозаполнение браузера: полный номер распознаётся, иностранный — ошибка без изменения поля', () => {
  assert.deepEqual(nextPhoneValue('', '+996 700 123 456', 16, 'insertReplacementText'), { digits: '700123456', error: null, caret: 9 });
  assert.deepEqual(nextPhoneValue('', '0700123456', 10, ''), { digits: '700123456', error: null, caret: 9 });
  assert.deepEqual(nextPhoneValue('', '700123456', 9, ''), { digits: '700123456', error: null, caret: 9 });
  assert.deepEqual(nextPhoneValue('55', '+7 912 345 67 89', 16, ''), { digits: '55', error: PHONE_ERRORS.foreign, caret: 2 });
});

test('вставка: полный номер заменяет поле; иностранный, длинный и с буквами — ошибка, поле не меняется', () => {
  for (const text of ['+996 700 123 456', '0700 123 456', '996700123456', '(0700) 12-34-56', '700123456', '00996700123456']) {
    assert.deepEqual(pastePhone('555', 0, 3, text), { digits: '700123456', error: null, caret: 9 }, text);
    assert.deepEqual(pastePhone('', 0, 0, text).digits, '700123456', `${text} в пустое поле`);
  }
  assert.deepEqual(pastePhone('555', 3, 3, '+7 912 345 67 89'), { digits: '555', error: PHONE_ERRORS.foreign, caret: 3 });
  assert.deepEqual(pastePhone('555', 3, 3, '+996 700 123 4567'), { digits: '555', error: PHONE_ERRORS.tooLong, caret: 3 });
  assert.deepEqual(pastePhone('555', 3, 3, '1234567890'), { digits: '555', error: PHONE_ERRORS.tooLong, caret: 3 });
  assert.deepEqual(pastePhone('555', 3, 3, 'тел 700'), { digits: '555', error: PHONE_ERRORS.invalid, caret: 3 });
  assert.deepEqual(pastePhone('555', 3, 3, '   '), { digits: '555', error: null, caret: 3 });
});

test('вставка фрагмента: на место курсора или выделения; переполнение — ошибка', () => {
  // «700 |» + «12-34» → «700 123 4»
  assert.deepEqual(pastePhone('700', 4, 4, '12-34'), { digits: '7001234', error: null, caret: 7 });
  // «7|00 123» + «55» → «755 001 23»
  assert.deepEqual(pastePhone('700123', 1, 1, '55'), { digits: '75500123', error: null, caret: 3 });
  // Выделено «123» в «700 123 456» → «99»
  assert.deepEqual(pastePhone('700123456', 4, 7, '99'), { digits: '70099456', error: null, caret: 5 });
  assert.deepEqual(pastePhone('7001234', 9, 9, '567'), { digits: '7001234', error: PHONE_ERRORS.tooLong, caret: 7 });
});

test('toStoredPhone: новый номер — E.164 без пробелов; неразборчивое значение не теряет цифр', () => {
  assert.equal(toStoredPhone('700123456'), '+996700123456');
  assert.equal(toStoredPhone('996123456'), '+996996123456');
  assert.equal(toStoredPhone('+996 700 123 456'), '+996700123456');
  assert.equal(toStoredPhone('0700 123 456'), '+996700123456');
  assert.equal(toStoredPhone(' +7 912 345 67 89 '), '+7 912 345 67 89');
  assert.equal(toStoredPhone('70012'), '70012');
  assert.equal(toStoredPhone(''), '');
});

test('displayPhone: старые кыргызские форматы — единый вид и tel:+996…; данные не меняются', () => {
  const legacy = [
    '+996 700 123 456',
    '+996700123456',
    '+996-700-123-456',
    '+996 (700) 12-34-56',
    '996700123456',
    '0700 123 456',
    '(0700) 12-34-56',
    '00996700123456',
  ];
  for (const value of legacy) {
    const copy = value;
    assert.deepEqual(displayPhone(value), { text: '+996 700 123 456', href: 'tel:+996700123456' }, value);
    assert.equal(value, copy);
  }
});

test('displayPhone: иностранные и нестандартные номера — как есть; пусто — без ссылки', () => {
  assert.deepEqual(displayPhone('+7 912 345-67-89'), { text: '+7 912 345-67-89', href: 'tel:+79123456789' });
  assert.deepEqual(displayPhone('700123456'), { text: '700123456', href: 'tel:700123456' }, '9 цифр без кода — неоднозначно');
  assert.deepEqual(displayPhone('+996 700 123 4567'), { text: '+996 700 123 4567', href: 'tel:+9967001234567' });
  assert.deepEqual(displayPhone('звонить после 18:00'), { text: 'звонить после 18:00', href: 'tel:1800' });
  assert.deepEqual(displayPhone('нет'), { text: 'нет', href: null });
  for (const empty of ['', '   ', null, undefined, 42]) assert.deepEqual(displayPhone(empty), { text: '', href: null }, String(empty));
});
