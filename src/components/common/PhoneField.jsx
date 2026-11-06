import { useLayoutEffect, useReducer, useRef, useState } from 'react';
import FormField from './FormField';
import { PHONE_PREFIX, caretAfterDigits, formatLocal, nextPhoneValue, pastePhone } from '../../utils/phone';

/**
 * Телефон Кыргызстана (Блок 2): неудаляемый префикс +996 и поле только для 9 цифр («700 123 456»).
 * value — цифры после +996 (до 9), onChange получает { target: { name, value: цифры } } — как обычное поле формы.
 * Правила набора, вставки и удаления — src/utils/phone.js (nextPhoneValue, pastePhone).
 * Ошибка ввода (иностранный, слишком длинный номер, буквы при вставке) показывается сразу, поле не меняется;
 * ошибка проверки формы приходит в error. Префикс — второй <label>: он входит в доступное имя поля
 * («Телефон +996») и по нажатию ставит курсор в поле.
 */
export default function PhoneField({ id, name = 'phone', label, value = '', onChange, error, required, disabled }) {
  const inputRef = useRef(null);
  const caretRef = useRef(null); // сколько цифр должно быть перед курсором после обновления
  const [inputError, setInputError] = useState(null);
  const [, rerender] = useReducer((n) => n + 1, 0);
  const shownError = inputError || error;
  const errorId = `${id}-error`;
  const formatted = formatLocal(value);

  // Курсор — после той же цифры, что и до форматирования (пробелы не сдвигают его)
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (caretRef.current === null || !el || el.ownerDocument.activeElement !== el) return;
    // Отклонённый ввод: в поле ещё текст браузера — вернуть отформатированный до установки курсора
    if (el.value !== formatted) el.value = formatted;
    const pos = caretAfterDigits(formatted, caretRef.current);
    el.setSelectionRange(pos, pos);
    caretRef.current = null;
  });

  const apply = (result) => {
    setInputError(result.error);
    caretRef.current = result.caret;
    if (result.digits !== value) onChange?.({ target: { name, value: result.digits, type: 'tel' } });
    else rerender(); // значение то же — вернуть отформатированный текст и курсор
  };

  return (
    <FormField id={id} label={label} error={shownError} required={required}>
      <div className="phone-input">
        <label htmlFor={id} className="phone-input__prefix">
          {PHONE_PREFIX}
        </label>
        <input
          ref={inputRef}
          id={id}
          name={name}
          className="field__control"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="700 123 456"
          value={formatted}
          onChange={(e) => apply(nextPhoneValue(value, e.target.value, e.target.selectionStart, e.nativeEvent?.inputType || ''))}
          onPaste={(e) => {
            e.preventDefault();
            apply(pastePhone(value, e.target.selectionStart ?? 0, e.target.selectionEnd ?? 0, e.clipboardData.getData('text')));
          }}
          disabled={disabled}
          aria-invalid={Boolean(shownError)}
          aria-describedby={shownError ? errorId : undefined}
          aria-required={required || undefined}
        />
      </div>
    </FormField>
  );
}
