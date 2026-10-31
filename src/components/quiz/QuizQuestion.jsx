import { useTranslation } from 'react-i18next';
import Icon from '../common/Icon';

/**
 * Один вопрос теста.
 * type 'single' — радиокнопки (один ответ), 'multiple' — чекбоксы (до max ответов).
 */
export default function QuizQuestion({ question, value, onChange }) {
  const { t } = useTranslation();
  const isMultiple = question.type === 'multiple';
  const selected = isMultiple ? value || [] : value;

  const optionLabel = (opt) => {
    switch (question.id) {
      case 'category':
        return t(`categories.${opt}`);
      case 'family':
        return t(`families.${opt}`);
      case 'notes':
        return t(`notes.items.${opt}`);
      case 'intensity':
        return t(`intensity.${opt}`);
      default:
        return t(`quiz.options.${question.id}.${opt}`);
    }
  };

  const optionHint = (opt) => {
    if (question.id === 'family') return t(`familyDescriptions.${opt}`);
    if (question.id === 'intensity') return t(`quiz.options.intensity.${opt}`);
    if (question.id === 'budget') return t(`quiz.options.budgetHint.${opt}`);
    return null;
  };

  const toggle = (opt) => {
    if (!isMultiple) {
      onChange(opt);
      return;
    }
    if (selected.includes(opt)) onChange(selected.filter((x) => x !== opt));
    else if (selected.length < question.max) onChange([...selected, opt]);
  };

  return (
    <fieldset className="quiz-question">
      <legend className="quiz-question__title">{t(`quiz.questions.${question.id}.title`)}</legend>
      <p className="quiz-question__hint">
        {t(`quiz.questions.${question.id}.hint`)}
        {isMultiple && ` (${selected.length}/${question.max})`}
      </p>
      <div className={`quiz-options quiz-options--${question.id}`}>
        {question.options.map((opt) => {
          const checked = isMultiple ? selected.includes(opt) : selected === opt;
          const disabled = isMultiple && !checked && selected.length >= question.max;
          const hint = optionHint(opt);
          return (
            <label key={opt} className={`quiz-option ${checked ? 'is-active' : ''} ${disabled ? 'is-disabled' : ''}`}>
              <input
                type={isMultiple ? 'checkbox' : 'radio'}
                name={question.id}
                value={opt}
                checked={checked}
                disabled={disabled}
                onChange={() => toggle(opt)}
              />
              <span className="quiz-option__check" aria-hidden="true">
                <Icon name="check" size={14} strokeWidth={2.4} />
              </span>
              <span className="quiz-option__label">{optionLabel(opt)}</span>
              {hint && <span className="quiz-option__hint">{hint}</span>}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
