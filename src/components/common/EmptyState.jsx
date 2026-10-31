import { Link } from 'react-router-dom';
import Icon from './Icon';

/** Пустое состояние: пустая корзина, нет избранного, ничего не найдено и т.п. */
export default function EmptyState({ icon = 'sparkle', title, text, actionLabel, actionTo, onAction, headingLevel = 'h2' }) {
  const Heading = headingLevel; // на «пустой» странице заголовок должен быть h1
  return (
    <div className="empty-state">
      <div className="empty-state__icon">
        <Icon name={icon} size={34} />
      </div>
      <Heading className="empty-state__title">{title}</Heading>
      {text && <p className="empty-state__text">{text}</p>}
      {actionLabel && actionTo && (
        <Link to={actionTo} className="btn btn--primary">
          {actionLabel}
        </Link>
      )}
      {actionLabel && onAction && !actionTo && (
        <button type="button" className="btn btn--primary" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}
