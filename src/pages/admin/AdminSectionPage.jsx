import { useTranslation } from 'react-i18next';
import EmptyState from '../../components/common/EmptyState';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';

/** Заглушка раздела админ-панели, который будет реализован на следующих этапах */
export default function AdminSectionPage({ section }) {
  const { t } = useTranslation();
  const title = t(`admin.nav.${section.path}`);
  useDocumentTitle(`${title} — ${t('admin.title')}`);

  return (
    <>
      <div className="admin-page__head">
        <h1>{title}</h1>
      </div>
      <EmptyState
        icon={section.icon}
        title={t('admin.soonTitle')}
        text={t('admin.soonText', { stage: section.stage })}
      />
    </>
  );
}
