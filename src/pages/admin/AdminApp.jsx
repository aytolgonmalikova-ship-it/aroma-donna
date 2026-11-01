import { Navigate, Route, Routes } from 'react-router-dom';
import AdminRoute from '../../components/admin/AdminRoute';
import { ADMIN_SECTIONS } from '../../components/admin/adminSections';
import AdminLayout from '../../layouts/AdminLayout';
import AdminDashboardPage from './AdminDashboardPage';
import AdminSectionPage from './AdminSectionPage';

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
          {ADMIN_SECTIONS.map((s) => (
            <Route key={s.path} path={s.path} element={<AdminSectionPage section={s} />} />
          ))}
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Route>
      </Routes>
    </AdminRoute>
  );
}
