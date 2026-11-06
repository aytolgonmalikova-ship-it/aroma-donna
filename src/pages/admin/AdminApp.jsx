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
import AdminProductsPage from './AdminProductsPage';
import AdminProductFormPage from './AdminProductFormPage';
import AdminReviewsPage from './AdminReviewsPage';
import AdminAdminsPage from './AdminAdminsPage';
import OwnerSectionRoute from '../../components/admin/OwnerSectionRoute';
import { OwnerAccessProvider, useOwnerAccess } from '../../hooks/useOwnerAccess';
import { useSelector } from 'react-redux';
import { selectUser } from '../../features/user/userSlice';

// Готовые разделы; остальные пока показывают заглушку AdminSectionPage
const SECTION_PAGES = {
  orders: AdminOrdersPage,
  customers: AdminCustomersPage,
  products: AdminProductsPage,
  reviews: AdminReviewsPage,
  admins: AdminAdminsSection,
};

/**
 * Раздел «Администраторы» (Блок 2): страница — только владельцу и кандидату (OwnerSectionRoute);
 * после принятия или отклонения роли меню и доступ обновляются (refresh).
 */
function AdminAdminsSection() {
  const { refresh } = useOwnerAccess();
  return (
    <OwnerSectionRoute>
      <AdminAdminsPage onRolesChanged={refresh} />
    </OwnerSectionRoute>
  );
}

/**
 * Админ-панель (/admin/*). Загружается отдельным файлом (React.lazy в App.jsx),
 * поэтому покупатели магазина этот код не скачивают.
 */
export default function AdminApp() {
  return (
    <AdminRoute>
      <AdminRoleScope>
        <Routes>
          <Route element={<AdminLayout />}>
            <Route index element={<AdminDashboardPage />} />
            {ADMIN_SECTIONS.map((s) => {
              const Page = SECTION_PAGES[s.path];
              return <Route key={s.path} path={s.path} element={Page ? <Page /> : <AdminSectionPage section={s} />} />;
            })}
            <Route path="orders/guest/:guestKey/:orderId" element={<AdminOrderPage />} />
            <Route path="orders/:userId/:orderId" element={<AdminOrderPage />} />
            <Route path="customers/:uid" element={<AdminCustomerPage />} />
            {/* key: создание и изменение — разные экземпляры формы, состояние не переносится */}
            <Route path="products/new" element={<AdminProductFormPage key="new" />} />
            <Route path="products/:id/edit" element={<AdminProductFormPage key="edit" />} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Route>
        </Routes>
      </AdminRoleScope>
    </AdminRoute>
  );
}

/** Роль в управлении администраторами — один запрос на всю панель (только после проверки AdminRoute) */
function AdminRoleScope({ children }) {
  const uid = useSelector(selectUser)?.uid;
  return <OwnerAccessProvider uid={uid}>{children}</OwnerAccessProvider>;
}
