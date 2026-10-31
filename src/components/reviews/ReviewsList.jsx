import { useTranslation } from 'react-i18next';
import ReviewCard from './ReviewCard';
import LoadingSpinner from '../common/LoadingSpinner';
import ErrorMessage from '../common/ErrorMessage';
import EmptyState from '../common/EmptyState';

/** Список отзывов со всеми состояниями: загрузка, ошибка, пусто, «Показать ещё» */
export default function ReviewsList({ data, emptyAction }) {
  const { t } = useTranslation();
  const { reviews, status, error, hasMore, loadingMore, moreError, reload, loadMore } = data;

  if (status === 'unavailable') {
    return <EmptyState icon="info" title={t('reviews.unavailableTitle')} text={t('reviews.notConfigured')} />;
  }
  if (status === 'loading') return <LoadingSpinner label={t('reviews.loading')} />;
  if (status === 'error') return <ErrorMessage message={t(`reviews.errors.${error}`)} onRetry={reload} />;
  if (!reviews.length) {
    return <EmptyState icon="star" title={t('reviews.emptyTitle')} text={t('reviews.emptyText')} {...emptyAction} />;
  }

  return (
    <>
      <div className="reviews-grid">
        {reviews.map((review) => (
          <ReviewCard key={review.id} review={review} />
        ))}
      </div>
      {moreError && <ErrorMessage message={t(`reviews.errors.${moreError}`)} />}
      {hasMore && (
        <div className="reviews__more">
          <button type="button" className="btn btn--outline" onClick={loadMore} disabled={loadingMore}>
            {loadingMore && <LoadingSpinner size="sm" />}
            {t('reviews.loadMore')}
          </button>
        </div>
      )}
    </>
  );
}
