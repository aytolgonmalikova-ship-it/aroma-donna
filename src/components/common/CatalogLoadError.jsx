import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import ErrorMessage from './ErrorMessage';
import { fetchProducts } from '../../features/products/productsSlice';

/** Каталог не загрузился (Firestore недоступен, нет прав): сообщение и кнопка «Повторить» */
export default function CatalogLoadError() {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  return <ErrorMessage message={t('catalog.loadError')} onRetry={() => dispatch(fetchProducts())} />;
}
