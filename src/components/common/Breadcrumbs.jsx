import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

/**
 * «Хлебные крошки»: Главная / Каталог / Rose Poudrée
 * items: [{ label, to? }] — у последнего пункта ссылки нет.
 */
export default function Breadcrumbs({ items }) {
  const { t } = useTranslation();
  const all = [{ label: t('nav.home'), to: '/' }, ...items];
  return (
    <nav className="breadcrumbs" aria-label={t('common.breadcrumbs')}>
      <ol>
        {all.map((item, index) => {
          const isLast = index === all.length - 1;
          return (
            <li key={`${item.label}-${index}`}>
              {isLast || !item.to ? (
                <span aria-current={isLast ? 'page' : undefined}>{item.label}</span>
              ) : (
                <Link to={item.to}>{item.label}</Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
