import Icon from './Icon';

/**
 * Плашка «Демонстрационный режим».
 * Честно сообщает пользователю, что функция работает без реального сервера.
 */
export default function DemoNotice({ children, variant = 'info' }) {
  return (
    <div className={`demo-notice demo-notice--${variant}`} role="note">
      <Icon name="info" size={18} />
      <div>{children}</div>
    </div>
  );
}
