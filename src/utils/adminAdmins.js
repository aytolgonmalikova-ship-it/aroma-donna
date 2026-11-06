// Раздел «Администраторы» (этап A5): чистые функции для отображения администраторов,
// ролей, предложения передачи роли и ошибок сервиса adminAdminsStore.js.
// Запись администратора — в формате toAdminRecord: { uid, label, grantedAt, grantedBy, legacy, isOwner, isPendingOwner }.
// Проверяются в tests/adminAdminsUi.test.js.

import { isUid, normalizeAdminLabel } from '../services/adminAdminsStore.js';

// Роли в интерфейсе: owner — главный администратор, pending — ему предложена роль главного, admin — обычный
export const ADMIN_ROLES = ['owner', 'pending', 'admin'];

/**
 * Коды ошибок сервиса администраторов (adminAdminsStore.js) и общие коды adminErrors.js.
 * Для каждого есть перевод admin.admins.errors.<code> на ru, ky, en.
 */
export const ADMIN_ERROR_CODES = [
  'not-signed-in',
  'invalid-uid',
  'invalid-label',
  'not-owner',
  'self',
  'user-not-found',
  'already-admin',
  'not-admin',
  'owner-protected',
  'pending-owner',
  'offer-exists',
  'no-offer',
  'offer-stale',
  'candidate-not-admin',
  'denied',
  'network',
  'not-configured',
  'failed',
];

/** Ключ перевода ошибки; неизвестный код — общее «не удалось» */
export const adminErrorKey = (code) =>
  `admin.admins.errors.${ADMIN_ERROR_CODES.includes(code) ? code : 'failed'}`;

/**
 * После каких ошибок повторять то же действие бессмысленно — кнопка подтверждения блокируется,
 * нужно обновить данные. Повторить можно после network и failed.
 */
export const isRetryableAdminError = (code) => code === 'network' || code === 'failed';

/** Роль администратора для интерфейса */
export function adminRoleOf(admin) {
  if (admin?.isOwner) return 'owner';
  if (admin?.isPendingOwner) return 'pending';
  return 'admin';
}

/** Подпись администратора без пробелов по краям; пустая или не строка — null */
export function adminDisplayName(admin) {
  const label = typeof admin?.label === 'string' ? admin.label.trim() : '';
  return label || null;
}

/** Короткая форма UID для текста сообщений: начало…конец (полный UID показывается отдельно) */
export function shortUid(uid) {
  const s = typeof uid === 'string' ? uid : '';
  return s.length > 14 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s;
}

/** Как назвать администратора в тексте: подпись, иначе короткий UID, иначе прочерк */
export const adminMentionName = (admin) => adminDisplayName(admin) || shortUid(admin?.uid) || '—';

/**
 * Кем выдан доступ: { kind: 'console' } — вручную (Firebase Console), { kind: 'you' } — вами,
 * { kind: 'uid', uid } — другим администратором, null — неизвестно (старая запись)
 */
export function adminGrantedBy(admin, currentUid) {
  const by = typeof admin?.grantedBy === 'string' ? admin.grantedBy : '';
  if (!by) return null;
  if (by === 'console') return { kind: 'console' };
  if (currentUid && by === currentUid) return { kind: 'you' };
  return { kind: 'uid', uid: by };
}

/**
 * Почему доступ этого администратора отозвать нельзя (как в revokeAdmin и firestore.rules):
 * 'self' — свой, 'owner' — главного, 'pending' — кандидата с действующим предложением; null — можно.
 */
export function revokeBlockReason(admin, currentUid) {
  if (!admin?.uid) return 'self';
  if (currentUid && admin.uid === currentUid) return 'self';
  if (admin.isOwner) return 'owner';
  if (admin.isPendingOwner) return 'pending';
  return null;
}

// ---------- Страница «Администраторы» (крупный блок 1) ----------

/**
 * Проверка формы «Добавить администратора» до обращения к сервису.
 * Возвращает { errors, value }: errors.uid — 'required' | 'invalid', errors.label — 'invalid';
 * value — { uid, label } (UID без пробелов по краям, подпись нормализована как в сервисе).
 * Назначение — только по UID: e-mail и другие идентификаторы не принимаются.
 */
export function validateGrantInput({ uid, label } = {}) {
  const errors = {};
  const cleanUid = typeof uid === 'string' ? uid.trim() : '';
  if (!cleanUid) errors.uid = 'required';
  else if (!isUid(cleanUid)) errors.uid = 'invalid';
  let cleanLabel = null;
  try {
    cleanLabel = normalizeAdminLabel(label);
  } catch {
    errors.label = 'invalid';
  }
  return { errors, value: { uid: cleanUid, label: cleanLabel } };
}

/**
 * Что показать на странице по данным сервиса.
 * access: 'owner' | 'pending' | 'none' (fetchOwnerStatus); admins и config — от fetchAdmins (только владельцу).
 * Возвращает:
 * - canManage — список, форма и действия (только владелец);
 * - members — администраторы (владелец первым) с доступными действиями:
 *   revoke: { allowed, reason } (reason — self | owner | pending), offer: { allowed };
 * - outgoing — предложение владельца { uid, name } или null;
 * - incoming — предложение кандидату { ownerUid, name } или null.
 * Скрытие действий — удобство интерфейса; окончательно решают правила Firestore.
 */
export function buildAdminsView({ access, admins = [], config = null, currentUid = null } = {}) {
  const canManage = access === 'owner';
  const pendingUid = config?.pendingOwnerUid || null;
  const ownerFirst = (a, b) => Number(Boolean(b.isOwner)) - Number(Boolean(a.isOwner));
  const members = canManage
    ? [...admins].sort(ownerFirst).map((admin) => {
        const reason = revokeBlockReason(admin, currentUid);
        const offerAllowed = !pendingUid && !reason;
        return { admin, revoke: { allowed: !reason, reason }, offer: { allowed: offerAllowed } };
      })
    : [];
  let outgoing = null;
  if (canManage && pendingUid) {
    const candidate = admins.find((a) => a.uid === pendingUid);
    outgoing = { uid: pendingUid, name: candidate ? adminMentionName(candidate) : shortUid(pendingUid) };
  }
  const incoming =
    access === 'pending' && config?.ownerUid ? { ownerUid: config.ownerUid, name: shortUid(config.ownerUid) } : null;
  return { canManage, members, outgoing, incoming };
}
