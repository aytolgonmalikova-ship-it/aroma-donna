import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../common/Icon';
import { adminErrorKey, isRetryableAdminError } from '../../utils/adminAdmins';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

// Тексты окна для каждого действия (ключи admin.admins.*); facts — пункты «что произойдёт»
const KINDS = {
  revoke: {
    title: 'revoke.title',
    text: 'revoke.text',
    facts: ['revoke.factAccount', 'revoke.factRestore'],
    check: 'revoke.confirmCheck',
    confirm: 'revoke.confirm',
    busy: 'revoke.confirming',
    icon: 'trash',
    danger: true,
  },
  offer: {
    title: 'transfer.offerTitle',
    text: 'transfer.offerText',
    facts: ['transfer.factAfter', 'transfer.factCancel', 'transfer.factOne'],
    check: 'transfer.offerConfirmCheck',
    confirm: 'transfer.offerConfirm',
    busy: 'transfer.offering',
    icon: 'shield',
    danger: false,
  },
  accept: {
    title: 'transfer.acceptTitle',
    text: 'transfer.acceptText',
    facts: ['transfer.factAcceptPrevious', 'transfer.factAcceptLater'],
    check: 'transfer.acceptConfirmCheck',
    confirm: 'transfer.acceptConfirm',
    busy: 'transfer.accepting',
    icon: 'shield',
    danger: false,
  },
};

export const ADMIN_CONFIRM_KINDS = Object.keys(KINDS);

/**
 * Окно подтверждения действий с доступом (этап A5): отзыв доступа (revoke), предложение роли
 * главного администратора (offer) и её принятие (accept).
 *
 * Подтвердить можно только после флажка «я понимаю». Фокус по умолчанию — на «Отмене»;
 * Escape и клик по фону закрывают окно (кроме момента выполнения); Tab не выходит за пределы окна;
 * ошибка получает фокус. После ошибок, которые повторять бессмысленно (например, offer-stale),
 * кнопка подтверждения блокируется — нужно закрыть окно и обновить данные.
 * Само действие выполняет родитель: onConfirm, ошибку он передаёт в error (код из adminErrors.js).
 *
 * name — подпись или короткий UID второй стороны (для текста), uid — полный UID.
 */
export default function AdminConfirmDialog({ kind, name, uid, busy = false, error = null, onConfirm, onCancel }) {
  const { t } = useTranslation();
  const [understood, setUnderstood] = useState(false);
  const dialogRef = useRef(null);
  const cancelRef = useRef(null);
  const errorRef = useRef(null);
  const spec = KINDS[kind];

  const blockedByError = Boolean(error) && !isRetryableAdminError(error);
  const canConfirm = understood && !busy && !blockedByError;

  // Фокус на «Отмену», блокировка прокрутки страницы; после закрытия фокус возвращается туда, откуда открыли
  useEffect(() => {
    const opener = document.activeElement;
    cancelRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  // Escape закрывает окно, Tab переходит по кругу внутри окна
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (!busy) onCancel();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const items = [...dialogRef.current.querySelectorAll(FOCUSABLE)];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const outside = !dialogRef.current.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === first || outside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || outside)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  // Новая ошибка — сообщение на виду и в фокусе
  useEffect(() => {
    if (!error || !errorRef.current) return;
    errorRef.current.focus({ preventScroll: true });
    errorRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [error]);

  if (!spec) return null;
  const k = (key) => `admin.admins.${key}`;
  const who = name || '—';

  const handleSubmit = (e) => {
    e.preventDefault();
    if (canConfirm) onConfirm();
  };

  return (
    <div className="payment-modal-overlay admin-delete-dialog__overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div
        ref={dialogRef}
        className={`payment-modal admin-delete-dialog admin-confirm-dialog admin-confirm-dialog--${kind}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="admin-confirm-title"
        aria-describedby="admin-confirm-text"
      >
        <form className="form" onSubmit={handleSubmit} noValidate autoComplete="off">
          <h2 id="admin-confirm-title" className="admin-delete-dialog__title admin-confirm-dialog__title">
            <Icon name={spec.icon} size={22} /> {t(k(spec.title))}
          </h2>
          <p id="admin-confirm-text" className="admin-delete-dialog__text">
            {t(k(spec.text), { name: who })}
          </p>

          {uid && (
            <dl className="admin-delete-dialog__product">
              <div>
                <dt>{t(k('uid.label'))}</dt>
                <dd>
                  <code className="admin-member__uid">{uid}</code>
                </dd>
              </div>
            </dl>
          )}

          <ul className="admin-delete-dialog__facts">
            {spec.facts.map((fact) => (
              <li key={fact}>{t(k(fact))}</li>
            ))}
          </ul>

          <label className="admin-review-delete__check">
            <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} disabled={busy} />
            <span>{t(k(spec.check), { name: who })}</span>
          </label>

          {error && (
            <div ref={errorRef} className="form__error admin-delete-dialog__error" role="alert" tabIndex={-1}>
              <p>{t(adminErrorKey(error))}</p>
            </div>
          )}

          <div className="admin-delete-dialog__actions">
            <button ref={cancelRef} type="button" className="btn btn--outline" onClick={onCancel} disabled={busy}>
              {t(k('dialog.cancel'))}
            </button>
            <button
              type="submit"
              className={`btn ${spec.danger ? 'admin-delete-dialog__confirm' : 'btn--primary'}`}
              disabled={!canConfirm}
              aria-busy={busy || undefined}
            >
              <Icon name={spec.icon} size={16} /> {busy ? t(k(spec.busy)) : t(k(spec.confirm))}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
