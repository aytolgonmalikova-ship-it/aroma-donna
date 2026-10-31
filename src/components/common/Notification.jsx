import { useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { dismiss, selectNotifications } from '../../features/notifications/notificationsSlice';
import { formatPrice } from '../../utils/format';
import Icon from './Icon';

const ICONS = { success: 'check', error: 'alert', info: 'info' };
const LIFETIME = 3500;

/** Одно уведомление: закрывается само через 3,5 секунды или по кнопке */
function NotificationItem({ item }) {
  const dispatch = useDispatch();
  const { t } = useTranslation();
  const timerRef = useRef(null);

  useEffect(() => {
    timerRef.current = setTimeout(() => dispatch(dismiss(item.id)), LIFETIME);
    return () => clearTimeout(timerRef.current);
  }, [dispatch, item.id]);

  // Цены в параметрах форматируем перед подстановкой в перевод
  const params = { ...item.params };
  if (params.min !== undefined) params.min = formatPrice(params.min);
  if (params.amount !== undefined) params.amount = formatPrice(params.amount);

  return (
    <div className={`toast toast--${item.type}`} role={item.type === 'error' ? 'alert' : 'status'}>
      <span className="toast__icon">
        <Icon name={ICONS[item.type] || 'info'} size={18} />
      </span>
      <p className="toast__text">{t(item.message, params)}</p>
      <button
        type="button"
        className="toast__close"
        onClick={() => dispatch(dismiss(item.id))}
        aria-label={t('common.close')}
      >
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}

/** Контейнер всех уведомлений (правый нижний угол) */
export default function Notification() {
  const list = useSelector(selectNotifications);
  return (
    <div className="toasts" aria-live="polite">
      {list.map((item) => (
        <NotificationItem key={item.id} item={item} />
      ))}
    </div>
  );
}
