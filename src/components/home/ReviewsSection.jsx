import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ReviewCard from '../reviews/ReviewCard';
import LoadingSpinner from '../common/LoadingSpinner';
import Icon from '../common/Icon';
import { useReviews } from '../../hooks/useReviews';

/**
 * Блок «Отзывы покупателей» на главной: три последних настоящих отзыва из Firestore.
 * Если отзывов нет, Firebase не настроен или произошла ошибка — только приглашение оставить отзыв.
 */
export default function ReviewsSection() {
  const { t } = useTranslation();
  const { reviews, status } = useReviews({ pageSize: 3, withStats: false });

  return (
    <section className="section reviews-home" aria-labelledby="home-reviews-title">
      <div className="container">
        <div className="section__head">
          <div>
            <p className="eyebrow">{t('reviews.eyebrow')}</p>
            <h2 id="home-reviews-title" className="section__title">
              {t('reviews.title')}
            </h2>
          </div>
          <Link to="/reviews" className="link-arrow">
            {t('reviews.all')} <Icon name="arrowRight" size={16} />
          </Link>
        </div>
        {status === 'loading' && <LoadingSpinner label={t('reviews.loading')} />}
        {status === 'ready' && reviews.length > 0 && (
          <div className="reviews-grid">
            {reviews.map((review) => (
              <ReviewCard key={review.id} review={review} />
            ))}
          </div>
        )}
        {status !== 'loading' && !(status === 'ready' && reviews.length > 0) && (
          <div className="reviews-home__invite card">
            <p>{t('reviews.invite')}</p>
            <Link to="/reviews#review-form" className="btn btn--primary">
              {t('reviews.write')}
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
