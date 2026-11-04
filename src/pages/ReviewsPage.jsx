import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageHeader from '../components/common/PageHeader';
import RatingStars from '../components/common/RatingStars';
import ReviewsList from '../components/reviews/ReviewsList';
import ReviewForm from '../components/reviews/ReviewForm';
import { useReviews } from '../hooks/useReviews';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

// На телефоне форма ниже списка — кнопка прокручивает к ней
const scrollToForm = () => document.getElementById('review-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

export default function ReviewsPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('reviews.title'));
  const data = useReviews();
  const { stats } = data;
  const { hash } = useLocation();
  // Переход по ссылке /reviews#review-form (с главной). Ждём кадр: MainLayout сначала прокручивает наверх
  useEffect(() => {
    if (hash !== '#review-form') return undefined;
    const id = requestAnimationFrame(scrollToForm);
    return () => cancelAnimationFrame(id);
  }, [hash]);

  return (
    <>
      <PageHeader title={t('reviews.title')} subtitle={t('reviews.subtitle')} crumbs={[{ label: t('nav.reviews') }]} />
      <div className="container section--tight reviews-page">
        <div className="reviews-page__main">
          {stats?.count > 0 && (
            <div className="reviews-summary card">
              <span className="reviews-summary__value">{stats.average.toFixed(1)}</span>
              <div>
                <RatingStars value={Number(stats.average.toFixed(1))} showValue={false} />
                <p className="reviews-summary__count">{t('reviews.count', { count: stats.count })}</p>
              </div>
              <button type="button" className="btn btn--outline btn--sm reviews-summary__cta" onClick={scrollToForm}>
                {t('reviews.write')}
              </button>
            </div>
          )}
          <ReviewsList data={data} emptyAction={{ actionLabel: t('reviews.write'), onAction: scrollToForm }} />
        </div>
        <section id="review-form" className="card reviews-page__form" aria-labelledby="review-form-title">
          <h2 id="review-form-title" className="section__title section__title--sm">
            {t('reviews.formTitle')}
          </h2>
          <ReviewForm />
        </section>
      </div>
    </>
  );
}
