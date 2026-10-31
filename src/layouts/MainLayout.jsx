import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer';
import Notification from '../components/common/Notification';
import FloatingContacts from '../components/layout/FloatingContacts';

/**
 * Общий макет всех страниц: шапка + содержимое страницы (<Outlet />) + подвал.
 * Outlet — место, куда React Router подставляет текущую страницу.
 */
export default function MainLayout() {
  const { pathname } = useLocation();
  const { t } = useTranslation();

  // При переходе на другую страницу — прокрутка наверх
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [pathname]);

  return (
    <div className="app">
      <a href="#main" className="skip-link">
        {t('common.skipToContent')}
      </a>
      <Header />
      <main id="main" className="main" tabIndex={-1}>
        <Outlet />
      </main>
      <Footer />
      <FloatingContacts />
      <Notification />
    </div>
  );
}
