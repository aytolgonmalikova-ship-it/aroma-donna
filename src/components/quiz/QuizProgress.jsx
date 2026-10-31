import { useTranslation } from 'react-i18next';

/** Индикатор прогресса теста: «Шаг 2 из 5» и полоса */
export default function QuizProgress({ step, total }) {
  const { t } = useTranslation();
  const percent = Math.round(((step + 1) / total) * 100);
  return (
    <div className="quiz-progress">
      <p className="quiz-progress__label">{t('quiz.step', { current: step + 1, total })}</p>
      <div
        className="quiz-progress__bar"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={step + 1}
        aria-label={t('quiz.step', { current: step + 1, total })}
      >
        <span style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
