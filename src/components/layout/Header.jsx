import { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import Logo from './Logo';
import MainNavigation from './MainNavigation';
import MobileMenu from './MobileMenu';
import SearchBar from '../common/SearchBar';
import ThemeToggle from '../common/ThemeToggle';
import LanguageSwitcher from '../common/LanguageSwitcher';
import Icon from '../common/Icon';
import { selectCartCount } from '../../features/cart/cartSlice';
import { selectFavoriteCount } from '../../features/favorites/favoritesSlice';
import { selectUser } from '../../features/user/userSlice';

/** Шапка сайта: логотип, меню, поиск, язык, тема, избранное, кабинет, корзина */
export default function Header() {
  const { t } = useTranslation();
  const cartCount = useSelector(selectCartCount);
  const favoritesCount = useSelector(selectFavoriteCount);
  const user = useSelector(selectUser);
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const location = useLocation();

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  // Тень у шапки после прокрутки
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Закрываем мобильное меню при смене страницы
  useEffect(() => {
    closeMenu();
  }, [location.pathname, closeMenu]);

  return (
    <header className={`header ${scrolled ? 'header--scrolled' : ''}`}>
      {/* Части сообщения разделены « · » в переводе: на телефоне — по строке на часть, без обрезки */}
      <div className="header__promo">
        {t('header.promo')
          .split(' · ')
          .map((part, i) => (
            <span key={part} className="header__promo-part">
              {i > 0 && (
                <span className="header__promo-sep" aria-hidden="true">
                  {' · '}
                </span>
              )}
              {part}
            </span>
          ))}
      </div>
      <div className="container header__inner">
        <button
          type="button"
          className="icon-btn header__burger"
          onClick={() => setMenuOpen(true)}
          aria-label={t('nav.openMenu')}
          aria-expanded={menuOpen}
        >
          <Icon name="menu" />
        </button>

        <Logo />
        <MainNavigation />

        <div className="header__actions">
          <div className="header__search">
            <SearchBar />
          </div>
          <div className="header__desktop-only">
            <LanguageSwitcher />
          </div>
          <div className="header__desktop-only">
            <ThemeToggle />
          </div>
          <NavLink to="/favorites" className="icon-btn header__icon-link header__desktop-only" aria-label={`${t('nav.favorites')}: ${favoritesCount}`}>
            <Icon name="heart" />
            {favoritesCount > 0 && <span className="badge">{favoritesCount}</span>}
          </NavLink>
          <NavLink
            to={user ? '/account' : '/login'}
            className="icon-btn header__icon-link header__desktop-only"
            aria-label={user ? t('nav.account') : t('nav.login')}
            title={user ? user.name : t('nav.login')}
          >
            <Icon name="user" />
            {user && <span className="badge badge--dot" aria-hidden="true" />}
          </NavLink>
          <Link to="/cart" className="icon-btn header__icon-link header__cart" aria-label={`${t('nav.cart')}: ${cartCount}`}>
            <Icon name="cart" />
            {cartCount > 0 && <span className="badge" key={cartCount}>{cartCount}</span>}
          </Link>
        </div>
      </div>
      <MobileMenu open={menuOpen} onClose={closeMenu} />
    </header>
  );
}
