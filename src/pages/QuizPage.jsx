import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import PageHeader from '../components/common/PageHeader';
import FragranceQuiz from '../components/quiz/FragranceQuiz';
import LoadingSpinner from '../components/common/LoadingSpinner';
import { selectProductsStatus } from '../features/products/productsSlice';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

export default function QuizPage() {
  const { t } = useTranslation();
  const status = useSelector(selectProductsStatus);
  useDocumentTitle(t('quiz.title'));
  return (
    <>
      <PageHeader title={t('quiz.title')} subtitle={t('quiz.subtitle')} crumbs={[{ label: t('nav.quiz') }]} />
      <div className="container section--tight quiz-page">
        {status === 'succeeded' ? <FragranceQuiz /> : <LoadingSpinner />}
      </div>
    </>
  );
}
