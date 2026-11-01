import { useCallback, useEffect, useState } from 'react';
import { checkIsAdmin, isAdminAvailable } from '../services/adminService';

/**
 * Проверяет, является ли текущий пользователь администратором.
 * status: 'loading' | 'admin' | 'denied' | 'unavailable' (демо-режим) | 'error'
 */
export function useAdminAccess(user) {
  const uid = user?.uid;
  const [result, setResult] = useState({ uid: null, status: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!isAdminAvailable || !uid) return undefined;
    let cancelled = false;
    setResult({ uid, status: 'loading' });
    checkIsAdmin(uid)
      .then((isAdmin) => !cancelled && setResult({ uid, status: isAdmin ? 'admin' : 'denied' }))
      .catch(() => !cancelled && setResult({ uid, status: 'error' }));
    return () => {
      cancelled = true;
    };
  }, [uid, reloadKey]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  if (!isAdminAvailable) return { status: 'unavailable', retry };
  if (!uid) return { status: 'denied', retry };
  // Пока не проверили именно этого пользователя — показываем загрузку (не прошлый результат)
  return { status: result.uid === uid ? result.status : 'loading', retry };
}
