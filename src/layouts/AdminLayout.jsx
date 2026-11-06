import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import Icon from '../components/common/Icon';
import Notification from '../components/common/Notification';
import ThemeToggle from '../components/common/ThemeToggle';
import LanguageSwitcher from '../components/common/LanguageSwitcher';
import { ADMIN_SECTIONS, isSectionVisible } from '../components/admin/adminSections';
import { useOwnerAccess } from '../hooks/useOwnerAccess';
import { logoutUser, selectUser } from '../features/user/userSlice';
import '../styles/admin.css';

/**
 * Макет админ-панели: боковое меню + верхняя панель + содержимое раздела (<Outlet />).
 * Отдельно от MainLayout: шапка, подвал и плавающие кнопки магазина здесь не нужны.
 */
export default function AdminLayout() {
  const { t } = useTranslation();
  const user = useSelector(selectUser);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // Раздел «Администраторы» — в меню только у главного администратора (роль — из useOwnerAccess)
  const { access } = useOwnerAccess();
  // Лента меню на телефоне прокручивается вбок: затухание у края, за которым есть ещё пункты (C3.2)
  const navRef = useRef(null);
  const [navMore, setNavMore] = useState({ left: false, right: false });

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return undefined;
    const update = () => {
      const max = nav.scrollWidth - nav.clientWidth;
      const left = nav.scrollLeft > 2;
      const right = max > 2 && nav.scrollLeft < max - 2;
      setNavMore((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
    };
    update();
    nav.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      nav.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [access]);

  // Активный пункт — в видимой части ленты (например, «Администраторы» в конце)
  useEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector('.admin__link.active');
    if (!nav || !active || nav.scrollWidth <= nav.clientWidth) return;
    const start = active.offsetLeft - nav.offsetLeft;
    if (start < nav.scrollLeft || start + active.offsetWidth > nav.scrollLeft + nav.clientWidth) {
      nav.scrollLeft = Math.max(0, start - 16);
    }
  }, [pathname, access]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [pathname]);

  // Админ-панель не должна попадать в поисковые системы
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);

  const handleLogout = async () => {
    await dispatch(logoutUser());
    navigate('/', { replace: true });
  };

  return (
    <div className="admin">
      <a href="#admin-main" className="skip-link">
        {t('common.skipToContent')}
      </a>
      <aside className="admin__sidebar">
        <Link to="/admin" className="admin__brand">
          AROMA <em>DONNA</em>
          <span>{t('admin.badge')}</span>
        </Link>
        <nav
          ref={navRef}
          className="admin__nav"
          aria-label={t('admin.navLabel')}
          data-more-left={navMore.left || undefined}
          data-more-right={navMore.right || undefined}
        >
          <NavLink to="/admin" end className="admin__link">
            <Icon name="sparkle" size={18} /> {t('admin.nav.dashboard')}
          </NavLink>
          {ADMIN_SECTIONS.filter((s) => isSectionVisible(s, access)).map((s) => (
            <NavLink key={s.path} to={`/admin/${s.path}`} className="admin__link">
              <Icon name={s.icon} size={18} /> {t(`admin.nav.${s.path}`)}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="admin__body">
        <header className="admin__topbar">
          <span className="admin__user" title={user?.email || undefined}>
            <Icon name="user" size={18} /> <span className="admin__user-email">{user?.email}</span>
          </span>
          <div className="admin__actions">
            <LanguageSwitcher />
            <ThemeToggle />
            {/* На телефоне — значки; текст остаётся для экранного диктора (.admin__action-text) */}
            <Link to="/" className="btn btn--ghost btn--sm admin__action" title={t('admin.backToShop')}>
              <Icon name="arrowLeft" size={16} /> <span className="admin__action-text">{t('admin.backToShop')}</span>
            </Link>
            <button type="button" className="btn btn--outline btn--sm admin__action" onClick={handleLogout} title={t('account.logout')}>
              <Icon name="logout" size={16} /> <span className="admin__action-text">{t('account.logout')}</span>
            </button>
          </div>
        </header>
        <main id="admin-main" className="admin__main" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
      <Notification />
    </div>
  );
}
