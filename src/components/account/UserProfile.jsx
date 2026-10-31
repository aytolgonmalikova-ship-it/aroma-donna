import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { logoutUser } from '../../features/user/userSlice';
import { notify } from '../../features/notifications/notificationsSlice';
import { selectFavoriteIds } from '../../features/favorites/favoritesSlice';
import { selectCartCount } from '../../features/cart/cartSlice';
import { formatDate } from '../../utils/format';
import Icon from '../common/Icon';

/** Карточка профиля: имя, e-mail, дата регистрации, режим, кнопка выхода */
export default function UserProfile({ user, mode, ordersCount }) {
  const { t, i18n } = useTranslation();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const favoritesCount = useSelector(selectFavoriteIds).length;
  const cartCount = useSelector(selectCartCount);

  const handleLogout = async () => {
    await dispatch(logoutUser());
    dispatch(notify({ type: 'info', message: 'notify.loggedOut' }));
    navigate('/');
  };

  const initials = user.name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <section className="profile card" aria-labelledby="profile-title">
      <div className="profile__head">
        <span className="profile__avatar" aria-hidden="true">
          {initials}
        </span>
        <div>
          <h2 id="profile-title" className="profile__name">
            {user.name}
          </h2>
          <p className="profile__email">{user.email}</p>
        </div>
      </div>
      <dl className="profile__details">
        <div>
          <dt>{t('account.memberSince')}</dt>
          <dd>{formatDate(user.createdAt, i18n.resolvedLanguage)}</dd>
        </div>
        <div>
          <dt>{t('account.mode')}</dt>
          <dd>{mode === 'firebase' ? 'Firebase' : t('account.demoMode')}</dd>
        </div>
      </dl>
      <ul className="profile__stats">
        <li>
          <strong>{ordersCount}</strong>
          <span>{t('account.statOrders')}</span>
        </li>
        <li>
          <strong>{favoritesCount}</strong>
          <span>{t('account.statFavorites')}</span>
        </li>
        <li>
          <strong>{cartCount}</strong>
          <span>{t('account.statCart')}</span>
        </li>
      </ul>
      <button type="button" className="btn btn--outline btn--block" onClick={handleLogout}>
        <Icon name="logout" size={18} /> {t('account.logout')}
      </button>
    </section>
  );
}
