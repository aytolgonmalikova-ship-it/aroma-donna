import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

/** Пункты главного меню. Используются и в шапке, и в мобильном меню */
export const NAV_ITEMS = [
  { to: '/catalog', key: 'nav.catalog' },
  { to: '/quiz', key: 'nav.quiz' },
  { to: '/about', key: 'nav.about' },
  { to: '/delivery', key: 'nav.delivery' },
  { to: '/contacts', key: 'nav.contacts' },
];

export default function MainNavigation({ vertical = false, onNavigate }) {
  const { t } = useTranslation();
  return (
    <nav className={`main-nav ${vertical ? 'main-nav--vertical' : ''}`} aria-label={t('nav.main')}>
      <ul>
        {NAV_ITEMS.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              className={({ isActive }) => `main-nav__link ${isActive ? 'is-active' : ''}`}
              onClick={onNavigate}
            >
              {t(item.key)}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
