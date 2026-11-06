import { useTranslation } from 'react-i18next';
import Icon from '../common/Icon';
import EmptyState from '../common/EmptyState';
import ErrorMessage from '../common/ErrorMessage';
import LoadingSpinner from '../common/LoadingSpinner';
import AdminMemberCard from './AdminMemberCard';
import AdminGrantForm from './AdminGrantForm';
import AdminConfirmDialog from './AdminConfirmDialog';
import OwnerTransferNotice from './OwnerTransferNotice';
import { adminErrorKey, adminMentionName } from '../../utils/adminAdmins';

/**
 * Представление страницы «Администраторы» (крупный блок 1): только отрисовка по готовым данным,
 * без обращений к сервису — их делает AdminAdminsPage. Поэтому все состояния можно проверить отрисовкой.
 *
 * phase: 'loading' | 'error' | 'ready'; loadError — код ошибки загрузки;
 * view — buildAdminsView(): canManage, members, outgoing, incoming;
 * busy — { kind, uid } выполняемого действия (все кнопки заблокированы) или null;
 * actionError — { code } последней ошибки действия; dialog — { kind, name, uid, busy, error } или null;
 * on* — обработчики. Кнопок без обработчика здесь нет.
 */
export default function AdminAdminsView({
  phase,
  loadError,
  view,
  currentUid,
  refreshing = false,
  busy = null,
  actionError = null,
  dialog = null,
  onRefresh,
  onGrant,
  onRevokeRequest,
  onOfferRequest,
  onCancelOffer,
  onAcceptRequest,
  onDecline,
  onDialogConfirm,
  onDialogCancel,
  onCloseError,
}) {
  const { t } = useTranslation();
  const locked = Boolean(busy) || Boolean(dialog?.busy) || refreshing || phase !== 'ready';
  const isBusy = (kind, uid) => busy?.kind === kind && (uid === undefined || busy.uid === uid);

  const renderMemberActions = ({ admin, revoke, offer }) => {
    const name = adminMentionName(admin);
    const parts = [];
    if (offer.allowed) {
      parts.push(
        <button
          key="offer"
          type="button"
          className="btn btn--outline btn--sm"
          onClick={() => onOfferRequest(admin)}
          disabled={locked}
          aria-label={t('admin.admins.transfer.offerActionLabel', { name })}
        >
          <Icon name="shield" size={14} /> {t('admin.admins.transfer.offerAction')}
        </button>,
      );
    }
    if (revoke.allowed) {
      parts.push(
        <button
          key="revoke"
          type="button"
          className="btn btn--outline btn--sm admin-review__delete"
          onClick={() => onRevokeRequest(admin)}
          disabled={locked}
          aria-label={t('admin.admins.revoke.actionLabel', { name })}
        >
          <Icon name="trash" size={14} /> {t('admin.admins.revoke.action')}
        </button>,
      );
    } else if (revoke.reason) {
      parts.push(
        <p key="blocked" className="admin-muted admin-muted--inline admin-admins__blocked">
          {t(`admin.admins.revoke.blocked.${revoke.reason}`)}
        </p>,
      );
    }
    return parts.length ? parts : null;
  };

  return (
    <div className="admin-admins">
      <div className="admin-page__head admin-page__head--row">
        <div>
          <h1>{t('admin.nav.admins')}</h1>
          <p>{t('admin.admins.subtitle')}</p>
        </div>
        <div className="admin-page__actions">
          <button
            type="button"
            className="btn btn--outline btn--sm"
            onClick={onRefresh}
            disabled={phase === 'loading' || locked}
            aria-busy={refreshing || undefined}
          >
            <Icon name="refresh" size={16} /> {refreshing ? t('admin.admins.refreshing') : t('admin.admins.refresh')}
          </button>
        </div>
      </div>

      {phase === 'loading' && <LoadingSpinner label={t('admin.admins.loading')} />}
      {phase === 'error' && <ErrorMessage message={t(adminErrorKey(loadError))} onRetry={onRefresh} />}

      {actionError && (
        <div className="admin-reviews__message admin-admins__message" role="alert">
          <Icon name="alert" size={18} />
          <p>{t(adminErrorKey(actionError.code))}</p>
          <button
            type="button"
            className="icon-btn"
            onClick={onCloseError}
            aria-label={t('admin.admins.closeMessage')}
            title={t('admin.admins.closeMessage')}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      )}

      {phase === 'ready' && view.incoming && (
        <OwnerTransferNotice direction="incoming" name={view.incoming.name} uid={view.incoming.ownerUid}>
          <button type="button" className="btn btn--primary btn--sm" onClick={onAcceptRequest} disabled={locked}>
            <Icon name="check" size={14} /> {t('admin.admins.transfer.acceptAction')}
          </button>
          <button
            type="button"
            className="btn btn--outline btn--sm"
            onClick={onDecline}
            disabled={locked}
            aria-busy={isBusy('decline') || undefined}
          >
            {isBusy('decline') ? t('admin.admins.transfer.declining') : t('admin.admins.transfer.declineAction')}
          </button>
        </OwnerTransferNotice>
      )}

      {phase === 'ready' && !view.canManage && (
        <EmptyState icon="shield" title={t('admin.admins.access.ownerOnlyTitle')} text={t('admin.admins.access.ownerOnlyText')} />
      )}

      {phase === 'ready' && view.canManage && (
        <>
          <p className="admin-reviews__note">{t('admin.admins.ownerOnlyNote')}</p>

          {view.outgoing && (
            <OwnerTransferNotice direction="outgoing" name={view.outgoing.name} uid={view.outgoing.uid}>
              <button
                type="button"
                className="btn btn--outline btn--sm"
                onClick={onCancelOffer}
                disabled={locked}
                aria-busy={isBusy('cancel') || undefined}
              >
                {isBusy('cancel') ? t('admin.admins.transfer.cancelling') : t('admin.admins.transfer.cancelAction')}
              </button>
            </OwnerTransferNotice>
          )}

          <AdminGrantForm onGrant={onGrant} disabled={locked} />

          <section className="admin-admins__list-section" aria-labelledby="admin-admins-list-title">
            <div className="admin-admins__list-head">
              <h2 id="admin-admins-list-title">{t('admin.admins.list.title')}</h2>
              <span className="admin-toolbar__count">{t('admin.admins.list.count', { count: view.members.length })}</span>
            </div>
            {view.members.length === 0 ? (
              <EmptyState icon="user" title={t('admin.admins.list.empty')} text={t('admin.admins.list.emptyText')} />
            ) : (
              <ul className="admin-reviews__list admin-admins__list">
                {view.members.map((member) => (
                  <li key={member.admin.uid}>
                    <AdminMemberCard admin={member.admin} currentUid={currentUid}>
                      {renderMemberActions(member)}
                    </AdminMemberCard>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {dialog && (
        <AdminConfirmDialog
          kind={dialog.kind}
          name={dialog.name}
          uid={dialog.uid}
          busy={dialog.busy}
          error={dialog.error}
          onConfirm={onDialogConfirm}
          onCancel={onDialogCancel}
        />
      )}
    </div>
  );
}
