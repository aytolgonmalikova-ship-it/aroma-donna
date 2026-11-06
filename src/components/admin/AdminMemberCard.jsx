import { useTranslation } from 'react-i18next';
import AdminRoleBadge from './AdminRoleBadge';
import { adminDisplayName, adminGrantedBy, adminRoleOf } from '../../utils/adminAdmins';
import { formatDate } from '../../utils/format';

/**
 * Карточка администратора (этап A5): подпись, роль, UID, когда и кем выдан доступ.
 * admin — запись в формате toAdminRecord (adminAdminsStore.js); currentUid — UID вошедшего пользователя.
 * children — кнопки действий; карточка их не придумывает: нет children — нет блока действий.
 * Подпись и UID выводятся обычным текстом и переносятся при любой длине.
 */
export default function AdminMemberCard({ admin, currentUid, children }) {
  const { t, i18n } = useTranslation();
  const role = adminRoleOf(admin);
  const name = adminDisplayName(admin);
  const isSelf = Boolean(currentUid) && admin?.uid === currentUid;
  const grantedBy = adminGrantedBy(admin, currentUid);

  let grantedByText = null;
  if (grantedBy?.kind === 'console') grantedByText = t('admin.admins.list.grantedByConsole');
  else if (grantedBy?.kind === 'you') grantedByText = t('admin.admins.list.grantedByYou');
  else if (grantedBy?.kind === 'uid') grantedByText = t('admin.admins.list.grantedBy', { uid: grantedBy.uid });

  return (
    <article className={`admin-member card admin-member--${role}`}>
      <div className="admin-member__head">
        <h3 className={`admin-member__name${name ? '' : ' is-empty'}`}>{name || t('admin.admins.list.noLabel')}</h3>
        <div className="admin-member__badges">
          <AdminRoleBadge role={role} />
          {isSelf && <span className="admin-badge admin-badge--self">{t('admin.admins.list.you')}</span>}
          {admin?.legacy && (
            <span className="admin-badge admin-badge--legacy" title={t('admin.admins.list.legacyHint')}>
              {t('admin.admins.list.legacy')}
            </span>
          )}
        </div>
      </div>
      <dl className="admin-member__facts">
        <div>
          <dt>{t('admin.admins.uid.label')}</dt>
          <dd>
            <code className="admin-member__uid">{admin?.uid || '—'}</code>
          </dd>
        </div>
        <div>
          <dt>{t('admin.admins.list.grantedAtLabel')}</dt>
          <dd>
            {admin?.grantedAt ? formatDate(admin.grantedAt, i18n.resolvedLanguage) : t('admin.admins.list.grantedAtUnknown')}
          </dd>
        </div>
        {grantedByText && (
          <div>
            <dt>{t('admin.admins.list.grantedByLabel')}</dt>
            <dd>{grantedByText}</dd>
          </div>
        )}
      </dl>
      {role !== 'admin' && <p className="admin-member__hint">{t(`admin.admins.roleHint.${role}`)}</p>}
      {children && <div className="admin-member__actions">{children}</div>}
    </article>
  );
}
