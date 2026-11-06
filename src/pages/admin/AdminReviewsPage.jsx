import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import Icon from '../../components/common/Icon';
import EmptyState from '../../components/common/EmptyState';
import ErrorMessage from '../../components/common/ErrorMessage';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import RatingStars from '../../components/common/RatingStars';
import DeleteReviewDialog from '../../components/admin/DeleteReviewDialog';
import { notify } from '../../features/notifications/notificationsSlice';
import { deleteReview, fetchAllReviews, setReviewStatus } from '../../services/adminService';
import { ADMIN_REVIEWS_LIMIT } from '../../services/adminReviewsStore';
import {
  DEFAULT_REVIEW_FILTERS,
  REVIEW_ACTION_STATUS,
  REVIEW_FILTER_STATUSES,
  REVIEW_RATINGS,
  REVIEW_SORTS,
  applyReviewFilters,
  applyReviewStatus,
  countReviewsByStatus,
  filterAdminReviews,
  hasActiveReviewFilters,
  isLongReview,
  parseReviewListParams,
  removeReview,
  reviewActions,
  shouldReloadAfterError,
  toReviewListParams,
} from '../../utils/adminReviews';
import { formatDate } from '../../utils/format';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';

const KNOWN_LANGS = ['ru', 'ky', 'en'];
const ACTION_BUTTON = {
  approve: 'btn--primary',
  reject: 'btn--outline',
  pending: 'btn--ghost',
  delete: 'btn--outline admin-review__delete',
};

/**
 * Раздел «Отзывы» (этап E4): модерация отзывов покупателей.
 *
 * Загружаются все отзывы любого статуса (fetchAllReviews, не больше ADMIN_REVIEWS_LIMIT), фильтры,
 * поиск и сортировка — в браузере (utils/adminReviews.js), поэтому новые индексы Firestore не нужны.
 * Параметры хранятся в адресе (?status=&q=&rating=&sort=); по умолчанию — ожидающие модерации.
 *
 * Смена статуса — setReviewStatus с загруженным статусом строки: если отзыв уже промодерировали
 * в другом окне, сервис вернёт conflict и ничего не запишет. После любого действия список
 * перечитывается из Firestore (без спиннера на всю страницу). Одновременно выполняется только одно действие.
 * Удалить навсегда можно только отклонённый отзыв — через окно с JSON-копией и подтверждением.
 * Текст отзыва выводится как обычный текст React (без HTML).
 */
export default function AdminReviewsPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage;
  const dispatch = useDispatch();
  const [data, setData] = useState(null); // null — загрузка; { reviews, invalidIds, limited }
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(null); // { id, action } — действие, которое выполняется сейчас
  const [actionError, setActionError] = useState(null); // { name, code }
  const [deleteTarget, setDeleteTarget] = useState(null); // отзыв в окне удаления
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set()); // id развёрнутых длинных отзывов
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => parseReviewListParams(searchParams), [searchParams]);
  const requestRef = useRef(0); // номер последнего запроса: ответ устаревшего запроса не применяется
  const headingRef = useRef(null);
  useDocumentTitle(`${t('admin.nav.reviews')} — ${t('admin.title')}`);

  /** Загрузка списка. silent — список остаётся на экране, пока идёт повторная загрузка */
  const load = useCallback(({ silent = false } = {}) => {
    const request = ++requestRef.current;
    setError(null);
    if (silent) setRefreshing(true);
    else setData(null);
    return fetchAllReviews()
      .then((res) => request === requestRef.current && setData(res))
      .catch((err) => request === requestRef.current && setError(err.code || 'failed'))
      .finally(() => request === requestRef.current && setRefreshing(false));
  }, []);

  useEffect(() => {
    load();
    return () => {
      requestRef.current += 1; // страницу закрыли — ответ уже не нужен
    };
  }, [load]);

  const setFilters = (next) => setSearchParams(toReviewListParams({ ...filters, ...next }), { replace: true });
  // Сброс поиска и оценки; статус и сортировка остаются
  const resetFilters = () => setFilters({ q: DEFAULT_REVIEW_FILTERS.q, rating: DEFAULT_REVIEW_FILTERS.rating });

  const reviews = useMemo(() => data?.reviews ?? [], [data]);
  const counts = useMemo(() => countReviewsByStatus(reviews), [reviews]);
  const inStatus = useMemo(() => filterAdminReviews(reviews, { status: filters.status }), [reviews, filters.status]);
  const visible = useMemo(() => applyReviewFilters(reviews, filters), [reviews, filters]);
  const hasFilters = hasActiveReviewFilters(filters);
  const locked = Boolean(busy) || deleting || refreshing; // любое действие блокирует остальные

  const handleStatus = async (review, action) => {
    if (locked) return;
    const status = REVIEW_ACTION_STATUS[action];
    setBusy({ id: review.id, action });
    setActionError(null);
    try {
      const res = await setReviewStatus(review.id, status, review.status);
      // Сразу показываем новый статус; точное время решения придёт с повторной загрузкой
      setData((d) => applyReviewStatus(d, review.id, status, res.changed ? new Date().toISOString() : undefined));
      dispatch(
        notify({
          type: res.changed ? 'success' : 'info',
          message: res.changed ? `admin.reviews.done.${status}` : 'admin.reviews.unchanged',
          params: { name: review.name },
        }),
      );
      await load({ silent: true });
    } catch (err) {
      const code = err.code || 'failed';
      setActionError({ name: review.name, code });
      // Отзыв промодерировали или удалили в другом окне — показываем актуальное состояние
      if (shouldReloadAfterError(code)) await load({ silent: true });
    } finally {
      setBusy(null);
    }
  };

  const openDelete = (review) => {
    if (locked) return;
    setActionError(null);
    setDeleteError(null);
    setDeleteTarget(review);
  };

  const closeDelete = useCallback(() => {
    setDeleteTarget(null);
    setDeleteError(null);
  }, []);

  const handleDelete = async () => {
    if (!deleteTarget || deleting) return;
    const review = deleteTarget;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteReview(review.id);
      setData((d) => removeReview(d, review.id));
      setDeleteTarget(null);
      dispatch(notify({ message: 'admin.reviews.delete.done', params: { name: review.name } }));
      // Кнопки «Удалить» больше нет — фокус на заголовок раздела, а не в никуда
      requestAnimationFrame(() => headingRef.current?.focus());
      load({ silent: true });
    } catch (err) {
      const code = err.code || 'failed';
      setDeleteError(code);
      if (shouldReloadAfterError(code)) load({ silent: true });
    } finally {
      setDeleting(false);
    }
  };

  const toggleExpanded = (id) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const renderAction = (review, action) => {
    const isBusy = busy?.id === review.id && busy.action === action;
    const label = isBusy ? t(`admin.reviews.busy.${action}`) : t(`admin.reviews.action.${action}`);
    return (
      <button
        key={action}
        type="button"
        className={`btn btn--sm ${ACTION_BUTTON[action]}`}
        onClick={() => (action === 'delete' ? openDelete(review) : handleStatus(review, action))}
        disabled={locked}
        aria-busy={isBusy || undefined}
        aria-label={t(`admin.reviews.actionLabel.${action}`, { name: review.name })}
        title={action === 'delete' ? t('admin.reviews.deleteOnlyRejected') : undefined}
      >
        {action === 'delete' && <Icon name="trash" size={14} />} {label}
      </button>
    );
  };

  const renderReview = (r) => {
    const long = isLongReview(r.text);
    const collapsed = long && !expanded.has(r.id);
    const textId = `admin-review-text-${r.id}`;
    const rowBusy = busy?.id === r.id || (deleting && deleteTarget?.id === r.id);
    return (
      <li
        key={r.id}
        className={`admin-review admin-review--${r.status} card${rowBusy ? ' is-busy' : ''}`}
        aria-busy={rowBusy || undefined}
      >
        <div className="admin-review__head">
          <h2 className="admin-review__author">{r.name}</h2>
          <span className={`admin-badge admin-badge--${r.status}`} title={t(`admin.reviews.statusHint.${r.status}`)}>
            {t(`admin.reviews.statusBadge.${r.status}`)}
          </span>
        </div>
        <div className="admin-review__meta">
          <RatingStars value={r.rating} showValue={false} />
          {r.createdAt ? (
            <time dateTime={r.createdAt}>{formatDate(r.createdAt, lang)}</time>
          ) : (
            <span>{t('admin.reviews.noDate')}</span>
          )}
          <span>
            {t('admin.reviews.col.lang')}:{' '}
            {KNOWN_LANGS.includes(r.lang) ? t(`admin.reviews.lang.${r.lang}`) : t('admin.reviews.lang.unknown')}
          </span>
        </div>
        <p id={textId} className={`admin-review__text${collapsed ? ' is-collapsed' : ''}`}>
          {r.text}
        </p>
        {long && (
          <button
            type="button"
            className="admin-review__toggle"
            onClick={() => toggleExpanded(r.id)}
            aria-expanded={!collapsed}
            aria-controls={textId}
          >
            {collapsed ? t('admin.reviews.showMore') : t('admin.reviews.showLess')}
          </button>
        )}
        <div className="admin-review__footer">
          <span className="admin-review__moderated">
            {r.moderatedAt
              ? t('admin.reviews.moderatedAt', { date: formatDate(r.moderatedAt, lang) })
              : t('admin.reviews.notModerated')}
          </span>
          <div className="admin-review__actions">{reviewActions(r.status).map((action) => renderAction(r, action))}</div>
        </div>
      </li>
    );
  };

  const select = (key, label, values, optionLabel, allLabel) => (
    <label className="admin-toolbar__sort">
      <span>{label}</span>
      <select
        className="field__control"
        value={filters[key] ?? ''}
        onChange={(e) => {
          const v = e.target.value;
          setFilters({ [key]: key === 'rating' ? (v ? Number(v) : null) : v });
        }}
      >
        {allLabel && <option value="">{allLabel}</option>}
        {values.map((v) => (
          <option key={v} value={v}>
            {optionLabel(v)}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    // .admin-reviews — правила раздела для узких экранов (admin.css)
    <div className="admin-reviews">
      <div className="admin-page__head admin-page__head--row">
        <div>
          <h1 ref={headingRef} tabIndex={-1}>
            {t('admin.nav.reviews')}
          </h1>
          <p>{t('admin.reviews.subtitle')}</p>
        </div>
        <div className="admin-page__actions">
          <button
            type="button"
            className="btn btn--outline btn--sm"
            onClick={() => {
              setActionError(null);
              load({ silent: Boolean(data) });
            }}
            disabled={(!data && !error) || locked}
            aria-busy={refreshing || undefined}
          >
            <Icon name="refresh" size={16} /> {refreshing ? t('admin.reviews.refreshing') : t('admin.reviews.refresh')}
          </button>
        </div>
      </div>

      <p className="admin-reviews__note">{t('admin.reviews.publicNote')}</p>

      <div className="admin-filters" role="group" aria-label={t('admin.reviews.filterLabel')}>
        {REVIEW_FILTER_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            className={`admin-filter${filters.status === s ? ' is-active' : ''}`}
            aria-pressed={filters.status === s}
            onClick={() => setFilters({ status: s })}
          >
            {t(`admin.reviews.status.${s}`)}
            {data && <span className="admin-filter__count">{counts[s]}</span>}
          </button>
        ))}
      </div>

      {actionError && (
        <div className="admin-reviews__message" role="alert">
          <Icon name="alert" size={18} />
          <p>
            {t(`admin.reviews.actionErrors.${actionError.code}`, {
              name: actionError.name,
              defaultValue: t('admin.reviews.actionErrors.failed', { name: actionError.name }),
            })}
          </p>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setActionError(null)}
            aria-label={t('admin.reviews.closeMessage')}
            title={t('admin.reviews.closeMessage')}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      )}

      {error && (
        <ErrorMessage
          message={t(`admin.reviews.errors.${error}`, t('admin.reviews.errors.failed'))}
          onRetry={() => load({ silent: Boolean(data) })}
        />
      )}
      {!error && !data && <LoadingSpinner />}

      {data?.limited && (
        <div className="admin-reviews__warning" role="status">
          <Icon name="info" size={18} />
          <p>{t('admin.reviews.limited', { count: ADMIN_REVIEWS_LIMIT })}</p>
        </div>
      )}

      {data?.invalidIds.length > 0 && (
        <div className="admin-reviews__warning" role="alert">
          <Icon name="alert" size={18} />
          <div>
            <strong>{t('admin.reviews.damagedTitle', { count: data.invalidIds.length })}</strong>
            <p>{t('admin.reviews.damagedText')}</p>
            <ul>
              {data.invalidIds.map((id) => (
                <li key={id}>
                  <code>{id}</code>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {data && reviews.length === 0 && (
        <EmptyState icon="star" title={t('admin.reviews.empty')} text={t('admin.reviews.emptyText')} />
      )}

      {data && reviews.length > 0 && (
        <>
          <div className="admin-toolbar">
            <label className="admin-toolbar__search">
              <span className="visually-hidden">{t('admin.reviews.searchLabel')}</span>
              <Icon name="search" size={16} />
              <input
                type="search"
                className="field__control"
                placeholder={t('admin.reviews.searchPlaceholder')}
                value={filters.q}
                onChange={(e) => setFilters({ q: e.target.value })}
              />
            </label>
            {select(
              'rating',
              t('admin.reviews.ratingLabel'),
              REVIEW_RATINGS,
              (v) => t('admin.reviews.ratingOption', { rating: v }),
              t('admin.reviews.ratingAll'),
            )}
            {select('sort', t('admin.reviews.sortLabel'), REVIEW_SORTS, (v) => t(`admin.reviews.sort.${v}`))}
            {hasFilters && (
              <button type="button" className="btn btn--ghost btn--sm" onClick={resetFilters}>
                <Icon name="close" size={14} /> {t('admin.reviews.reset')}
              </button>
            )}
            <span className="admin-toolbar__count" role="status">
              {refreshing
                ? t('admin.reviews.refreshing')
                : t('admin.reviews.found', { count: visible.length, total: inStatus.length })}
            </span>
          </div>

          {visible.length === 0 &&
            (hasFilters ? (
              <EmptyState
                icon="search"
                title={t('admin.reviews.emptyFiltered')}
                text={t('admin.reviews.emptyFilteredText')}
                actionLabel={t('admin.reviews.reset')}
                onAction={resetFilters}
              />
            ) : (
              <EmptyState icon="star" title={t(`admin.reviews.emptyStatus.${filters.status}`)} />
            ))}

          {visible.length > 0 && <ul className="admin-reviews__list">{visible.map(renderReview)}</ul>}
        </>
      )}

      {deleteTarget && (
        <DeleteReviewDialog
          review={deleteTarget}
          deleting={deleting}
          error={deleteError}
          onConfirm={handleDelete}
          onCancel={closeDelete}
        />
      )}
    </div>
  );
}
