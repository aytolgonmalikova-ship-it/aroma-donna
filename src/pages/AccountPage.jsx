import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import PageHeader from '../components/common/PageHeader';
import UserProfile from '../components/account/UserProfile';
import OrderHistory from '../components/account/OrderHistory';
import LoadingSpinner from '../components/common/LoadingSpinner';
import ErrorMessage from '../components/common/ErrorMessage';
import DemoNotice from '../components/common/DemoNotice';
import { selectAuthState } from '../features/user/userSlice';
import { getOrders } from '../services/orderService';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

/** Личный кабинет (доступен только после входа — см. ProtectedRoute в App.jsx) */
export default function AccountPage() {
  const { t } = useTranslation();
  const { current: user, mode } = useSelector(selectAuthState);
  const [orders, setOrders] = useState([]);
  const [state, setState] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [reloadKey, setReloadKey] = useState(0);
  useDocumentTitle(t('account.title'));

  // Загружаем заказы при открытии страницы (useEffect + async-функция)
  useEffect(() => {
    let cancelled = false;
    setState('loading');
    getOrders(user)
      .then((list) => {
        if (!cancelled) {
          setOrders(list);
          setState('ready');
        }
      })
      .catch(() => !cancelled && setState('error'));
    return () => {
      cancelled = true; // компонент закрыт — результат больше не нужен
    };
  }, [user, reloadKey]);

  return (
    <>
      <PageHeader
        title={t('account.title')}
        subtitle={t('account.greeting', { name: user.name })}
        crumbs={[{ label: t('account.title') }]}
      />
      <div className="container section--tight account-layout">
        <UserProfile user={user} mode={mode} ordersCount={orders.length} />
        <section aria-labelledby="orders-title">
          <h2 id="orders-title" className="section__title section__title--sm">
            {t('account.orders')}
          </h2>
          {mode === 'demo' && <DemoNotice>{t('account.demoOrdersNote')}</DemoNotice>}
          {state === 'loading' && <LoadingSpinner />}
          {state === 'error' && <ErrorMessage message={t('account.ordersError')} onRetry={() => setReloadKey((k) => k + 1)} />}
          {state === 'ready' && <OrderHistory orders={orders} />}
        </section>
      </div>
    </>
  );
}
