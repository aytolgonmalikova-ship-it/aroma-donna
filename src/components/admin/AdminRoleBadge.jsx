import { useTranslation } from 'react-i18next';
import Icon from '../common/Icon';
import { ADMIN_ROLES } from '../../utils/adminAdmins';

/**
 * Метка роли администратора (этап A5): «Главный администратор», «Ждёт передачи роли» или «Администратор».
 * Подсказка (title) объясняет, что может эта роль. Неизвестная роль — ничего не показывается.
 */
export default function AdminRoleBadge({ role }) {
  const { t } = useTranslation();
  if (!ADMIN_ROLES.includes(role)) return null;
  return (
    <span className={`admin-badge admin-badge--role-${role}`} title={t(`admin.admins.roleHint.${role}`)}>
      {role === 'owner' && <Icon name="shield" size={12} />} {t(`admin.admins.roles.${role}`)}
    </span>
  );
}
