import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchReviewStats, fetchReviews, isReviewsAvailable, REVIEWS_PAGE_SIZE } from '../services/reviewsService';

/**
 * Загрузка отзывов из Firestore: первая страница, «Показать ещё», средняя оценка.
 * status: 'loading' | 'ready' | 'error' | 'unavailable' (Firebase не настроен)
 */
export function useReviews({ pageSize = REVIEWS_PAGE_SIZE, withStats = true } = {}) {
  const [reviews, setReviews] = useState([]);
  const [status, setStatus] = useState(isReviewsAvailable ? 'loading' : 'unavailable');
  const [error, setError] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(null);
  const [stats, setStats] = useState(null);
  const cursorRef = useRef(null);
  const aliveRef = useRef(true);

  const load = useCallback(async () => {
    if (!isReviewsAvailable) return;
    setStatus('loading');
    setError(null);
    try {
      const [page, summary] = await Promise.all([
        fetchReviews({ pageSize }),
        // Средняя оценка необязательна: если не загрузилась, список всё равно показываем
        withStats ? fetchReviewStats().catch(() => null) : null,
      ]);
      if (!aliveRef.current) return;
      cursorRef.current = page.cursor;
      setReviews(page.reviews);
      setHasMore(page.hasMore);
      setStats(summary);
      setStatus('ready');
    } catch (err) {
      if (!aliveRef.current) return;
      setError(err.code);
      setStatus('error');
    }
  }, [pageSize, withStats]);

  const loadMore = useCallback(async () => {
    if (!cursorRef.current) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await fetchReviews({ cursor: cursorRef.current, pageSize });
      if (!aliveRef.current) return;
      cursorRef.current = page.cursor || cursorRef.current;
      // Защита от дублей, если новый отзыв уже был добавлен в начало списка
      setReviews((list) => [...list, ...page.reviews.filter((r) => !list.some((x) => x.id === r.id))]);
      setHasMore(page.hasMore);
    } catch (err) {
      if (aliveRef.current) setMoreError(err.code);
    } finally {
      if (aliveRef.current) setLoadingMore(false);
    }
  }, [pageSize]);

  /** Показывает только что отправленный отзыв сразу, без повторной загрузки */
  const addLocal = useCallback((review) => {
    setReviews((list) => [review, ...list]);
    setStatus('ready');
    setStats((s) => {
      if (!s) return s;
      const count = s.count + 1;
      return { count, average: ((s.average || 0) * s.count + review.rating) / count };
    });
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    load();
    return () => {
      aliveRef.current = false;
    };
  }, [load]);

  return { reviews, status, error, hasMore, loadingMore, moreError, stats, reload: load, loadMore, addLocal };
}
