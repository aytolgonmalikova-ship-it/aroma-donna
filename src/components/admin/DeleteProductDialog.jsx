import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../common/Icon';
import {
  buildProductBackup,
  deleteErrorAction,
  isDeleteConfirmed,
  productBackupFileName,
} from '../../utils/adminProducts';

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
 * Окно подтверждения окончательного удаления товара (подэтап 5в.4).
 *
 * Удалить можно, только когда выполнены оба шага: скачана JSON-копия и введён точный ID товара.
 * Фокус по умолчанию — на «Отмене»; Escape и клик по фону закрывают окно (кроме момента удаления);
 * Tab не выходит за пределы окна. Само удаление выполняет родитель (onConfirm возвращает Promise),
 * ошибку он передаёт в error — код из adminErrors.js.
 *
 * product — { id, name, brand }, raw — документ Firestore как есть (для копии).
 * dirty — в форме есть несохранённые изменения (они пропадут вместе с товаром).
 */
export default function DeleteProductDialog({ product, raw, dirty, deleting, error, onConfirm, onCancel, onReload, onBackToList }) {
  const { t } = useTranslation();
  const [typedId, setTypedId] = useState('');
  const [downloaded, setDownloaded] = useState(false);
  const dialogRef = useRef(null);
  const cancelRef = useRef(null);
  const errorRef = useRef(null);

  const confirmed = isDeleteConfirmed(typedId, product.id);
  const canDelete = downloaded && confirmed && !deleting;
  const errorAction = error ? deleteErrorAction(error) : null;

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

  // Новая ошибка — сообщение на виду и в фокусе: кнопка «Удалить навсегда» была disabled на время
  // удаления, и без этого фокус остался бы вне окна; следующий Tab ведёт к действию из сообщения
  useEffect(() => {
    if (!error || !errorRef.current) return;
    errorRef.current.focus({ preventScroll: true });
    errorRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [error]);

  const handleDownload = () => {
    downloadJson(productBackupFileName(product.id), buildProductBackup(product.id, raw));
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
        aria-labelledby="delete-product-title"
        aria-describedby="delete-product-text"
      >
        <form className="form" onSubmit={handleSubmit} noValidate autoComplete="off">
          <h2 id="delete-product-title" className="admin-delete-dialog__title">
            <Icon name="trash" size={22} /> {t('admin.productDelete.title')}
          </h2>
          <p id="delete-product-text" className="admin-delete-dialog__text">
            {t('admin.productDelete.text')}
          </p>

          <dl className="admin-delete-dialog__product">
            <div>
              <dt>{t('admin.productDelete.name')}</dt>
              <dd>{product.name || '—'}</dd>
            </div>
            <div>
              <dt>{t('admin.productDelete.brand')}</dt>
              <dd>{product.brand || '—'}</dd>
            </div>
            <div>
              <dt>{t('admin.productDelete.id')}</dt>
              <dd>
                <code>{product.id}</code>
              </dd>
            </div>
          </dl>

          <ul className="admin-delete-dialog__facts">
            <li>{t('admin.productDelete.factOrders')}</li>
            <li>{t('admin.productDelete.factCarts')}</li>
            {dirty && <li className="admin-delete-dialog__fact--warning">{t('admin.productDelete.factUnsaved')}</li>}
          </ul>

          <div className="admin-delete-dialog__step">
            <p>
              <strong>1.</strong> {t('admin.productDelete.stepBackup')}
            </p>
            <button type="button" className="btn btn--outline btn--sm" onClick={handleDownload} disabled={deleting}>
              <Icon name={downloaded ? 'check' : 'download'} size={16} />{' '}
              {downloaded ? t('admin.productDelete.downloadAgain') : t('admin.productDelete.download')}
            </button>
            {downloaded && (
              <p className="admin-delete-dialog__ok" role="status">
                {t('admin.productDelete.downloaded', { file: productBackupFileName(product.id) })}
              </p>
            )}
          </div>

          <div className="admin-delete-dialog__step">
            <label htmlFor="delete-product-confirm">
              <strong>2.</strong> {t('admin.productDelete.stepConfirm')} <code>{product.id}</code>
            </label>
            <input
              id="delete-product-confirm"
              className="field__control"
              value={typedId}
              onChange={(e) => setTypedId(e.target.value)}
              disabled={deleting}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={typedId.trim() !== '' && !confirmed ? true : undefined}
              aria-describedby="delete-product-confirm-hint"
            />
            <p id="delete-product-confirm-hint" className="field__hint">
              {typedId.trim() !== '' && !confirmed
                ? t('admin.productDelete.idMismatch')
                : t('admin.productDelete.idHint')}
            </p>
          </div>

          {error && (
            <div ref={errorRef} className="form__error admin-delete-dialog__error" role="alert" tabIndex={-1}>
              <p>{t(`admin.productDelete.errors.${error}`, t('admin.productDelete.errors.failed'))}</p>
              {errorAction === 'reload' && (
                <button type="button" className="btn btn--outline btn--sm" onClick={onReload}>
                  <Icon name="refresh" size={16} /> {t('admin.productForm.reload')}
                </button>
              )}
              {errorAction === 'list' && (
                <button type="button" className="btn btn--outline btn--sm" onClick={onBackToList}>
                  {t('admin.productForm.back')}
                </button>
              )}
            </div>
          )}

          {!canDelete && !deleting && (
            <p className="admin-delete-dialog__pending">
              {!downloaded ? t('admin.productDelete.needBackup') : t('admin.productDelete.needId')}
            </p>
          )}

          <div className="admin-delete-dialog__actions">
            <button ref={cancelRef} type="button" className="btn btn--outline" onClick={onCancel} disabled={deleting}>
              {t('admin.productDelete.cancel')}
            </button>
            <button
              type="submit"
              className="btn admin-delete-dialog__confirm"
              disabled={!canDelete || errorAction === 'reload' || errorAction === 'list'}
              aria-busy={deleting || undefined}
            >
              <Icon name="trash" size={16} />{' '}
              {deleting ? t('admin.productDelete.deleting') : t('admin.productDelete.confirm')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
