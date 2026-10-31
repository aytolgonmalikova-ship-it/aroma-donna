import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks/useTheme';

/** Переключатель темы: ☀️ светлая / 🌙 тёмная */
export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const { t } = useTranslation();
  const isDark = theme === 'dark';
  const label = isDark ? t('theme.toLight') : t('theme.toDark');
  return (
    <button
      type="button"
      className="icon-btn theme-toggle"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      aria-pressed={isDark}
    >
      <span aria-hidden="true">{isDark ? '🌙' : '☀️'}</span>
    </button>
  );
}
