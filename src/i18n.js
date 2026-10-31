import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ru from './locales/ru/translation.json';
import ky from './locales/ky/translation.json';
import en from './locales/en/translation.json';
import { loadFromStorage, saveToStorage, STORAGE_KEYS } from './utils/storage';

/**
 * Мультиязычность: русский (по умолчанию), кыргызский, английский.
 * Выбранный язык сохраняется в localStorage и восстанавливается после перезагрузки.
 */
export const LANGUAGES = [
  { code: 'ru', label: 'RU', name: 'Русский' },
  { code: 'ky', label: 'KG', name: 'Кыргызча' },
  { code: 'en', label: 'EN', name: 'English' },
];

const supported = LANGUAGES.map((l) => l.code);
const saved = loadFromStorage(STORAGE_KEYS.language, 'ru');
const initialLanguage = supported.includes(saved) ? saved : 'ru';

i18n.use(initReactI18next).init({
  resources: {
    ru: { translation: ru },
    ky: { translation: ky },
    en: { translation: en },
  },
  lng: initialLanguage,
  fallbackLng: 'ru',
  interpolation: { escapeValue: false }, // React сам защищает от XSS
});

const applyLanguage = (lng) => {
  document.documentElement.setAttribute('lang', lng);
  saveToStorage(STORAGE_KEYS.language, lng);
};

applyLanguage(initialLanguage);
i18n.on('languageChanged', applyLanguage);

export default i18n;
