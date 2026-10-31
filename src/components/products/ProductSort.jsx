import { useTranslation } from 'react-i18next';
import { SORT_OPTIONS } from '../../utils/filterProducts';

/** Выпадающий список сортировки */
export default function ProductSort({ value, onChange }) {
  const { t } = useTranslation();
  return (
    <div className="sort">
      <label htmlFor="sort-select">{t('sort.label')}</label>
      <select id="sort-select" value={value} onChange={(e) => onChange(e.target.value)}>
        {SORT_OPTIONS.map((opt) => (
          <option key={opt} value={opt}>
            {t(`sort.${opt}`)}
          </option>
        ))}
      </select>
    </div>
  );
}
