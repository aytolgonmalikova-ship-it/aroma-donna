import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import Icon from '../../components/common/Icon';
import EmptyState from '../../components/common/EmptyState';
import ErrorMessage from '../../components/common/ErrorMessage';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import ProductForm from '../../components/admin/ProductForm';
import DeleteProductDialog from '../../components/admin/DeleteProductDialog';
import { fetchProducts } from '../../features/products/productsSlice';
import { notify } from '../../features/notifications/notificationsSlice';
import {
  createProduct,
  deleteProduct,
  fetchProductForEdit,
  setProductHidden,
  updateProduct,
} from '../../services/adminService';
import { deleteBlockReason, productVisibilityState, visibilityErrorAction } from '../../utils/adminProducts';
import {
  PRODUCT_FORM_FIELD_ORDER,
  emptyProductForm,
  formToProduct,
  getProductFormWarnings,
  productFormFieldId,
  productToForm,
  serverFieldsToFormErrors,
  slugifyProductId,
  validateProductForm,
} from '../../utils/productForm';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useUnsavedChangesPrompt } from '../../hooks/useUnsavedChangesPrompt';

/**
 * Создание (/admin/products/new) и редактирование (/admin/products/:id/edit) товара.
 *
 * - Проверка — validateProductForm (тот же формат, что в firestore.rules); ошибки — у полей,
 *   фокус переходит к первой ошибке.
 * - Создание: createProduct — транзакция, занятый id не перезаписывается (ошибка у поля ID).
 * - Изменение: updateProduct — id и hidden берутся из Firestore; если товар изменили после
 *   открытия формы — conflict: ничего не записывается, предлагается загрузить актуальную версию.
 * - Несохранённые изменения: вопрос перед уходом по ссылке, «Отменой» или закрытием вкладки.
 * - Окончательное удаление (подэтап 5в.4): только скрытого товара, через окно DeleteProductDialog
 *   (JSON-копия + ввод точного ID). deleteProduct получает updatedAt, с которым открыта форма:
 *   если товар изменили или вернули на витрину — conflict / not-hidden, ничего не удаляется.
 *   После удаления — возврат к списку (он загружается заново, счётчики пересчитываются).
 *   Заказы не меняются: в них хранится копия позиции.
 * Видимость (подэтап 5в.5): блок «Видимость на витрине» показывает состояние и переключает его через
 *   setProductHidden с updatedAt, с которым открыта форма (изменён в другом окне — conflict, удалён — not-found).
 *   Меняются только hidden и updatedAt. Пока в форме есть несохранённые изменения, переключение
 *   заблокировано: сначала сохранить или отменить их. После успеха товар перечитывается — у него новая дата,
 *   и следующее сохранение или удаление не получит ложный conflict. То же доступно в списке товаров.
 */
export default function AdminProductFormPage() {
  const { id: routeId } = useParams();
  const isEdit = Boolean(routeId);
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  // Возврат к списку с теми же поиском и фильтрами (их передаёт ссылка из списка)
  const listPath = `/admin/products${location.state?.listSearch ? `?${location.state.listSearch}` : ''}`;

  const [loaded, setLoaded] = useState(isEdit ? null : { product: null, updatedAt: null, damaged: false });
  const [loadError, setLoadError] = useState(null);
  const [form, setForm] = useState(() => emptyProductForm());
  const [initial, setInitial] = useState(() => JSON.stringify(emptyProductForm()));
  const [idTouched, setIdTouched] = useState(isEdit);
  const [errors, setErrors] = useState({});
  const [saveError, setSaveError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [focusTick, setFocusTick] = useState(0);
  const saveErrorRef = useRef(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const [toggling, setToggling] = useState(false);
  const [visibilityError, setVisibilityError] = useState(null);

  const title = isEdit
    ? t('admin.productForm.titleEdit', { name: loaded?.product?.name || routeId })
    : t('admin.productForm.titleNew');
  useDocumentTitle(`${title} — ${t('admin.title')}`);

  const load = useCallback(() => {
    if (!isEdit) return undefined;
    let cancelled = false;
    setLoaded(null);
    setLoadError(null);
    setErrors({});
    setSaveError(null);
    setDeleteOpen(false);
    setDeleteError(null);
    setVisibilityError(null);
    fetchProductForEdit(routeId)
      .then((res) => {
        if (cancelled) return;
        const next = productToForm(res.product);
        setLoaded(res);
        setForm(next);
        setInitial(JSON.stringify(next));
      })
      .catch((err) => !cancelled && setLoadError(err.code || 'failed'));
    return () => {
      cancelled = true;
    };
  }, [isEdit, routeId]);

  useEffect(() => load(), [load]);

  const dirty = JSON.stringify(form) !== initial;
  const leaveMessage = t('admin.productForm.confirmLeave');
  useUnsavedChangesPrompt(dirty && !saving && !deleting, leaveMessage);

  const warnings = useMemo(() => getProductFormWarnings(form, loaded?.product || null), [form, loaded]);

  // После неудачной проверки — фокус на первое поле с ошибкой
  useEffect(() => {
    if (!focusTick) return;
    const first = PRODUCT_FORM_FIELD_ORDER.find((f) => errors[f]);
    if (first) document.getElementById(productFormFieldId(first))?.focus();
  }, [focusTick, errors]);

  // Ошибка сохранения — прокрутка к сообщению
  useEffect(() => {
    if (saveError) saveErrorRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [saveError]);

  const handleChange = (field, value) => {
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      // При создании id предлагается по названию, пока администратор не изменил его сам
      if (!isEdit && field === 'name' && !idTouched) next.id = slugifyProductId(value);
      return next;
    });
    if (field === 'id') setIdTouched(true);
    // Ошибку поля убираем, как только его начали исправлять
    setErrors((prev) => {
      const keys = Object.keys(prev).filter((k) => k === field || k.startsWith(`${field}.`) || (field === 'volumes' && k === 'volumes'));
      if (!keys.length) return prev;
      const next = { ...prev };
      keys.forEach((k) => delete next[k]);
      return next;
    });
  };

  const handleCancel = () => {
    if (dirty && !window.confirm(leaveMessage)) return;
    navigate(listPath);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saving || toggling) return;
    setSaveError(null);
    const found = validateProductForm(form);
    setErrors(found);
    if (Object.keys(found).length) {
      setFocusTick((n) => n + 1);
      return;
    }

    setSaving(true);
    // hidden: при изменении сервис всё равно берёт его из текущего документа Firestore
    const data = formToProduct(form, { hidden: isEdit ? loaded.product.hidden === true : false });
    try {
      if (isEdit) await updateProduct(routeId, data, loaded.updatedAt);
      else await createProduct(data);
      dispatch(
        notify({ message: isEdit ? 'admin.productForm.saved' : 'admin.productForm.created', params: { name: data.name } }),
      );
      dispatch(fetchProducts()); // витрина в этой вкладке сразу видит изменения
      setInitial(JSON.stringify(form)); // изменения сохранены — вопрос об уходе не нужен
      navigate(listPath);
    } catch (err) {
      const code = err.code || 'failed';
      if (code === 'id-taken') {
        setErrors({ id: 'idTaken' });
        setFocusTick((n) => n + 1);
      } else if (code === 'invalid') {
        const fieldErrors = serverFieldsToFormErrors(err.fields);
        setErrors(fieldErrors);
        if (Object.keys(fieldErrors).length) setFocusTick((n) => n + 1);
      }
      setSaveError(code);
      setSaving(false);
    }
  };

  const reloadLatest = () => {
    if (dirty && !window.confirm(t('admin.productForm.reloadConfirm'))) return;
    load();
  };

  const openDelete = () => {
    setDeleteError(null);
    setDeleteOpen(true);
  };

  const closeDelete = useCallback(() => {
    setDeleteOpen(false);
    setDeleteError(null);
  }, []);

  /**
   * После переключения видимости — свежий документ (новая дата updatedAt).
   * Форма не трогается: setProductHidden меняет только hidden. Если остальные поля в Firestore
   * уже другие (товар одновременно изменили в другом окне) или перечитать не удалось (нет сети),
   * остаётся прежняя дата: следующее сохранение получит conflict и предложит загрузить актуальную версию,
   * а не затрёт чужие правки.
   */
  const refreshAfterToggle = async (hidden) => {
    try {
      const fresh = await fetchProductForEdit(routeId);
      if (!fresh.damaged && JSON.stringify(productToForm(fresh.product)) === initial) {
        setLoaded(fresh);
        return;
      }
    } catch {
      // Ниже — состояние без перечитывания
    }
    setLoaded((prev) => ({ ...prev, product: { ...prev.product, hidden } }));
  };

  const handleToggleHidden = async () => {
    const state = productVisibilityState({ product: loaded.product, damaged: loaded.damaged, dirty, busy: false });
    if (toggling || saving || deleting || !state.action || state.blocked) return;
    const hidden = state.action === 'hide';
    const name = loaded.product?.name || routeId;
    setToggling(true);
    setVisibilityError(null);
    try {
      await setProductHidden(routeId, hidden, loaded.updatedAt);
      await refreshAfterToggle(hidden);
      dispatch(notify({ message: hidden ? 'admin.products.hiddenDone' : 'admin.products.shownDone', params: { name } }));
      dispatch(fetchProducts()); // витрина в этой вкладке сразу видит изменение
    } catch (err) {
      setVisibilityError(err.code || 'failed');
    } finally {
      setToggling(false);
    }
  };

  const handleDelete = async () => {
    if (deleting) return;
    setDeleting(true);
    setDeleteError(null);
    const name = loaded.product?.name || routeId;
    try {
      await deleteProduct(routeId, loaded.updatedAt);
      dispatch(notify({ message: 'admin.productDelete.done', params: { name } }));
      dispatch(fetchProducts()); // витрина в этой вкладке сразу без удалённого товара
      setInitial(JSON.stringify(form)); // товара больше нет — вопрос о несохранённых изменениях не нужен
      // replace: «Назад» в браузере не ведёт на форму удалённого товара; список загрузится заново
      navigate(listPath, { replace: true });
    } catch (err) {
      setDeleteError(err.code || 'failed');
      setDeleting(false);
    }
  };

  const back = (
    <Link to={listPath} className="admin-back">
      <Icon name="arrowLeft" size={16} /> {t('admin.productForm.back')}
    </Link>
  );

  if (loadError === 'not-found') {
    return (
      <>
        {back}
        <EmptyState
          icon="search"
          title={t('admin.productForm.notFoundTitle')}
          text={t('admin.productForm.notFoundText', { id: routeId })}
          actionLabel={t('admin.productForm.back')}
          actionTo={listPath}
        />
      </>
    );
  }
  if (loadError) {
    return (
      <>
        {back}
        <ErrorMessage message={t(`admin.products.errors.${loadError}`, t('admin.products.errors.failed'))} onRetry={load} />
      </>
    );
  }
  if (!loaded) return <LoadingSpinner />;

  const errorCount = Object.keys(errors).length;

  // Раздел «Видимость на витрине»: состояние, кнопка «Скрыть» / «Вернуть» и причина, если она недоступна
  const renderVisibilitySection = () => {
    const state = productVisibilityState({
      product: loaded.product,
      damaged: loaded.damaged,
      dirty,
      busy: saving || deleting || toggling,
    });
    // Несохранённые изменения: объясняем, что сначала нужно сохранить или отменить их
    const dirtyBlocked = state.blocked === 'dirty' && !toggling;
    const hint = dirtyBlocked ? t('admin.productVisibility.dirtyHint') : t(`admin.productVisibility.text.${state.status}`);
    const errorAction = visibilityErrorAction(visibilityError);
    return (
      <section className="admin-product-visibility" aria-labelledby="product-visibility-heading">
        <div className="admin-product-visibility__info">
          <h2 id="product-visibility-heading">
            {t('admin.productVisibility.sectionTitle')}{' '}
            <span className={`admin-badge admin-badge--${state.status}`} role="status">
              {t(`admin.productVisibility.status.${state.status}`)}
            </span>
          </h2>
          <p id="product-visibility-hint" className={dirtyBlocked ? 'is-warning' : undefined}>
            {dirtyBlocked && <Icon name="alert" size={16} />} {hint}
          </p>
        </div>
        {state.action && (
          <button
            type="button"
            className={`btn ${state.action === 'show' ? 'btn--primary' : 'btn--outline'} admin-product-visibility__btn`}
            onClick={handleToggleHidden}
            disabled={Boolean(state.blocked) || deleteOpen}
            aria-busy={toggling || undefined}
            aria-describedby="product-visibility-hint"
          >
            <Icon name={state.action === 'hide' ? 'eyeOff' : 'eye'} size={16} />{' '}
            {toggling ? t(`admin.productVisibility.busy.${state.action}`) : t(`admin.productVisibility.action.${state.action}`)}
          </button>
        )}
        {visibilityError && (
          <div className="form__error admin-product-visibility__error" role="alert">
            <p>
              {t(`admin.productVisibility.errors.${visibilityError}`, t('admin.productVisibility.errors.failed'))}
            </p>
            <div className="admin-product-visibility__error-actions">
              {errorAction === 'reload' && (
                <button type="button" className="btn btn--outline btn--sm" onClick={reloadLatest}>
                  <Icon name="refresh" size={16} /> {t('admin.productForm.reload')}
                </button>
              )}
              {errorAction === 'list' && (
                <button
                  type="button"
                  className="btn btn--outline btn--sm"
                  onClick={() => {
                    setInitial(JSON.stringify(form)); // товара нет — вопрос о несохранённых изменениях не нужен
                    navigate(listPath, { replace: true });
                  }}
                >
                  <Icon name="arrowLeft" size={16} /> {t('admin.productForm.back')}
                </button>
              )}
              <button
                type="button"
                className="icon-btn"
                onClick={() => setVisibilityError(null)}
                aria-label={t('admin.products.closeMessage')}
                title={t('admin.products.closeMessage')}
              >
                <Icon name="close" size={16} />
              </button>
            </div>
          </div>
        )}
      </section>
    );
  };

  // Раздел «Удаление товара»: кнопка доступна только для скрытого товара, иначе — объяснение
  const renderDeleteSection = () => {
    const blocked = deleteBlockReason(loaded.product, null);
    return (
      <section className="admin-product-delete" aria-labelledby="product-delete-heading">
        <div>
          <h2 id="product-delete-heading">{t('admin.productDelete.sectionTitle')}</h2>
          <p id="product-delete-hint">
            {blocked ? t('admin.productDelete.blockedNotHidden') : t('admin.productDelete.sectionText')}
          </p>
        </div>
        <button
          type="button"
          className="btn btn--outline admin-product-delete__btn"
          onClick={openDelete}
          disabled={Boolean(blocked) || saving || deleting || toggling}
          aria-describedby="product-delete-hint"
        >
          <Icon name="trash" size={16} /> {t('admin.productDelete.open')}
        </button>
      </section>
    );
  };

  return (
    <>
      {back}
      <div className="admin-page__head">
        <h1>{title}</h1>
        <p>{isEdit ? t('admin.productForm.subtitleEdit', { id: routeId }) : t('admin.productForm.subtitleNew')}</p>
      </div>

      {isEdit && renderVisibilitySection()}
      {isEdit && loaded.damaged && (
        <p className="admin-product-form__notice admin-product-form__notice--warning">
          <Icon name="alert" size={16} /> {t('admin.productForm.damagedNote')}
        </p>
      )}

      {saveError && (
        <div ref={saveErrorRef} className="form__error admin-product-form__save-error" role="alert">
          <p>{t(`admin.productForm.saveErrors.${saveError}`, t('admin.productForm.saveErrors.failed'))}</p>
          {saveError === 'conflict' && (
            <button type="button" className="btn btn--outline btn--sm" onClick={reloadLatest}>
              <Icon name="refresh" size={16} /> {t('admin.productForm.reload')}
            </button>
          )}
          {saveError === 'not-found' && (
            <Link to={listPath} className="btn btn--outline btn--sm">
              {t('admin.productForm.back')}
            </Link>
          )}
        </div>
      )}
      {!saveError && errorCount > 0 && (
        <p className="form__error" role="alert">
          {t('admin.productForm.errorsSummary', { count: errorCount })}
        </p>
      )}

      <ProductForm
        form={form}
        errors={errors}
        warnings={warnings}
        isEdit={isEdit}
        saving={saving}
        onChange={handleChange}
        onSubmit={handleSubmit}
        onCancel={handleCancel}
      />

      {isEdit && renderDeleteSection()}
      {deleteOpen && (
        <DeleteProductDialog
          product={{ id: routeId, name: loaded.product?.name, brand: loaded.product?.brand }}
          raw={loaded.raw}
          dirty={dirty}
          deleting={deleting}
          error={deleteError}
          onConfirm={handleDelete}
          onCancel={closeDelete}
          onReload={reloadLatest}
          onBackToList={() => {
            setInitial(JSON.stringify(form)); // товара нет — вопрос о несохранённых изменениях не нужен
            navigate(listPath, { replace: true });
          }}
        />
      )}
    </>
  );
}
