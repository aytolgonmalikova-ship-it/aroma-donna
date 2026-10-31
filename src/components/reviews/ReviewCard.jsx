import { useTranslation } from 'react-i18next';
import RatingStars from '../common/RatingStars';
import { formatDate } from '../../utils/format';

/** Карточка одного отзыва: инициал, имя, дата, звёзды, текст */
export default function ReviewCard({ review }) {
  const { i18n } = useTranslation();
  const initial = review.name.trim().charAt(0).toUpperCase();
  return (
    <article className="review-card card">
      <header className="review-card__head">
        <span className="review-card__avatar" aria-hidden="true">
          {initial}
        </span>
        <div className="review-card__meta">
          <h3 className="review-card__name">{review.name}</h3>
          <time className="review-card__date" dateTime={review.createdAt}>
            {formatDate(review.createdAt, i18n.language)}
          </time>
        </div>
      </header>
      <RatingStars value={review.rating} showValue={false} />
      <p className="review-card__text">{review.text}</p>
    </article>
  );
}
