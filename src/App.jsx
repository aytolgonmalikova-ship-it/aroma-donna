import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import MainLayout from './layouts/MainLayout';
import ProtectedRoute from './components/common/ProtectedRoute';
import LoadingSpinner from './components/common/LoadingSpinner';
import HomePage from './pages/HomePage';
import CatalogPage from './pages/CatalogPage';
import ProductPage from './pages/ProductPage';
import CartPage from './pages/CartPage';
import FavoritesPage from './pages/FavoritesPage';
import AuthPage from './pages/AuthPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import AccountPage from './pages/AccountPage';
import CheckoutPage from './pages/CheckoutPage';
import OrderSuccessPage from './pages/OrderSuccessPage';
import QuizPage from './pages/QuizPage';
import AboutPage from './pages/AboutPage';
import ContactsPage from './pages/ContactsPage';
import DeliveryPage from './pages/DeliveryPage';
import FAQPage from './pages/FAQPage';
import ReviewsPage from './pages/ReviewsPage';
import NotFoundPage from './pages/NotFoundPage';
import { fetchProducts } from './features/products/productsSlice';
import { setUser } from './features/user/userSlice';
import { subscribeToAuth } from './services/authService';

// Админ-панель — отдельный файл, загружается только при открытии /admin
const AdminApp = lazy(() => import('./pages/admin/AdminApp'));

/**
 * App — корневой компонент приложения.
 * 1) При запуске загружает товары и проверяет, вошёл ли пользователь.
 * 2) Описывает все маршруты (страницы) сайта.
 */
export default function App() {
  const dispatch = useDispatch();

  useEffect(() => {
    dispatch(fetchProducts());
    // Подписка на пользователя (Firebase или демо-режим). Отписка — при закрытии приложения
    const unsubscribe = subscribeToAuth((user) => dispatch(setUser(user)));
    return unsubscribe;
  }, [dispatch]);

  return (
    <Routes>
      <Route element={<MainLayout />}>
        <Route index element={<HomePage />} />
        <Route path="catalog" element={<CatalogPage />} />
        <Route path="product/:id" element={<ProductPage />} />
        <Route path="cart" element={<CartPage />} />
        <Route path="favorites" element={<FavoritesPage />} />
        <Route path="login" element={<AuthPage mode="login" />} />
        <Route path="register" element={<AuthPage mode="register" />} />
        <Route path="forgot-password" element={<ForgotPasswordPage />} />
        <Route
          path="account"
          element={
            <ProtectedRoute>
              <AccountPage />
            </ProtectedRoute>
          }
        />
        <Route path="checkout" element={<CheckoutPage />} />
        <Route path="order-success/:orderId" element={<OrderSuccessPage />} />
        <Route path="quiz" element={<QuizPage />} />
        <Route path="about" element={<AboutPage />} />
        <Route path="contacts" element={<ContactsPage />} />
        <Route path="delivery" element={<DeliveryPage />} />
        <Route path="faq" element={<FAQPage />} />
        <Route path="reviews" element={<ReviewsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
      <Route
        path="admin/*"
        element={
          <Suspense fallback={<LoadingSpinner />}>
            <AdminApp />
          </Suspense>
        }
      />
    </Routes>
  );
}
