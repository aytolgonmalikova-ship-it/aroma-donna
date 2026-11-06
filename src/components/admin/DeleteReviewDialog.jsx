import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../common/Icon';
import RatingStars from '../common/RatingStars';
import { buildReviewBackup, reviewBackupFileName, shouldReloadAfterError } from '../../utils/adminReviews';
import { formatDate } from '../../utils/format';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/** Скачать JSON-файл в браузере (без сервера) */
function downloadJson(fileName, data) {
  const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Окно подтверждения окончательного удаления отклонённого отзыва (этап E4).
 *
 * Удалить можно, только когда выполнены оба шага: скачана JSON-копия и отмечен флажок
 * «понимаю, что восстановить нельзя». Фокус по умолчанию — на «Отмене»; Escape и клик по фону
 * закрывают окно (кроме момента удаления); Tab не выходит за пределы окна.
 * Само удаление выполняет родитель (onConfirm возвращает Promise), ошибку он передаёт в error —
 * код из adminErrors.js. После not-rejected и not-found повторять удаление бессмысленно — кнопка заблокирована.
 *
 * review — отзыв в формате toAdminReview (adminReviewsStore.js). Текст выводится как обычный текст.
 */
export default function DeleteReviewDialog({ review, deleting, error, onConfirm, onCancel }) {
  const { t, i18n } = useTranslation();
  const [downloaded, setDownloaded] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const dialogRef = useRef(null);
  const cancelRef = useRef(null);
  const errorRef = useRef(null);

  const blockedByError = Boolean(error) && shouldReloadAfterError(error);
  const canDelete = downloaded && understood && !deleting && !blockedByError;

  // Фокус на «Отмену», блокировка прокрутки страницы; после закрытия фокус возвращается на кнопку «Удалить»
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
        if (!deleting) onCancel();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const items = [...dialogRef.current.querySelectorAll(FOCUSABLE)];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      // Фокус вне окна (например, нажатая кнопка стала disabled на время удаления) — возвращаем внутрь
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
  }, [deleting, onCancel]);

  // Новая ошибка — сообщение на виду и в фокусе (кнопка удаления была disabled, фокус остался бы вне окна)
  useEffect(() => {
    if (!error || !errorRef.current) return;
    errorRef.current.focus({ preventScroll: true });
    errorRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [error]);

  const handleDownload = () => {
    downloadJson(reviewBackupFileName(review.id), buildReviewBackup(review));
    setDownloaded(true);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (canDelete) onConfirm();
  };

  return (
    <div
      className="payment-modal-overlay admin-delete-dialog__overlay"
      onMouseDown={(e) => e.target === e.currentTarget && !deleting && onCancel()}
    >
      <div
        ref={dialogRef}
        className="payment-modal admin-delete-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-review-title"
        aria-describedby="delete-review-text"
      >
        <form className="form" onSubmit={handleSubmit} noValidate autoComplete="off">
          <h2 id="delete-review-title" className="admin-delete-dialog__title">
            <Icon name="trash" size={22} /> {t('admin.reviews.delete.title')}
          </h2>
          <p id="delete-review-text" className="admin-delete-dialog__text">
            {t('admin.reviews.delete.text')}
          </p>

          <dl className="admin-delete-dialog__product">
            <div>
              <dt>{t('admin.reviews.delete.author')}</dt>
              <dd>{review.name || '—'}</dd>
            </div>
            <div>
              <dt>{t('admin.reviews.delete.rating')}</dt>
              <dd>
                {/* Подпись для экранного диктора («Рейтинг 5 из 5») — внутри RatingStars */}
                <RatingStars value={review.rating} showValue={false} />
              </dd>
            </div>
            <div>
              <dt>{t('admin.reviews.delete.created')}</dt>
              <dd>{review.createdAt ? formatDate(review.createdAt, i18n.resolvedLanguage) : t('admin.reviews.noDate')}</dd>
            </div>
            <div>
              <dt>ID</dt>
              <dd>
                <code>{review.id}</code>
              </dd>
            </div>
          </dl>
          <p className="admin-review-delete__text">{review.text}</p>

          <ul className="admin-delete-dialog__facts">
            <li>{t('admin.reviews.delete.factPublic')}</li>
          </ul>

          <div className="admin-delete-dialog__step">
            <p>
              <strong>1.</strong> {t('admin.reviews.delete.stepBackup')}
            </p>
            <button type="button" className="btn btn--outline btn--sm" onClick={handleDownload} disabled={deleting}>
              <Icon name={downloaded ? 'check' : 'download'} size={16} />{' '}
              {downloaded ? t('admin.reviews.delete.downloadAgain') : t('admin.reviews.delete.download')}
            </button>
            {downloaded && (
              <p className="admin-delete-dialog__ok" role="status">
                {t('admin.reviews.delete.downloaded', { file: reviewBackupFileName(review.id) })}
              </p>
            )}
          </div>

          <div className="admin-delete-dialog__step">
            <label className="admin-review-delete__check">
              <input
                type="checkbox"
                checked={understood}
                onChange={(e) => setUnderstood(e.target.checked)}
                disabled={deleting}
              />
              <span>
                <strong>2.</strong> {t('admin.reviews.delete.confirmCheck')}
              </span>
            </label>
          </div>

          {error && (
            <div ref={errorRef} className="form__error admin-delete-dialog__error" role="alert" tabIndex={-1}>
              <p>{t(`admin.reviews.delete.errors.${error}`, t('admin.reviews.delete.errors.failed'))}</p>
            </div>
          )}

          {!canDelete && !deleting && !blockedByError && (
            <p className="admin-delete-dialog__pending">
              {!downloaded ? t('admin.reviews.delete.needBackup') : t('admin.reviews.delete.needCheck')}
            </p>
          )}

          <div className="admin-delete-dialog__actions">
            <button ref={cancelRef} type="button" className="btn btn--outline" onClick={onCancel} disabled={deleting}>
              {t('admin.reviews.delete.cancel')}
            </button>
            <button
              type="submit"
              className="btn admin-delete-dialog__confirm"
              disabled={!canDelete}
              aria-busy={deleting || undefined}
            >
              <Icon name="trash" size={16} />{' '}
              {deleting ? t('admin.reviews.delete.deleting') : t('admin.reviews.delete.confirm')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
