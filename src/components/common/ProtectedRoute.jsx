import { Navigate, useLocation } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { selectAuthState } from '../../features/user/userSlice';
import LoadingSpinner from './LoadingSpinner';

/**
 * Защищённый маршрут: личный кабинет доступен только после входа.
 * Это удобство интерфейса. Настоящая защита данных — в правилах Firestore (firestore.rules).
 */
export default function ProtectedRoute({ children }) {
  const { current, initialized } = useSelector(selectAuthState);
  const location = useLocation();
  if (!initialized) return <LoadingSpinner />;
  if (!current) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}
