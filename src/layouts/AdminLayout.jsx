import { useEffect } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import Icon from '../components/common/Icon';
import Notification from '../components/common/Notification';
import ThemeToggle from '../components/common/ThemeToggle';
import LanguageSwitcher from '../components/common/LanguageSwitcher';
import { ADMIN_SECTIONS } from '../components/admin/adminSections';
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
        <nav className="admin__nav" aria-label={t('admin.navLabel')}>
          <NavLink to="/admin" end className="admin__link">
            <Icon name="sparkle" size={18} /> {t('admin.nav.dashboard')}
          </NavLink>
          {ADMIN_SECTIONS.map((s) => (
            <NavLink key={s.path} to={`/admin/${s.path}`} className="admin__link">
              <Icon name={s.icon} size={18} /> {t(`admin.nav.${s.path}`)}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="admin__body">
        <header className="admin__topbar">
          <span className="admin__user">
            <Icon name="user" size={18} /> {user?.email}
          </span>
          <div className="admin__actions">
            <LanguageSwitcher />
            <ThemeToggle />
            <Link to="/" className="btn btn--ghost btn--sm">
              <Icon name="arrowLeft" size={16} /> {t('admin.backToShop')}
            </Link>
            <button type="button" className="btn btn--outline btn--sm" onClick={handleLogout}>
              <Icon name="logout" size={16} /> {t('account.logout')}
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
