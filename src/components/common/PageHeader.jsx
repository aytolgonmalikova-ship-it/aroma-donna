import Breadcrumbs from './Breadcrumbs';

/** Заголовок внутренней страницы: хлебные крошки + H1 + подзаголовок */
export default function PageHeader({ title, subtitle, crumbs }) {
  return (
    <header className="page-header">
      <div className="container">
        {crumbs && <Breadcrumbs items={crumbs} />}
        <h1 className="page-header__title">{title}</h1>
        {subtitle && <p className="page-header__subtitle">{subtitle}</p>}
      </div>
    </header>
  );
}
