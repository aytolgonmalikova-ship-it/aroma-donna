import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import Icon from '../../components/common/Icon';
import EmptyState from '../../components/common/EmptyState';
import ErrorMessage from '../../components/common/ErrorMessage';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import ProductForm from '../../components/admin/ProductForm';
import { fetchProducts } from '../../features/products/productsSlice';
import { notify } from '../../features/notifications/notificationsSlice';
import { createProduct, fetchProductForEdit, updateProduct } from '../../services/adminService';
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
 * Скрытие и удаление товаров — этап 5в.
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
  useUnsavedChangesPrompt(dirty && !saving, leaveMessage);

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
    if (saving) return;
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

  return (
    <>
      {back}
      <div className="admin-page__head">
        <h1>{title}</h1>
        <p>{isEdit ? t('admin.productForm.subtitleEdit', { id: routeId }) : t('admin.productForm.subtitleNew')}</p>
      </div>

      {isEdit && loaded.product?.hidden && (
        <p className="admin-product-form__notice">
          <Icon name="info" size={16} /> {t('admin.productForm.hiddenNote')}
        </p>
      )}
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
    </>
  );
}
