import { useId, useState } from 'react';
import Icon from '../common/Icon';

/**
 * Сворачиваемая группа чекбоксов для фильтров каталога.
 * options: [{ value, label, count }]
 */
export default function FilterGroup({ title, options, selected, onToggle, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  const groupId = useId(); // уникальный id для связи кнопки и списка (aria-controls)

  return (
    <fieldset className="filter-group">
      <legend className="visually-hidden">{title}</legend>
      <button
        type="button"
        className="filter-group__toggle"
        aria-expanded={open}
        aria-controls={groupId}
        onClick={() => setOpen((v) => !v)}
      >
        {title}
        {selected.length > 0 && <span className="filter-group__count">{selected.length}</span>}
        <Icon name="chevronDown" size={16} className={open ? 'rotate-180' : ''} />
      </button>
      {open && (
        <div id={groupId} className="filter-group__options">
          {options.map((opt) => (
            <label key={opt.value} className="checkbox">
              <input
                type="checkbox"
                checked={selected.includes(opt.value)}
                onChange={() => onToggle(opt.value)}
              />
              <span className="checkbox__box" aria-hidden="true" />
              <span className="checkbox__label">{opt.label}</span>
              {opt.count !== undefined && <span className="checkbox__count">{opt.count}</span>}
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}
