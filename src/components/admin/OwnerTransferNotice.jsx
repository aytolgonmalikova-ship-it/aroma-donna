import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../common/Icon';

/**
 * Блок ожидающей передачи роли главного администратора (этап A5).
 * direction = 'outgoing' — владелец видит своё предложение (name — кандидат);
 * direction = 'incoming' — кандидат видит предложение ему (name — текущий владелец).
 * uid — полный UID второй стороны. children — кнопки действий (отменить / принять, отклонить);
 * блок сам кнопок не добавляет.
 */
export default function OwnerTransferNotice({ direction, name, uid, children }) {
  const { t } = useTranslation();
  const titleId = useId();
  if (direction !== 'outgoing' && direction !== 'incoming') return null;
  return (
    <section className={`admin-transfer admin-transfer--${direction}`} aria-labelledby={titleId}>
      <Icon name={direction === 'incoming' ? 'shield' : 'clock'} size={20} />
      <div className="admin-transfer__body">
        <h2 id={titleId} className="admin-transfer__title">
          {t(`admin.admins.transfer.${direction}Title`)}
        </h2>
        <p className="admin-transfer__text">{t(`admin.admins.transfer.${direction}Text`, { name: name || '—' })}</p>
        {uid && (
          <p className="admin-transfer__uid">
            {t('admin.admins.uid.label')}: <code>{uid}</code>
          </p>
        )}
        {children && <div className="admin-transfer__actions">{children}</div>}
      </div>
    </section>
  );
}
