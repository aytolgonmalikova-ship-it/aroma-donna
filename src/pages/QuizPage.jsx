import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import PageHeader from '../components/common/PageHeader';
import FragranceQuiz from '../components/quiz/FragranceQuiz';
import LoadingSpinner from '../components/common/LoadingSpinner';
import CatalogLoadError from '../components/common/CatalogLoadError';
import { selectProductsStatus } from '../features/products/productsSlice';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { catalogView } from '../utils/catalogStatus';

export default function QuizPage() {
  const { t } = useTranslation();
  const view = catalogView(useSelector(selectProductsStatus));
  useDocumentTitle(t('quiz.title'));
  return (
    <>
      <PageHeader title={t('quiz.title')} subtitle={t('quiz.subtitle')} crumbs={[{ label: t('nav.quiz') }]} />
      <div className="container section--tight quiz-page">
        {view === 'ready' ? <FragranceQuiz /> : view === 'error' ? <CatalogLoadError /> : <LoadingSpinner />}
      </div>
    </>
  );
}
