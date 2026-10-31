import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { loadFromStorage, saveToStorage, STORAGE_KEYS } from '../utils/storage';

/**
 * Светлая / тёмная тема.
 * - При первом посещении берём системную настройку (prefers-color-scheme).
 * - Когда пользователь нажал на переключатель — запоминаем выбор в localStorage.
 * - Тема применяется атрибутом data-theme на <html>, а все цвета в CSS
 *   берутся из CSS-переменных, которые зависят от этого атрибута.
 */

const ThemeContext = createContext(null);

const systemPrefersDark = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;

function getInitialTheme() {
  const saved = loadFromStorage(STORAGE_KEYS.theme, null);
  if (saved === 'light' || saved === 'dark') return saved;
  return systemPrefersDark() ? 'dark' : 'light';
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(getInitialTheme);

  // Применяем тему к документу при каждом изменении
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
      'content',
      theme === 'dark' ? '#1d1719' : '#f6e7e4',
    );
  }, [theme]);

  // Следим за системной темой, пока пользователь не выбрал тему сам
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) return undefined;
    const onChange = (e) => {
      if (!loadFromStorage(STORAGE_KEYS.theme, null)) setTheme(e.matches ? 'dark' : 'light');
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      saveToStorage(STORAGE_KEYS.theme, next); // запоминаем выбор пользователя
      return next;
    });
  }, []);

  const value = useMemo(() => ({ theme, toggleTheme }), [theme, toggleTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
