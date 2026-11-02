import { Navigate, Route, Routes } from 'react-router-dom';
import AdminRoute from '../../components/admin/AdminRoute';
import { ADMIN_SECTIONS } from '../../components/admin/adminSections';
import AdminLayout from '../../layouts/AdminLayout';
import AdminDashboardPage from './AdminDashboardPage';
import AdminSectionPage from './AdminSectionPage';
import AdminOrdersPage from './AdminOrdersPage';
import AdminOrderPage from './AdminOrderPage';
import AdminCustomersPage from './AdminCustomersPage';
import AdminCustomerPage from './AdminCustomerPage';

// Готовые разделы; остальные пока показывают заглушку AdminSectionPage
const SECTION_PAGES = { orders: AdminOrdersPage, customers: AdminCustomersPage };

/**
 * Админ-панель (/admin/*). Загружается отдельным файлом (React.lazy в App.jsx),
 * поэтому покупатели магазина этот код не скачивают.
 */
export default function AdminApp() {
  return (
    <AdminRoute>
      <Routes>
        <Route element={<AdminLayout />}>
          <Route index element={<AdminDashboardPage />} />
          {ADMIN_SECTIONS.map((s) => {
            const Page = SECTION_PAGES[s.path];
            return <Route key={s.path} path={s.path} element={Page ? <Page /> : <AdminSectionPage section={s} />} />;
          })}
          <Route path="orders/:userId/:orderId" element={<AdminOrderPage />} />
          <Route path="customers/:uid" element={<AdminCustomerPage />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Route>
      </Routes>
    </AdminRoute>
  );
}
