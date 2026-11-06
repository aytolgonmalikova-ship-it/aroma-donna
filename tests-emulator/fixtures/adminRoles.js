// Общие тестовые данные ролей администраторов (этапы A3–A4) для тестов на Firebase Emulator:
// tests-emulator/firestore.rules.emulator.js (правила) и tests-emulator/adminAdminsStore.emulator.js (сервис).
// Записываются в обход правил (withSecurityRulesDisabled) — как документы, созданные в Firebase Console.
import { Timestamp, doc, setDoc } from 'firebase/firestore';

export const OWNER_UID = 'owner-uid';
export const ADMIN2_UID = 'admin2-uid'; // обычный администратор, документ нового формата
export const CANDIDATE_UID = 'candidate-uid'; // администратор, которому можно предложить роль владельца
export const NEWBIE_UID = 'newbie-uid'; // зарегистрирован на сайте (есть users/{uid}), не администратор
export const NEWBIE2_UID = 'newbie2-uid';
export const GHOST_UID = 'ghost-uid'; // нет профиля users/{uid}
export const BAD_UIDS = ['bad.uid', 'bad uid', 'x'.repeat(129)]; // неверный формат UID (профиль есть)

export const T0 = Timestamp.fromDate(new Date('2026-11-01T00:00:00Z'));

/** Роли: владелец, обычный администратор, кандидат; config = null — без adminConfig/primary */
export async function seedAdminRoles(env, { pending = null, config = {} } = {}) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const profile = (name) => ({ name, email: `${name}@example.com`, createdAt: T0 });
    for (const uid of [OWNER_UID, ADMIN2_UID, CANDIDATE_UID, NEWBIE_UID, NEWBIE2_UID, ...BAD_UIDS]) {
      await setDoc(doc(db, 'users', uid), profile(uid.slice(0, 20)));
    }
    await setDoc(doc(db, 'admins', OWNER_UID), { grantedAt: T0, grantedBy: 'console', label: 'Владелец' });
    await setDoc(doc(db, 'admins', ADMIN2_UID), { grantedAt: T0, grantedBy: OWNER_UID, label: 'Менеджер' });
    await setDoc(doc(db, 'admins', CANDIDATE_UID), { grantedAt: T0, grantedBy: OWNER_UID });
    if (config !== null) {
      await setDoc(doc(db, 'adminConfig', 'primary'), {
        ownerUid: OWNER_UID,
        pendingOwnerUid: pending,
        previousOwnerUid: null,
        updatedAt: T0,
        updatedBy: 'console',
        ...config,
      });
    }
  });
}
