import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../common/Icon';
import ProductImage from '../common/ProductImage';
import { CATEGORIES, CONCENTRATIONS, FAMILIES, INTENSITIES } from '../../data/products';
import { AVAILABILITIES, LANGS, LIMITS, NOTE_LEVELS } from '../../utils/products';
import { FORM_VOLUMES, NOTE_KEYS, defaultImagePath, productFormErrorMessage, productFormFieldId } from '../../utils/productForm';

const LANG_NAMES = { ru: 'Русский', ky: 'Кыргызча', en: 'English' };

/**
 * Форма товара (создание и редактирование). Только отображение: значения, ошибки и предупреждения
 * приходят из AdminProductFormPage, изменения уходят через onChange(field, value).
 * Поля hidden в форме нет: видимость переключается отдельным блоком страницы, при сохранении hidden берётся из Firestore.
 */
export default function ProductForm({ form, errors, warnings, isEdit, saving, onChange, onSubmit, onCancel }) {
  const { t } = useTranslation();

  // Ноты по алфавиту на текущем языке
  const notes = useMemo(
    () => [...NOTE_KEYS].sort((a, b) => t(`notes.items.${a}`).localeCompare(t(`notes.items.${b}`))),
    [t],
  );

  const errorText = (field) => {
    if (!errors[field]) return null;
    const { key, params } = productFormErrorMessage(field, errors[field]);
    return t(`admin.productForm.errors.${key}`, params);
  };

  /** Поле с подписью, подсказкой и ошибкой; control — функция, получающая aria-атрибуты */
  const field = (name, label, control, { hint, required, className = '' } = {}) => {
    const id = productFormFieldId(name);
    const error = errorText(name);
    const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
    return (
      <div className={`field ${error ? 'field--error' : ''} ${className}`}>
        <label htmlFor={id} className="field__label">
          {label}
          {required && <span className="field__required" aria-hidden="true"> *</span>}
        </label>
        {control({ id, 'aria-invalid': Boolean(error), 'aria-describedby': describedBy, 'aria-required': required || undefined })}
        {hint && !error && (
          <p id={`${id}-hint`} className="field__hint">
            {hint}
          </p>
        )}
        {error && (
          <p id={`${id}-error`} className="field__error" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  };

  const text = (name, label, opts = {}) =>
    field(
      name,
      label,
      (aria) => (
        <input
          {...aria}
          className="field__control"
          value={form[name]}
          onChange={(e) => onChange(name, e.target.value)}
          readOnly={opts.readOnly}
          maxLength={opts.maxLength}
          inputMode={opts.inputMode}
          autoComplete="off"
          spellCheck={opts.spellCheck}
        />
      ),
      opts,
    );

  const select = (name, label, values, optionLabel) =>
    field(
      name,
      label,
      (aria) => (
        <select {...aria} className="field__control" value={form[name]} onChange={(e) => onChange(name, e.target.value)}>
          {!form[name] && <option value="">{t('admin.productForm.choose')}</option>}
          {values.map((v) => (
            <option key={v} value={v}>
              {optionLabel(v)}
            </option>
          ))}
        </select>
      ),
      { required: true },
    );

  const checkbox = (name, label) => (
    <label className="checkbox">
      <input type="checkbox" checked={form[name]} onChange={(e) => onChange(name, e.target.checked)} />
      <span className="checkbox__box" aria-hidden="true" />
      <span className="checkbox__label">{label}</span>
    </label>
  );

  const toggleNote = (level, key) => {
    const list = form.notes[level];
    onChange('notes', { ...form.notes, [level]: list.includes(key) ? list.filter((n) => n !== key) : [...list, key] });
  };

  const volumesError = errorText('volumes');
  const warningText = (w) =>
    t(`admin.productForm.warnings.${w.code}`, {
      ...w.params,
      volumes: w.params.volumes?.join(', '),
    });

  return (
    <form className="form admin-product-form" onSubmit={onSubmit} noValidate>
      {/* ---------- Основное ---------- */}
      <fieldset className="form__section">
        <legend>{t('admin.productForm.sections.main')}</legend>
        {text('id', t('admin.productForm.id'), {
          required: true,
          readOnly: isEdit,
          maxLength: LIMITS.id,
          spellCheck: false,
          hint: isEdit ? t('admin.productForm.idLocked') : t('admin.productForm.idHint'),
        })}
        <div className="form__row">
          {text('name', t('admin.productForm.name'), { required: true, maxLength: LIMITS.name })}
          {text('brand', t('admin.productForm.brand'), { required: true, maxLength: LIMITS.brand })}
        </div>
        <div className="form__row">
          {select('category', t('admin.productForm.gender'), CATEGORIES, (v) => t(`categories.${v}`))}
          {select('fragranceFamily', t('admin.productForm.family'), FAMILIES, (v) => t(`families.${v}`))}
        </div>
        <div className="form__row">
          {select('concentration', t('admin.productForm.concentration'), CONCENTRATIONS, (v) => t(`concentration.${v}`))}
          {select('intensity', t('admin.productForm.intensity'), INTENSITIES, (v) => t(`intensity.${v}`))}
        </div>
      </fieldset>

      {/* ---------- Описание ---------- */}
      <fieldset className="form__section">
        <legend>{t('admin.productForm.sections.description')}</legend>
        {LANGS.map((lang) => {
          const name = `description.${lang}`;
          const value = form.description[lang];
          return (
            <div key={lang}>
              {field(
                name,
                `${t('admin.productForm.description')} · ${LANG_NAMES[lang]}`,
                (aria) => (
                  <textarea
                    {...aria}
                    className="field__control"
                    rows={4}
                    lang={lang}
                    value={value}
                    onChange={(e) => onChange('description', { ...form.description, [lang]: e.target.value })}
                  />
                ),
                { required: true },
              )}
              <p className={`admin-product-form__counter${value.length > LIMITS.description ? ' is-over' : ''}`}>
                {t('admin.productForm.counter', { count: value.length, max: LIMITS.description })}
              </p>
            </div>
          );
        })}
      </fieldset>

      {/* ---------- Фото ---------- */}
      <fieldset className="form__section">
        <legend>{t('admin.productForm.sections.image')}</legend>
        <div className="admin-product-form__image">
          <div className="admin-product-form__thumb">
            {/* key — чтобы после исправления адреса картинка загрузилась заново */}
            <ProductImage key={form.image} src={form.image.trim() || defaultImagePath(form.id.trim() || 'placeholder')} alt="" />
          </div>
          {text('image', t('admin.productForm.image'), {
            maxLength: LIMITS.image,
            spellCheck: false,
            hint: t('admin.productForm.imageHint', { path: defaultImagePath(form.id.trim() || 'id') }),
          })}
        </div>
      </fieldset>

      {/* ---------- Объёмы и цены ---------- */}
      <fieldset
        className={`form__section${volumesError ? ' admin-product-form__group--error' : ''}`}
        id={productFormFieldId('volumes')}
        tabIndex={-1}
        aria-describedby={volumesError ? `${productFormFieldId('volumes')}-error` : undefined}
      >
        <legend>
          {t('admin.productForm.sections.volumes')}
          <span className="field__required" aria-hidden="true"> *</span>
        </legend>
        <p className="form__note">{t('admin.productForm.volumesHint')}</p>
        <div className="admin-product-form__volumes">
          {FORM_VOLUMES.map((ml) => {
            const v = form.volumes[ml];
            const name = `volumes.${ml}`;
            const id = productFormFieldId(name);
            const error = errorText(name);
            return (
              <div key={ml} className={`admin-product-form__volume${error ? ' field--error' : ''}`}>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={v.enabled}
                    onChange={(e) => onChange('volumes', { ...form.volumes, [ml]: { ...v, enabled: e.target.checked } })}
                  />
                  <span className="checkbox__box" aria-hidden="true" />
                  <span className="checkbox__label">
                    {ml} {t('product.ml')}
                  </span>
                </label>
                <label className="visually-hidden" htmlFor={id}>
                  {t('admin.productForm.priceFor', { ml })}
                </label>
                <input
                  id={id}
                  className="field__control"
                  inputMode="numeric"
                  placeholder={t('admin.productForm.pricePlaceholder')}
                  value={v.price}
                  disabled={!v.enabled}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? `${id}-error` : undefined}
                  onChange={(e) => onChange('volumes', { ...form.volumes, [ml]: { ...v, price: e.target.value } })}
                />
                {error && (
                  <p id={`${id}-error`} className="field__error" role="alert">
                    {error}
                  </p>
                )}
              </div>
            );
          })}
        </div>
        {volumesError && (
          <p id={`${productFormFieldId('volumes')}-error`} className="field__error" role="alert">
            {volumesError}
          </p>
        )}
      </fieldset>

      {/* ---------- Ноты ---------- */}
      <fieldset className="form__section">
        <legend>{t('admin.productForm.sections.notes')}</legend>
        <p className="form__note">{t('admin.productForm.notesHint', { max: LIMITS.notesPerLevel })}</p>
        {NOTE_LEVELS.map((level) => {
          const name = `notes.${level}`;
          const id = productFormFieldId(name);
          const selected = form.notes[level];
          const full = selected.length >= LIMITS.notesPerLevel;
          const error = errorText(name);
          return (
            <div
              key={level}
              id={id}
              tabIndex={-1}
              role="group"
              aria-labelledby={`${id}-label`}
              aria-describedby={error ? `${id}-error` : undefined}
              className="admin-product-form__notes"
            >
              <p id={`${id}-label`} className="field__label">
                {t(`notes.levels.${level}`)}{' '}
                <span className="admin-product-form__count">
                  {t('admin.productForm.counter', { count: selected.length, max: LIMITS.notesPerLevel })}
                </span>
              </p>
              <div className="admin-product-form__chips">
                {notes.map((key) => {
                  const active = selected.includes(key);
                  return (
                    <button
                      key={key}
                      type="button"
                      className={`admin-filter${active ? ' is-active' : ''}`}
                      aria-pressed={active}
                      disabled={!active && full}
                      onClick={() => toggleNote(level, key)}
                    >
                      {active && <Icon name="check" size={14} />}
                      {t(`notes.items.${key}`)}
                    </button>
                  );
                })}
              </div>
              {error && (
                <p id={`${id}-error`} className="field__error" role="alert">
                  {error}
                </p>
              )}
            </div>
          );
        })}
      </fieldset>

      {/* ---------- Наличие, метки, рейтинг ---------- */}
      <fieldset className="form__section">
        <legend>{t('admin.productForm.sections.extra')}</legend>
        <div className="form__row">
          {select('availability', t('admin.productForm.availability'), AVAILABILITIES, (v) => t(`availability.${v}`))}
          <div className="admin-product-form__flags">
            {checkbox('isNew', t('admin.productForm.isNew'))}
            {checkbox('isBestseller', t('admin.productForm.isBestseller'))}
          </div>
        </div>
        <div className="form__row">
          {text('rating', t('admin.productForm.rating'), { required: true, inputMode: 'decimal', hint: t('admin.productForm.ratingHint') })}
          {text('popularity', t('admin.productForm.popularity'), {
            required: true,
            inputMode: 'numeric',
            hint: t('admin.productForm.popularityHint'),
          })}
        </div>
      </fieldset>

      {/* ---------- Предупреждения и кнопки ---------- */}
      {warnings.length > 0 && (
        <ul className="admin-product-form__warnings" aria-live="polite">
          {warnings.map((w) => (
            <li key={w.code}>
              <Icon name="alert" size={16} /> {warningText(w)}
            </li>
          ))}
        </ul>
      )}

      <div className="admin-product-form__actions">
        <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={saving}>
          {t('admin.productForm.cancel')}
        </button>
        <button type="submit" className="btn btn--primary" disabled={saving}>
          <Icon name="check" size={16} />{' '}
          {saving ? t('admin.productForm.saving') : isEdit ? t('admin.productForm.save') : t('admin.productForm.create')}
        </button>
      </div>
    </form>
  );
}
