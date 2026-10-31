import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import MainNavigation from './MainNavigation';
import SearchBar from '../common/SearchBar';
import LanguageSwitcher from '../common/LanguageSwitcher';
import ThemeToggle from '../common/ThemeToggle';
import Logo from './Logo';
import Icon from '../common/Icon';

/**
 * Мобильное меню (выезжает справа на экранах < 960px).
 * Закрывается по кнопке, по клику на фон, по Escape и при переходе по ссылке.
 * Рендерится через портал прямо в <body>: у шапки есть backdrop-filter,
 * из-за которого position: fixed внутри неё считался бы от шапки, а не от экрана.
 */
export default function MobileMenu({ open, onClose }) {
  const { t } = useTranslation();
  const closeBtnRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    document.body.style.overflow = 'hidden'; // запрет прокрутки страницы под меню
    closeBtnRef.current?.focus();
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  return createPortal(
    <div className={`mobile-menu ${open ? 'is-open' : ''}`} aria-hidden={!open}>
      <div className="mobile-menu__backdrop" onClick={onClose} />
      <aside
        className="mobile-menu__panel"
        role="dialog"
        aria-modal="true"
        aria-label={t('nav.menu')}
        inert={open ? undefined : true}
      >
        <div className="mobile-menu__top">
          <Logo onClick={onClose} />
          <button ref={closeBtnRef} type="button" className="icon-btn" onClick={onClose} aria-label={t('common.close')}>
            <Icon name="close" />
          </button>
        </div>
        <SearchBar id="mobile-search" onDone={onClose} />
        <MainNavigation vertical onNavigate={onClose} />
        <div className="mobile-menu__links">
          <Link to="/favorites" onClick={onClose}>
            <Icon name="heart" size={18} /> {t('nav.favorites')}
          </Link>
          <Link to="/account" onClick={onClose}>
            <Icon name="user" size={18} /> {t('nav.account')}
          </Link>
          <Link to="/faq" onClick={onClose}>
            <Icon name="info" size={18} /> {t('nav.faq')}
          </Link>
          <Link to="/reviews" onClick={onClose}>
            <Icon name="star" size={18} /> {t('nav.reviews')}
          </Link>
        </div>
        <div className="mobile-menu__settings">
          <LanguageSwitcher compact />
          <div className="mobile-menu__theme">
            <span>{t('theme.label')}</span>
            <ThemeToggle />
          </div>
        </div>
      </aside>
    </div>,
    document.body,
  );
}
