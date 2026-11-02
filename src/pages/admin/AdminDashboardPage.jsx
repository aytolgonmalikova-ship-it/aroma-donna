import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import Icon from '../../components/common/Icon';
import { ADMIN_SECTIONS } from '../../components/admin/adminSections';
import { selectProducts, selectProductsStatus } from '../../features/products/productsSlice';
import { selectUser } from '../../features/user/userSlice';
import { fetchReviewStats } from '../../services/reviewsService';
import { fetchCustomersCount, fetchOrdersCount } from '../../services/adminService';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';

/** Карточка показателя: значение или «скоро» для разделов, которые ещё не подключены */
function StatCard({ icon, label, value, hint }) {
  return (
    <div className="admin-stat card">
      <span className="admin-stat__icon">
        <Icon name={icon} size={20} />
      </span>
      <span className="admin-stat__label">{label}</span>
      <strong className="admin-stat__value">{value}</strong>
      {hint && <small className="admin-stat__hint">{hint}</small>}
    </div>
  );
}

/**
 * Главная страница админ-панели (каркас).
 * Показывает число товаров каталога, статистику отзывов (она публичная),
 * число заказов (правила этапа 3) и зарегистрированных покупателей (правила этапа 4).
 */
export default function AdminDashboardPage() {
  const { t, i18n } = useTranslation();
  const user = useSelector(selectUser);
  const products = useSelector(selectProducts);
  const productsStatus = useSelector(selectProductsStatus);
  const [reviewStats, setReviewStats] = useState(null); // null — загрузка, false — ошибка
  const [ordersCount, setOrdersCount] = useState(null); // null — загрузка, false — ошибка
  const [customersCount, setCustomersCount] = useState(null); // null — загрузка, false — ошибка
  useDocumentTitle(t('admin.dashboard.title'));

  useEffect(() => {
    let cancelled = false;
    fetchReviewStats()
      .then((stats) => !cancelled && setReviewStats(stats))
      .catch(() => !cancelled && setReviewStats(false));
    fetchOrdersCount()
      .then((count) => !cancelled && setOrdersCount(count))
      .catch(() => !cancelled && setOrdersCount(false));
    fetchCustomersCount()
      .then((count) => !cancelled && setCustomersCount(count))
      .catch(() => !cancelled && setCustomersCount(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const reviewsValue =
    reviewStats === null ? '…' : reviewStats === false ? '—' : reviewStats.count;
  const ratingValue =
    reviewStats && reviewStats.average != null
      ? reviewStats.average.toLocaleString(i18n.resolvedLanguage, { maximumFractionDigits: 1 })
      : '—';

  return (
    <>
      <div className="admin-page__head">
        <h1>{t('admin.dashboard.title')}</h1>
        <p>{t('admin.dashboard.greeting', { name: user?.name })}</p>
      </div>

      <div className="admin-stats">
        <StatCard
          icon="drop"
          label={t('admin.dashboard.products')}
          value={productsStatus === 'succeeded' ? products.length : '…'}
          hint={t('admin.dashboard.productsHint')}
        />
        <StatCard icon="star" label={t('admin.dashboard.reviews')} value={reviewsValue} />
        <StatCard icon="sparkle" label={t('admin.dashboard.rating')} value={ratingValue} />
        <StatCard
          icon="cart"
          label={t('admin.dashboard.orders')}
          value={ordersCount === null ? '…' : ordersCount === false ? '—' : ordersCount}
        />
        <StatCard
          icon="user"
          label={t('admin.dashboard.customers')}
          value={customersCount === null ? '…' : customersCount === false ? '—' : customersCount}
          hint={t('admin.dashboard.customersHint')}
        />
      </div>

      <section className="admin-panel card">
        <h2>{t('admin.dashboard.sections')}</h2>
        <ul className="admin-roadmap">
          {ADMIN_SECTIONS.map((s) => (
            <li key={s.path}>
              <Link to={`/admin/${s.path}`}>
                <Icon name={s.icon} size={18} /> {t(`admin.nav.${s.path}`)}
              </Link>
              <span className={`admin-badge${s.ready ? ' admin-badge--ready' : ''}`}>
                {s.ready ? t('admin.ready') : t('admin.stageHint', { stage: s.stage })}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
