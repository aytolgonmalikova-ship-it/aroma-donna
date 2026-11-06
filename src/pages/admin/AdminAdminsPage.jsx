import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import AdminAdminsView from '../../components/admin/AdminAdminsView';
import { notify } from '../../features/notifications/notificationsSlice';
import { selectUser } from '../../features/user/userSlice';
import {
  acceptOwnerTransfer,
  cancelOwnerTransfer,
  declineOwnerTransfer,
  fetchAdmins,
  fetchOwnerStatus,
  grantAdmin,
  offerOwnerTransfer,
  revokeAdmin,
} from '../../services/adminService';
import { adminMentionName, buildAdminsView, isRetryableAdminError, shortUid } from '../../utils/adminAdmins';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';

/**
 * Страница «Администраторы» (крупный блок 1): управление администраторами и передача роли владельца.
 *
 * Данные — только из сервиса (adminService → adminAdminsStore): сначала fetchOwnerStatus,
 * владельцу — ещё fetchAdmins. Обычный администратор список не получает (и правила его не дают);
 * кандидат видит только предложение ему. После каждого действия данные перечитываются из Firestore —
 * роль владельца никогда не меняется локально. Одновременно выполняется одно действие.
 * Скрытие кнопок — удобство: окончательно решают правила Firestore (этапы A3, A3.1).
 *
 * Подключение: AdminApp.jsx → OwnerSectionRoute (владелец и кандидат), пункт меню — только владельцу.
 */
// onRolesChanged — необязательно: вызывается после принятия или отклонения роли (обновить меню и доступ)
export default function AdminAdminsPage({ onRolesChanged }) {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const currentUid = useSelector(selectUser)?.uid ?? null;
  const [state, setState] = useState({ phase: 'loading', loadError: null, access: 'none', admins: [], config: null });
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(null); // { kind, uid } — действие без окна (отмена, отклонение)
  const [actionError, setActionError] = useState(null); // { code }
  const [dialog, setDialog] = useState(null); // { kind, target, name, uid, busy, error }
  const requestRef = useRef(0);
  useDocumentTitle(`${t('admin.nav.admins')} — ${t('admin.title')}`);

  /** Загрузка. silent — данные остаются на экране, пока идёт повторная загрузка */
  const load = useCallback(async ({ silent = false } = {}) => {
    const request = ++requestRef.current;
    if (silent) setRefreshing(true);
    else setState((s) => ({ ...s, phase: 'loading', loadError: null }));
    try {
      const status = await fetchOwnerStatus();
      let next = { access: status.access, admins: [], config: status.config };
      if (status.access === 'owner') {
        try {
          const { admins, config } = await fetchAdmins();
          next = { access: 'owner', admins, config };
        } catch (err) {
          // Роль владельца перешла к другому между двумя запросами — показываем как обычному администратору
          if (err?.code !== 'not-owner') throw err;
          next = { access: 'none', admins: [], config: null };
        }
      }
      if (request === requestRef.current) setState({ phase: 'ready', loadError: null, ...next });
    } catch (err) {
      if (request === requestRef.current) setState((s) => ({ ...s, phase: 'error', loadError: err?.code || 'failed' }));
    } finally {
      if (request === requestRef.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    return () => {
      requestRef.current += 1; // страницу закрыли — ответ уже не нужен
    };
  }, [load]);

  const view = useMemo(() => buildAdminsView({ ...state, currentUid }), [state, currentUid]);
  const locked = Boolean(busy) || Boolean(dialog?.busy) || refreshing || state.phase !== 'ready';

  const done = (message, params) => dispatch(notify({ message, params }));
  /** После ошибки, которую повторять бессмысленно, данные на экране устарели — перечитываем */
  const reloadIfStale = (code) => {
    if (!isRetryableAdminError(code)) load({ silent: true });
  };

  // ---------- Добавление администратора ----------

  const handleGrant = async ({ uid, label }) => {
    if (locked) return false;
    setActionError(null);
    setBusy({ kind: 'grant', uid });
    try {
      await grantAdmin(uid, { label });
      done('admin.admins.grant.done', { name: label || shortUid(uid) });
      await load({ silent: true });
      return true;
    } catch (err) {
      const code = err?.code || 'failed';
      setActionError({ code });
      reloadIfStale(code);
      return false;
    } finally {
      setBusy(null);
    }
  };

  // ---------- Действия через окно подтверждения: отзыв, предложение роли, принятие ----------

  const openDialog = (kind, target) => {
    if (locked) return;
    setActionError(null);
    setDialog({ kind, target, name: target.name, uid: target.uid, busy: false, error: null });
  };

  const closeDialog = useCallback(() => setDialog((d) => (d?.busy ? d : null)), []);

  const handleDialogConfirm = async () => {
    if (!dialog || dialog.busy) return;
    const { kind, target } = dialog;
    setDialog((d) => ({ ...d, busy: true, error: null }));
    try {
      if (kind === 'revoke') {
        await revokeAdmin(target.uid);
        done('admin.admins.revoke.done', { name: target.name });
      } else if (kind === 'offer') {
        await offerOwnerTransfer(target.uid);
        done('admin.admins.transfer.offerDone', { name: target.name });
      } else if (kind === 'accept') {
        // expectedOwnerUid — владелец, которого видел кандидат: если он сменился, сервис вернёт offer-stale
        await acceptOwnerTransfer(target.uid);
        done('admin.admins.transfer.acceptDone');
        onRolesChanged?.();
      }
      setDialog(null);
      await load({ silent: true });
    } catch (err) {
      const code = err?.code || 'failed';
      setDialog((d) => (d ? { ...d, busy: false, error: code } : d));
      reloadIfStale(code);
    }
  };

  // ---------- Действия без окна: отмена и отклонение предложения ----------

  const runSimple = async (kind, action, message) => {
    if (locked) return;
    setActionError(null);
    setBusy({ kind });
    try {
      await action();
      done(message);
      await load({ silent: true });
    } catch (err) {
      const code = err?.code || 'failed';
      setActionError({ code });
      reloadIfStale(code);
    } finally {
      setBusy(null);
    }
  };

  return (
    <AdminAdminsView
      phase={state.phase}
      loadError={state.loadError}
      view={view}
      currentUid={currentUid}
      refreshing={refreshing}
      busy={busy}
      actionError={actionError}
      dialog={dialog}
      onRefresh={() => {
        setActionError(null);
        load({ silent: state.phase === 'ready' });
      }}
      onGrant={handleGrant}
      onRevokeRequest={(admin) => openDialog('revoke', { uid: admin.uid, name: adminMentionName(admin) })}
      onOfferRequest={(admin) => openDialog('offer', { uid: admin.uid, name: adminMentionName(admin) })}
      onAcceptRequest={() => view.incoming && openDialog('accept', { uid: view.incoming.ownerUid, name: view.incoming.name })}
      onCancelOffer={() =>
        runSimple('cancel', () => cancelOwnerTransfer(view.outgoing?.uid), 'admin.admins.transfer.cancelDone')
      }
      onDecline={() =>
        runSimple(
          'decline',
          async () => {
            await declineOwnerTransfer();
            onRolesChanged?.();
          },
          'admin.admins.transfer.declineDone',
        )
      }
      onDialogConfirm={handleDialogConfirm}
      onDialogCancel={closeDialog}
      onCloseError={() => setActionError(null)}
    />
  );
}
