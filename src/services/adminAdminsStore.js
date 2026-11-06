// Администраторы и главный администратор (этап A4): список, назначение, отзыв доступа
// и двухэтапная передача роли владельца (предложить → принять / отменить / отклонить).
//
// Архитектура (A2) и правила firestore.rules (A3, A3.1):
// - администратор — тот, у кого есть документ admins/{uid} (поле role правами НЕ является);
// - владелец — UID в adminConfig/primary.ownerUid (единственный источник истины);
// - управлять администраторами может только владелец; обычному администратору чтение adminConfig
//   запрещено правилами — для него это ожидаемый ответ «вы не владелец», а не ошибка приложения.
//
// Функции получают { db, dbApi } и actorUid — UID вошедшего пользователя. В приложении actorUid
// подставляет adminService.js из Firebase Auth (не из интерфейса), в тестах — эмулятор.
// Все изменения, зависящие от нескольких документов, — транзакции: сначала все чтения, потом одна запись.
// Окончательное решение принимают правила Firestore: проверки здесь — понятные сообщения заранее.

import { AdminError, toAdminError } from './adminErrors.js';

export const ADMINS = 'admins';
export const ADMIN_CONFIG = ['adminConfig', 'primary'];

// Тот же формат, что isUid() в firestore.rules
const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
export const isUid = (value) => typeof value === 'string' && UID_PATTERN.test(value);

export const ADMIN_LABEL_MAX = 100;

/**
 * Подпись администратора: необязательная, 1–100 символов без пробелов по краям.
 * Возвращает строку или null (подписи нет); неверная — AdminError('invalid-label').
 */
export function normalizeAdminLabel(label) {
  if (label === undefined || label === null) return null;
  if (typeof label !== 'string') throw new AdminError('invalid-label');
  const trimmed = label.trim();
  if (!trimmed) return null;
  if (trimmed.length > ADMIN_LABEL_MAX) throw new AdminError('invalid-label');
  return trimmed;
}

/** Timestamp Firestore → ISO-строка; иначе null */
const toIso = (v) => (v?.toDate ? v.toDate().toISOString() : null);
const uidOrNull = (v) => (isUid(v) ? v : null);

/** adminConfig/primary → { ownerUid, pendingOwnerUid, previousOwnerUid, updatedAt, updatedBy } */
export function toOwnerConfig(data) {
  return {
    ownerUid: uidOrNull(data?.ownerUid),
    pendingOwnerUid: uidOrNull(data?.pendingOwnerUid),
    previousOwnerUid: uidOrNull(data?.previousOwnerUid),
    updatedAt: toIso(data?.updatedAt),
    updatedBy: typeof data?.updatedBy === 'string' ? data.updatedBy : null,
  };
}

/**
 * admins/{uid} → запись для списка. Роль вычисляется из adminConfig, поле role документа не читается.
 * legacy — документ старого формата (создан вручную в Console до этапа A3, без grantedAt).
 */
export function toAdminRecord(uid, data, config) {
  return {
    uid,
    label: typeof data?.label === 'string' ? data.label : null,
    grantedAt: toIso(data?.grantedAt),
    grantedBy: typeof data?.grantedBy === 'string' ? data.grantedBy : null,
    legacy: !data || !('grantedAt' in data),
    isOwner: Boolean(config?.ownerUid) && config.ownerUid === uid,
    isPendingOwner: Boolean(config?.pendingOwnerUid) && config.pendingOwnerUid === uid,
  };
}

// Владелец — первым, кандидат — вторым, остальные — по дате назначения (старые сверху)
const byRole = (a, b) =>
  Number(b.isOwner) - Number(a.isOwner) ||
  Number(b.isPendingOwner) - Number(a.isPendingOwner) ||
  String(a.grantedAt ?? '').localeCompare(String(b.grantedAt ?? '')) ||
  a.uid.localeCompare(b.uid);

const configRef = ({ db, dbApi }) => dbApi.doc(db, ...ADMIN_CONFIG);
const adminRef = ({ db, dbApi }, uid) => dbApi.doc(db, ADMINS, uid);
const userRef = ({ db, dbApi }, uid) => dbApi.doc(db, 'users', uid);

const requireActor = (actorUid) => {
  if (!isUid(actorUid)) throw new AdminError('not-signed-in');
};
const requireTarget = (uid) => {
  if (!isUid(uid)) throw new AdminError('invalid-uid');
};

/**
 * Прочитать adminConfig/primary. Отказ правил (читать могут только владелец и кандидат)
 * — ожидаемый ответ: превращается в код deniedCode (например, not-owner или no-offer).
 * Другие ошибки (сеть и т. п.) не скрываются.
 */
async function readConfig(read, deniedCode) {
  let snap;
  try {
    snap = await read();
  } catch (err) {
    if (err?.code === 'permission-denied') throw new AdminError(deniedCode, err);
    throw err;
  }
  if (!snap.exists()) throw new AdminError(deniedCode);
  return toOwnerConfig(snap.data());
}

/** Метаданные каждого изменения adminConfig — как требуют правила */
const configMeta = (dbApi, actorUid) => ({ updatedAt: dbApi.serverTimestamp(), updatedBy: actorUid });

// ---------- Чтение ----------

/**
 * Роль вошедшего администратора в управлении администраторами.
 * { access: 'owner' | 'pending' | 'none', config }:
 * owner — владелец; pending — ему предложена роль владельца (config виден); none — обычный администратор
 * (или adminConfig ещё не создан) — правила не дают читать adminConfig, это не ошибка: config = null.
 */
export async function fetchOwnerStatus(fb, actorUid) {
  try {
    requireActor(actorUid);
    const config = await readConfig(() => fb.dbApi.getDoc(configRef(fb)), 'no-access');
    if (config.ownerUid === actorUid) return { access: 'owner', config };
    if (config.pendingOwnerUid === actorUid) return { access: 'pending', config };
    return { access: 'none', config: null };
  } catch (err) {
    if (err instanceof AdminError && err.code === 'no-access') return { access: 'none', config: null };
    throw toAdminError(err);
  }
}

/**
 * Полный список администраторов — только владельцу. Сначала проверяется, что actorUid — владелец
 * (иначе 'not-owner', список не запрашивается), затем читается коллекция admins.
 * Возвращает { admins, config }; владелец и кандидат отмечены флагами.
 */
export async function fetchAdmins(fb, actorUid) {
  try {
    requireActor(actorUid);
    const config = await readConfig(() => fb.dbApi.getDoc(configRef(fb)), 'not-owner');
    if (config.ownerUid !== actorUid) throw new AdminError('not-owner');
    const snap = await fb.dbApi.getDocs(fb.dbApi.collection(fb.db, ADMINS));
    const admins = snap.docs.map((d) => toAdminRecord(d.id, d.data(), config)).sort(byRole);
    return { admins, config };
  } catch (err) {
    throw toAdminError(err);
  }
}

// ---------- Назначение и отзыв доступа ----------

/**
 * Назначить администратором зарегистрированного пользователя (по UID, не по e-mail).
 * Транзакция читает adminConfig (вызывающий — владелец?), users/{uid} (зарегистрирован?) и admins/{uid}
 * (уже администратор?), затем создаёт admins/{uid} = { grantedAt: serverTimestamp(), grantedBy, label? }.
 * Ошибки: invalid-uid, invalid-label, self, not-owner, user-not-found, already-admin.
 */
export async function grantAdmin(fb, actorUid, targetUid, { label } = {}) {
  try {
    requireActor(actorUid);
    requireTarget(targetUid);
    if (targetUid === actorUid) throw new AdminError('self');
    const cleanLabel = normalizeAdminLabel(label);
    const { db, dbApi } = fb;
    await dbApi.runTransaction(db, async (tx) => {
      const config = await readConfig(() => tx.get(configRef(fb)), 'not-owner');
      if (config.ownerUid !== actorUid) throw new AdminError('not-owner');
      const [user, admin] = await Promise.all([tx.get(userRef(fb, targetUid)), tx.get(adminRef(fb, targetUid))]);
      if (!user.exists()) throw new AdminError('user-not-found');
      if (admin.exists()) throw new AdminError('already-admin');
      const data = { grantedAt: dbApi.serverTimestamp(), grantedBy: actorUid };
      if (cleanLabel) data.label = cleanLabel;
      tx.set(adminRef(fb, targetUid), data);
    });
    return { uid: targetUid };
  } catch (err) {
    throw toAdminError(err);
  }
}

/**
 * Отозвать доступ одного администратора (по одному за операцию, без пакетов).
 * Транзакция: вызывающий — владелец; нельзя себя (self), владельца (owner-protected) и кандидата
 * с действующим предложением (pending-owner — сначала отменить предложение); нет документа — not-admin.
 */
export async function revokeAdmin(fb, actorUid, targetUid) {
  try {
    requireActor(actorUid);
    requireTarget(targetUid);
    if (targetUid === actorUid) throw new AdminError('self');
    await fb.dbApi.runTransaction(fb.db, async (tx) => {
      const config = await readConfig(() => tx.get(configRef(fb)), 'not-owner');
      if (config.ownerUid !== actorUid) throw new AdminError('not-owner');
      if (config.ownerUid === targetUid) throw new AdminError('owner-protected');
      if (config.pendingOwnerUid === targetUid) throw new AdminError('pending-owner');
      const admin = await tx.get(adminRef(fb, targetUid));
      if (!admin.exists()) throw new AdminError('not-admin');
      tx.delete(adminRef(fb, targetUid));
    });
    return { uid: targetUid };
  } catch (err) {
    throw toAdminError(err);
  }
}

// ---------- Передача роли владельца ----------

/**
 * Шаг 1: владелец предлагает роль действующему администратору.
 * Транзакция: вызывающий — владелец; предложения ещё нет (offer-exists — сначала отменить);
 * кандидат — администратор (candidate-not-admin). Записывается pendingOwnerUid + updatedAt/updatedBy.
 */
export async function offerOwnerTransfer(fb, actorUid, targetUid) {
  try {
    requireActor(actorUid);
    requireTarget(targetUid);
    if (targetUid === actorUid) throw new AdminError('self');
    const { db, dbApi } = fb;
    await dbApi.runTransaction(db, async (tx) => {
      const config = await readConfig(() => tx.get(configRef(fb)), 'not-owner');
      if (config.ownerUid !== actorUid) throw new AdminError('not-owner');
      if (config.pendingOwnerUid) throw new AdminError('offer-exists');
      const candidate = await tx.get(adminRef(fb, targetUid));
      if (!candidate.exists()) throw new AdminError('candidate-not-admin');
      tx.update(configRef(fb), { pendingOwnerUid: targetUid, ...configMeta(dbApi, actorUid) });
    });
    return { pendingOwnerUid: targetUid };
  } catch (err) {
    throw toAdminError(err);
  }
}

/**
 * Отмена предложения владельцем. expectedPendingUid — кандидат, которого видел интерфейс:
 * если предложение с тех пор изменилось — offer-stale (ничего не отменяется). Нет предложения — no-offer.
 */
export async function cancelOwnerTransfer(fb, actorUid, expectedPendingUid) {
  try {
    requireActor(actorUid);
    const { db, dbApi } = fb;
    await dbApi.runTransaction(db, async (tx) => {
      const config = await readConfig(() => tx.get(configRef(fb)), 'not-owner');
      if (config.ownerUid !== actorUid) throw new AdminError('not-owner');
      if (!config.pendingOwnerUid) throw new AdminError('no-offer');
      if (expectedPendingUid !== undefined && expectedPendingUid !== config.pendingOwnerUid) {
        throw new AdminError('offer-stale');
      }
      tx.update(configRef(fb), { pendingOwnerUid: null, ...configMeta(dbApi, actorUid) });
    });
    return { pendingOwnerUid: null };
  } catch (err) {
    throw toAdminError(err);
  }
}

/**
 * Отклонение предложения кандидатом (только своим входом: actorUid — из Firebase Auth).
 * Если читать adminConfig нельзя (предложения нет, его отменили или кандидат уже не администратор) — no-offer.
 */
export async function declineOwnerTransfer(fb, actorUid) {
  try {
    requireActor(actorUid);
    const { db, dbApi } = fb;
    await dbApi.runTransaction(db, async (tx) => {
      const config = await readConfig(() => tx.get(configRef(fb)), 'no-offer');
      if (config.pendingOwnerUid !== actorUid) throw new AdminError('no-offer');
      tx.update(configRef(fb), { pendingOwnerUid: null, ...configMeta(dbApi, actorUid) });
    });
    return { pendingOwnerUid: null };
  } catch (err) {
    throw toAdminError(err);
  }
}

/**
 * Шаг 2: кандидат сам принимает роль (actorUid — его UID из Firebase Auth; от имени другого нельзя).
 * Транзакция читает adminConfig и свой admins/{uid}: предложения нет или оно не ему — no-offer;
 * его доступ отозван — not-admin; expectedOwnerUid (владелец, которого видел интерфейс) не совпал — offer-stale.
 * Одна запись: ownerUid = кандидат, previousOwnerUid = прежний владелец, pendingOwnerUid = null.
 * Прежний владелец остаётся обычным администратором (его admins/{uid} не трогается).
 */
export async function acceptOwnerTransfer(fb, actorUid, expectedOwnerUid) {
  try {
    requireActor(actorUid);
    const { db, dbApi } = fb;
    let previousOwnerUid = null;
    await dbApi.runTransaction(db, async (tx) => {
      const config = await readConfig(() => tx.get(configRef(fb)), 'no-offer');
      const self = await tx.get(adminRef(fb, actorUid));
      if (config.pendingOwnerUid !== actorUid) throw new AdminError('no-offer');
      if (!self.exists()) throw new AdminError('not-admin');
      if (!config.ownerUid) throw new AdminError('failed');
      if (expectedOwnerUid !== undefined && expectedOwnerUid !== config.ownerUid) throw new AdminError('offer-stale');
      previousOwnerUid = config.ownerUid;
      tx.update(configRef(fb), {
        ownerUid: actorUid,
        previousOwnerUid,
        pendingOwnerUid: null,
        ...configMeta(dbApi, actorUid),
      });
    });
    return { ownerUid: actorUid, previousOwnerUid };
  } catch (err) {
    throw toAdminError(err);
  }
}
