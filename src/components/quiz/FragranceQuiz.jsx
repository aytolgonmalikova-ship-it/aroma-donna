import { useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import QuizProgress from './QuizProgress';
import QuizQuestion from './QuizQuestion';
import QuizResults from './QuizResults';
import Icon from '../common/Icon';
import { QUIZ_QUESTIONS } from '../../data/quiz';
import { recommendProducts } from '../../utils/quizMatcher';
import { selectProducts } from '../../features/products/productsSlice';

const EMPTY_ANSWERS = { category: null, family: null, notes: [], intensity: null, budget: null };

/**
 * Тест подбора аромата.
 * Состояние теста (шаг и ответы) — локальное (useState): оно нужно только здесь.
 * После последнего шага ответы передаются в recommendProducts (utils/quizMatcher.js).
 */
export default function FragranceQuiz() {
  const { t } = useTranslation();
  const products = useSelector(selectProducts);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState(EMPTY_ANSWERS);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState('');
  const topRef = useRef(null); // для прокрутки к началу теста при смене шага

  const question = QUIZ_QUESTIONS[step];
  const isLast = step === QUIZ_QUESTIONS.length - 1;

  const results = useMemo(
    () => (finished ? recommendProducts(products, answers, 4) : []),
    [finished, products, answers],
  );

  // Проверка ответа на текущем шаге
  const isAnswered = (q) => {
    const value = answers[q.id];
    return q.type === 'multiple' ? value.length >= q.min : Boolean(value);
  };

  const scrollTop = () => topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const goNext = () => {
    if (!isAnswered(question)) {
      setError(question.type === 'multiple' ? t('quiz.errorMultiple', { min: question.min }) : t('quiz.errorSingle'));
      return;
    }
    setError('');
    if (isLast) setFinished(true);
    else setStep((s) => s + 1);
    scrollTop();
  };

  const goBack = () => {
    setError('');
    setStep((s) => Math.max(0, s - 1));
  };

  const restart = () => {
    setAnswers(EMPTY_ANSWERS);
    setStep(0);
    setFinished(false);
    setError('');
    scrollTop();
  };

  return (
    <div className="quiz card" ref={topRef}>
      {finished ? (
        <QuizResults results={results} answers={answers} onRestart={restart} />
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            goNext();
          }}
        >
          <QuizProgress step={step} total={QUIZ_QUESTIONS.length} />
          <QuizQuestion
            key={question.id}
            question={question}
            value={answers[question.id]}
            onChange={(value) => {
              setAnswers((a) => ({ ...a, [question.id]: value }));
              setError('');
            }}
          />
          {error && (
            <p className="field__error quiz__error" role="alert">
              {error}
            </p>
          )}
          <div className="quiz__nav">
            <button type="button" className="btn btn--ghost" onClick={goBack} disabled={step === 0}>
              <Icon name="arrowLeft" size={16} /> {t('quiz.back')}
            </button>
            <button type="submit" className="btn btn--primary">
              {isLast ? t('quiz.showResults') : t('quiz.next')} <Icon name="arrowRight" size={16} />
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
