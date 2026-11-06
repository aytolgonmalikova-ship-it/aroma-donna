import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { fetchOwnerStatus } from '../services/adminService';

/**
 * Роль вошедшего администратора в управлении администраторами (Блок 2).
 * Источник — существующий fetchOwnerStatus (adminAdminsStore.js): своей проверки ролей здесь нет.
 * access: 'loading' | 'owner' | 'pending' | 'none' | 'error'; config — adminConfig/primary для владельца и кандидата
 * (кому и от кого предложение), иначе null.
 * Один запрос на всю админ-панель; refresh() — после действий, меняющих роль (принятие или отклонение).
 * Это удобство интерфейса (меню, доступ к странице): данные защищают правила Firestore.
 */
// Экспорт — для тестов (значение без запроса к Firebase); в приложении — только OwnerAccessProvider
export const OwnerAccessContext = createContext({ access: 'loading', config: null, refresh: () => {} });

export function OwnerAccessProvider({ uid, children }) {
  const [state, setState] = useState({ uid: null, access: 'loading', config: null });
  const [reloadKey, setReloadKey] = useState(0);
  const requestRef = useRef(0);

  useEffect(() => {
    if (!uid) return undefined;
    const request = ++requestRef.current;
    fetchOwnerStatus()
      .then((status) => request === requestRef.current && setState({ uid, access: status.access, config: status.config }))
      .catch(() => request === requestRef.current && setState({ uid, access: 'error', config: null }));
    return () => {
      requestRef.current += 1;
    };
  }, [uid, reloadKey]);

  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);
  // Пока не проверили именно этого пользователя — «загрузка» (не результат прошлого пользователя)
  const current = uid && state.uid === uid;
  const value = { access: current ? state.access : 'loading', config: current ? state.config : null, refresh };
  return <OwnerAccessContext.Provider value={value}>{children}</OwnerAccessContext.Provider>;
}

export const useOwnerAccess = () => useContext(OwnerAccessContext);
