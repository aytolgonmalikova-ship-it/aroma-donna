// Тесты сервиса управления администраторами (этап A4, src/services/adminAdminsStore.js)
// на локальном Firebase Emulator с настоящими правилами firestore.rules (этапы A3, A3.1).
// Правила подробно проверяет firestore.rules.emulator.js; здесь — что сервис выполняет операции
// так, как их пропускают правила, даёт понятные коды ошибок и не даёт обычному администратору
// полномочий владельца.
//
// Запуск: npm run test:rules (проект demo-aroma-donna существует только в эмуляторе).
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import * as dbApi from 'firebase/firestore';
import { AdminError } from '../src/services/adminErrors.js';
import {
  acceptOwnerTransfer,
  cancelOwnerTransfer,
  declineOwnerTransfer,
  fetchAdmins,
  fetchOwnerStatus,
  grantAdmin,
  offerOwnerTransfer,
  revokeAdmin,
} from '../src/services/adminAdminsStore.js';
import { ADMIN2_UID, CANDIDATE_UID, GHOST_UID, NEWBIE_UID, OWNER_UID, seedAdminRoles } from './fixtures/adminRoles.js';

const PROJECT_ID = 'demo-aroma-donna';
let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
  });
  // Защита: только эмулятор и только demo-проект
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'FIRESTORE_EMULATOR_HOST не задан — запускайте через npm run test:rules');
  assert.ok(PROJECT_ID.startsWith('demo-'));
});

beforeEach(async () => {
  await env.clearFirestore();
});

after(async () => {
  await env?.cleanup();
});

/** Подключение «как в приложении»: Firestore вошедшего пользователя + модульный API firebase/firestore */
const as = (uid) => ({ db: env.authenticatedContext(uid).firestore(), dbApi });
const seed = (options) => seedAdminRoles(env, options);

async function readRaw(path) {
  let data;
  await env.withSecurityRulesDisabled(async (ctx) => {
    const snap = await dbApi.getDoc(dbApi.doc(ctx.firestore(), ...path.split('/')));
    data = snap.exists() ? snap.data() : null;
  });
  return data;
}

async function rejectsWith(promise, code) {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof AdminError, `ожидалась AdminError, получено ${err}`);
    assert.equal(err.code, code);
    return true;
  });
}

/** Работают ли админ-разделы (все заказы читает только isAdmin()) */
async function hasAdminSections(uid) {
  const { db } = as(uid);
  try {
    await dbApi.getDocs(dbApi.collectionGroup(db, 'orders'));
    return true;
  } catch (err) {
    if (err?.code === 'permission-denied') return false;
    throw err;
  }
}

const config = () => readRaw('adminConfig/primary');

// ---------- Статус и список ----------

describe('adminAdminsStore: статус владельца и список администраторов', () => {
  test('fetchOwnerStatus: владелец, кандидат, обычный администратор; отказ правил для admin — не ошибка', async () => {
    await seed({ pending: CANDIDATE_UID });
    const owner = await fetchOwnerStatus(as(OWNER_UID), OWNER_UID);
    assert.equal(owner.access, 'owner');
    assert.equal(owner.config.ownerUid, OWNER_UID);
    assert.equal(owner.config.pendingOwnerUid, CANDIDATE_UID);
    const pending = await fetchOwnerStatus(as(CANDIDATE_UID), CANDIDATE_UID);
    assert.equal(pending.access, 'pending');
    assert.equal(pending.config.ownerUid, OWNER_UID, 'кандидат видит, от кого предложение');
    for (const uid of [ADMIN2_UID, NEWBIE_UID]) {
      assert.deepEqual(await fetchOwnerStatus(as(uid), uid), { access: 'none', config: null });
    }
  });

  test('fetchOwnerStatus без adminConfig/primary: «none» даже у будущего владельца', async () => {
    await seed({ config: null });
    assert.deepEqual(await fetchOwnerStatus(as(OWNER_UID), OWNER_UID), { access: 'none', config: null });
  });

  test('fetchAdmins: владелец получает полный список; роль — из adminConfig, поле role игнорируется', async () => {
    await seed({ pending: CANDIDATE_UID });
    await env.withSecurityRulesDisabled((ctx) => dbApi.setDoc(dbApi.doc(ctx.firestore(), 'admins', 'legacy-uid'), { role: 'owner' }));
    const { admins, config: cfg } = await fetchAdmins(as(OWNER_UID), OWNER_UID);
    assert.equal(cfg.ownerUid, OWNER_UID);
    assert.deepEqual(admins.map((a) => [a.uid, a.isOwner, a.isPendingOwner]), [
      [OWNER_UID, true, false],
      [CANDIDATE_UID, false, true],
      ['legacy-uid', false, false],
      [ADMIN2_UID, false, false],
    ]);
    const legacy = admins.find((a) => a.uid === 'legacy-uid');
    assert.equal(legacy.legacy, true);
    assert.equal(legacy.isOwner, false, 'role: owner не даёт роли владельца');
    const manager = admins.find((a) => a.uid === ADMIN2_UID);
    assert.equal(manager.label, 'Менеджер');
    assert.equal(manager.grantedBy, OWNER_UID);
    assert.equal(manager.grantedAt, '2026-11-01T00:00:00.000Z');
  });

  test('fetchAdmins: обычный администратор, кандидат и покупатель — not-owner; без adminConfig — тоже', async () => {
    await seed({ pending: CANDIDATE_UID });
    for (const uid of [ADMIN2_UID, CANDIDATE_UID, NEWBIE_UID]) await rejectsWith(fetchAdmins(as(uid), uid), 'not-owner');
    await env.clearFirestore();
    await seed({ config: null });
    await rejectsWith(fetchAdmins(as(OWNER_UID), OWNER_UID), 'not-owner');
  });
});

// ---------- Назначение и отзыв доступа ----------

describe('adminAdminsStore: назначение и отзыв доступа', () => {
  test('grantAdmin: зарегистрированный пользователь становится администратором, но не владельцем', async () => {
    await seed();
    assert.equal(await hasAdminSections(NEWBIE_UID), false);
    assert.deepEqual(await grantAdmin(as(OWNER_UID), OWNER_UID, NEWBIE_UID, { label: '  Сестра  ' }), { uid: NEWBIE_UID });
    const saved = await readRaw(`admins/${NEWBIE_UID}`);
    assert.deepEqual(Object.keys(saved).sort(), ['grantedAt', 'grantedBy', 'label']);
    assert.equal(saved.label, 'Сестра');
    assert.equal(saved.grantedBy, OWNER_UID);
    assert.ok(saved.grantedAt instanceof dbApi.Timestamp);
    assert.equal(await hasAdminSections(NEWBIE_UID), true);
    assert.deepEqual(await fetchOwnerStatus(as(NEWBIE_UID), NEWBIE_UID), { access: 'none', config: null });
    await rejectsWith(fetchAdmins(as(NEWBIE_UID), NEWBIE_UID), 'not-owner');
  });

  test('grantAdmin: без подписи — документ только с grantedAt и grantedBy', async () => {
    await seed();
    await grantAdmin(as(OWNER_UID), OWNER_UID, NEWBIE_UID, { label: '   ' });
    assert.deepEqual(Object.keys(await readRaw(`admins/${NEWBIE_UID}`)).sort(), ['grantedAt', 'grantedBy']);
  });

  test('grantAdmin: несуществующий пользователь, повторное назначение, себе, неверный UID и подпись — отказ, ничего не записано', async () => {
    await seed();
    const fb = as(OWNER_UID);
    await rejectsWith(grantAdmin(fb, OWNER_UID, GHOST_UID), 'user-not-found');
    await rejectsWith(grantAdmin(fb, OWNER_UID, ADMIN2_UID), 'already-admin');
    await rejectsWith(grantAdmin(fb, OWNER_UID, OWNER_UID), 'self');
    await rejectsWith(grantAdmin(fb, OWNER_UID, 'bad.uid'), 'invalid-uid');
    await rejectsWith(grantAdmin(fb, OWNER_UID, NEWBIE_UID, { label: 'x'.repeat(101) }), 'invalid-label');
    assert.equal(await readRaw(`admins/${GHOST_UID}`), null);
    assert.equal(await readRaw(`admins/${NEWBIE_UID}`), null);
    assert.equal((await readRaw(`admins/${ADMIN2_UID}`)).label, 'Менеджер', 'существующий не перезаписан');
  });

  test('grantAdmin: не владелец (администратор, кандидат, покупатель) — not-owner', async () => {
    await seed({ pending: CANDIDATE_UID });
    for (const uid of [ADMIN2_UID, CANDIDATE_UID, NEWBIE_UID]) {
      await rejectsWith(grantAdmin(as(uid), uid, uid === NEWBIE_UID ? ADMIN2_UID : NEWBIE_UID), 'not-owner');
    }
    assert.equal(await readRaw(`admins/${NEWBIE_UID}`), null);
  });

  test('revokeAdmin: доступ отзывается сразу; повторно и у не администратора — not-admin', async () => {
    await seed();
    assert.equal(await hasAdminSections(ADMIN2_UID), true);
    assert.deepEqual(await revokeAdmin(as(OWNER_UID), OWNER_UID, ADMIN2_UID), { uid: ADMIN2_UID });
    assert.equal(await readRaw(`admins/${ADMIN2_UID}`), null);
    assert.equal(await hasAdminSections(ADMIN2_UID), false);
    await rejectsWith(revokeAdmin(as(OWNER_UID), OWNER_UID, ADMIN2_UID), 'not-admin');
    await rejectsWith(revokeAdmin(as(OWNER_UID), OWNER_UID, NEWBIE_UID), 'not-admin');
  });

  test('revokeAdmin: нельзя себя, владельца (другим администратором) и кандидата с действующим предложением', async () => {
    await seed({ pending: CANDIDATE_UID });
    await rejectsWith(revokeAdmin(as(OWNER_UID), OWNER_UID, OWNER_UID), 'self');
    await rejectsWith(revokeAdmin(as(ADMIN2_UID), ADMIN2_UID, OWNER_UID), 'not-owner');
    await rejectsWith(revokeAdmin(as(OWNER_UID), OWNER_UID, CANDIDATE_UID), 'pending-owner');
    for (const uid of [OWNER_UID, CANDIDATE_UID]) assert.ok(await readRaw(`admins/${uid}`), uid);
    // После отмены предложения кандидата можно отозвать
    await cancelOwnerTransfer(as(OWNER_UID), OWNER_UID, CANDIDATE_UID);
    await revokeAdmin(as(OWNER_UID), OWNER_UID, CANDIDATE_UID);
    assert.equal(await readRaw(`admins/${CANDIDATE_UID}`), null);
  });
});

// ---------- Передача роли владельца ----------

describe('adminAdminsStore: передача роли владельца', () => {
  test('offerOwnerTransfer: только действующему администратору, не себе, без второго предложения', async () => {
    await seed();
    const fb = as(OWNER_UID);
    await rejectsWith(offerOwnerTransfer(fb, OWNER_UID, OWNER_UID), 'self');
    await rejectsWith(offerOwnerTransfer(fb, OWNER_UID, NEWBIE_UID), 'candidate-not-admin');
    await rejectsWith(offerOwnerTransfer(fb, OWNER_UID, GHOST_UID), 'candidate-not-admin');
    assert.deepEqual(await offerOwnerTransfer(fb, OWNER_UID, CANDIDATE_UID), { pendingOwnerUid: CANDIDATE_UID });
    await rejectsWith(offerOwnerTransfer(fb, OWNER_UID, ADMIN2_UID), 'offer-exists');
    const cfg = await config();
    assert.equal(cfg.pendingOwnerUid, CANDIDATE_UID);
    assert.equal(cfg.ownerUid, OWNER_UID);
    assert.equal(cfg.updatedBy, OWNER_UID);
    assert.ok(cfg.updatedAt instanceof dbApi.Timestamp);
  });

  test('acceptOwnerTransfer: кандидат — владелец, прежний владелец — обычный администратор', async () => {
    await seed();
    await offerOwnerTransfer(as(OWNER_UID), OWNER_UID, CANDIDATE_UID);
    // Кандидат видит предложение и принимает его своим входом
    const seen = await fetchOwnerStatus(as(CANDIDATE_UID), CANDIDATE_UID);
    assert.equal(seen.access, 'pending');
    assert.deepEqual(await acceptOwnerTransfer(as(CANDIDATE_UID), CANDIDATE_UID, seen.config.ownerUid), {
      ownerUid: CANDIDATE_UID,
      previousOwnerUid: OWNER_UID,
    });
    const cfg = await config();
    assert.deepEqual(
      { ownerUid: cfg.ownerUid, pendingOwnerUid: cfg.pendingOwnerUid, previousOwnerUid: cfg.previousOwnerUid, updatedBy: cfg.updatedBy },
      { ownerUid: CANDIDATE_UID, pendingOwnerUid: null, previousOwnerUid: OWNER_UID, updatedBy: CANDIDATE_UID },
    );
    // Новый владелец управляет, прежний — обычный администратор (документ admins на месте, разделы работают)
    assert.equal((await fetchOwnerStatus(as(CANDIDATE_UID), CANDIDATE_UID)).access, 'owner');
    const { admins } = await fetchAdmins(as(CANDIDATE_UID), CANDIDATE_UID);
    assert.deepEqual(admins.filter((a) => a.isOwner).map((a) => a.uid), [CANDIDATE_UID]);
    assert.ok(admins.some((a) => a.uid === OWNER_UID && !a.isOwner));
    assert.ok(await readRaw(`admins/${OWNER_UID}`));
    assert.equal(await hasAdminSections(OWNER_UID), true);
    assert.deepEqual(await fetchOwnerStatus(as(OWNER_UID), OWNER_UID), { access: 'none', config: null });
    await rejectsWith(fetchAdmins(as(OWNER_UID), OWNER_UID), 'not-owner');
    await rejectsWith(grantAdmin(as(OWNER_UID), OWNER_UID, NEWBIE_UID), 'not-owner');
    await rejectsWith(revokeAdmin(as(OWNER_UID), OWNER_UID, CANDIDATE_UID), 'not-owner');
    // Новый владелец может отозвать доступ прежнего
    await revokeAdmin(as(CANDIDATE_UID), CANDIDATE_UID, OWNER_UID);
    assert.equal(await hasAdminSections(OWNER_UID), false);
  });

  test('acceptOwnerTransfer: посторонний (администратор, владелец, покупатель) принять не может', async () => {
    await seed({ pending: CANDIDATE_UID });
    for (const uid of [ADMIN2_UID, OWNER_UID, NEWBIE_UID]) await rejectsWith(acceptOwnerTransfer(as(uid), uid), 'no-offer');
    const cfg = await config();
    assert.equal(cfg.ownerUid, OWNER_UID);
    assert.equal(cfg.pendingOwnerUid, CANDIDATE_UID);
  });

  test('нельзя действовать от имени другого: подставленный actorUid отклоняют правила (denied)', async () => {
    await seed({ pending: CANDIDATE_UID });
    // Владелец пытается «принять» за кандидата — запись с updatedBy кандидата под входом владельца
    await rejectsWith(acceptOwnerTransfer(as(OWNER_UID), CANDIDATE_UID), 'denied');
    // Кандидат (ему виден adminConfig) выдаёт себя за владельца и назначает администратора
    await rejectsWith(grantAdmin(as(CANDIDATE_UID), OWNER_UID, NEWBIE_UID), 'denied');
    const cfg = await config();
    assert.equal(cfg.ownerUid, OWNER_UID);
    assert.equal(cfg.pendingOwnerUid, CANDIDATE_UID);
    assert.equal(await readRaw(`admins/${NEWBIE_UID}`), null);
  });

  test('cancelOwnerTransfer: владелец отменяет; повторно — no-offer; не владелец — not-owner', async () => {
    await seed({ pending: CANDIDATE_UID });
    await rejectsWith(cancelOwnerTransfer(as(ADMIN2_UID), ADMIN2_UID), 'not-owner');
    await rejectsWith(cancelOwnerTransfer(as(CANDIDATE_UID), CANDIDATE_UID), 'not-owner');
    assert.deepEqual(await cancelOwnerTransfer(as(OWNER_UID), OWNER_UID, CANDIDATE_UID), { pendingOwnerUid: null });
    assert.equal((await config()).pendingOwnerUid, null);
    await rejectsWith(cancelOwnerTransfer(as(OWNER_UID), OWNER_UID), 'no-offer');
  });

  test('declineOwnerTransfer: кандидат отклоняет; другой администратор и владелец — no-offer', async () => {
    await seed({ pending: CANDIDATE_UID });
    await rejectsWith(declineOwnerTransfer(as(ADMIN2_UID), ADMIN2_UID), 'no-offer');
    // Владелец не «отклоняет» за кандидата: для него это отмена (cancelOwnerTransfer), а не отклонение
    await rejectsWith(declineOwnerTransfer(as(OWNER_UID), OWNER_UID), 'no-offer');
    assert.equal((await config()).pendingOwnerUid, CANDIDATE_UID);
    assert.deepEqual(await declineOwnerTransfer(as(CANDIDATE_UID), CANDIDATE_UID), { pendingOwnerUid: null });
    const cfg = await config();
    assert.equal(cfg.pendingOwnerUid, null);
    assert.equal(cfg.ownerUid, OWNER_UID);
    assert.equal(cfg.updatedBy, CANDIDATE_UID);
    await rejectsWith(declineOwnerTransfer(as(CANDIDATE_UID), CANDIDATE_UID), 'no-offer');
  });

  test('устаревшее предложение: после отмены — no-offer; кандидат лишён прав — no-offer; экран устарел — offer-stale', async () => {
    await seed({ pending: CANDIDATE_UID });
    const seen = await fetchOwnerStatus(as(CANDIDATE_UID), CANDIDATE_UID);
    assert.equal(seen.access, 'pending');
    // Владелец отменил, пока кандидат смотрел на предложение
    await cancelOwnerTransfer(as(OWNER_UID), OWNER_UID);
    await rejectsWith(acceptOwnerTransfer(as(CANDIDATE_UID), CANDIDATE_UID, seen.config.ownerUid), 'no-offer');
    // Владелец видел предложение кандидату, а оно уже другое (отклонено и сделано новое)
    await offerOwnerTransfer(as(OWNER_UID), OWNER_UID, ADMIN2_UID);
    await rejectsWith(cancelOwnerTransfer(as(OWNER_UID), OWNER_UID, CANDIDATE_UID), 'offer-stale');
    assert.equal((await config()).pendingOwnerUid, ADMIN2_UID, 'чужое предложение не отменено');
    // Кандидат видел другого владельца
    await rejectsWith(acceptOwnerTransfer(as(ADMIN2_UID), ADMIN2_UID, 'someone-else'), 'offer-stale');
    // Кандидата лишили прав в обход интерфейса (Console) — принять нельзя, роль у прежнего владельца
    await env.withSecurityRulesDisabled((ctx) => dbApi.deleteDoc(dbApi.doc(ctx.firestore(), 'admins', ADMIN2_UID)));
    await rejectsWith(acceptOwnerTransfer(as(ADMIN2_UID), ADMIN2_UID), 'no-offer');
    assert.equal((await config()).ownerUid, OWNER_UID);
  });

  test('гонка «принять» и «отменить» одновременно: выполняется ровно одно, состояние согласованное', async () => {
    for (let round = 0; round < 4; round += 1) {
      await env.clearFirestore();
      await seed({ pending: CANDIDATE_UID });
      const [accepted, cancelled] = await Promise.allSettled([
        acceptOwnerTransfer(as(CANDIDATE_UID), CANDIDATE_UID),
        cancelOwnerTransfer(as(OWNER_UID), OWNER_UID),
      ]);
      const won = [accepted, cancelled].filter((r) => r.status === 'fulfilled').length;
      assert.equal(won, 1, `раунд ${round}: ${accepted.status}/${cancelled.status}`);
      const cfg = await config();
      assert.equal(cfg.pendingOwnerUid, null);
      assert.equal(cfg.ownerUid, accepted.status === 'fulfilled' ? CANDIDATE_UID : OWNER_UID);
      const loser = accepted.status === 'fulfilled' ? cancelled : accepted;
      assert.ok(loser.reason instanceof AdminError, String(loser.reason));
    }
  });

  test('обычный администратор через сервис не получает полномочий владельца', async () => {
    await seed({ pending: CANDIDATE_UID });
    const fb = as(ADMIN2_UID);
    const before = await config();
    await rejectsWith(fetchAdmins(fb, ADMIN2_UID), 'not-owner');
    await rejectsWith(grantAdmin(fb, ADMIN2_UID, NEWBIE_UID), 'not-owner');
    await rejectsWith(revokeAdmin(fb, ADMIN2_UID, CANDIDATE_UID), 'not-owner');
    await rejectsWith(offerOwnerTransfer(fb, ADMIN2_UID, ADMIN2_UID), 'self');
    await rejectsWith(offerOwnerTransfer(fb, ADMIN2_UID, CANDIDATE_UID), 'not-owner');
    await rejectsWith(acceptOwnerTransfer(fb, ADMIN2_UID), 'no-offer');
    await rejectsWith(cancelOwnerTransfer(fb, ADMIN2_UID), 'not-owner');
    await rejectsWith(declineOwnerTransfer(fb, ADMIN2_UID), 'no-offer');
    assert.deepEqual(await fetchOwnerStatus(fb, ADMIN2_UID), { access: 'none', config: null });
    assert.deepEqual(await config(), before, 'adminConfig не изменился');
    assert.equal(await readRaw(`admins/${NEWBIE_UID}`), null);
    assert.ok(await readRaw(`admins/${CANDIDATE_UID}`));
    // Разделы админ-панели при этом работают как раньше
    assert.equal(await hasAdminSections(ADMIN2_UID), true);
  });
});
