import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LANGUAGES } from '../../i18n';
import { useClickOutside } from '../../hooks/useClickOutside';
import Icon from './Icon';

/** Выпадающий список языков RU / KG / EN. Выбор сохраняется в localStorage (см. i18n.js) */
export default function LanguageSwitcher({ compact = false }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const close = useCallback(() => setOpen(false), []);
  useClickOutside(ref, close, open);

  const current = LANGUAGES.find((l) => l.code === i18n.resolvedLanguage) || LANGUAGES[0];

  if (compact) {
    // Вариант для мобильного меню — три кнопки в ряд
    return (
      <div className="lang-segment" role="group" aria-label={t('language.label')}>
        {LANGUAGES.map((lang) => (
          <button
            key={lang.code}
            type="button"
            className={lang.code === current.code ? 'is-active' : ''}
            aria-pressed={lang.code === current.code}
            onClick={() => i18n.changeLanguage(lang.code)}
          >
            {lang.name}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="lang-switcher" ref={ref}>
      <button
        type="button"
        className="icon-btn lang-switcher__btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${t('language.label')}: ${current.name}`}
        onClick={() => setOpen((v) => !v)}
      >
        {current.label}
        <Icon name="chevronDown" size={14} />
      </button>
      {open && (
        <ul className="lang-switcher__menu" role="listbox" aria-label={t('language.label')}>
          {LANGUAGES.map((lang) => (
            <li key={lang.code} role="option" aria-selected={lang.code === current.code}>
              <button
                type="button"
                className={lang.code === current.code ? 'is-active' : ''}
                onClick={() => {
                  i18n.changeLanguage(lang.code);
                  setOpen(false);
                }}
              >
                <span>{lang.label}</span> {lang.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
