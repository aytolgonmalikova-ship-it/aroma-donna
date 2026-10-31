import { useEffect } from 'react';

/**
 * Вызывает handler при клике вне элемента ref или нажатии Escape.
 * Используется для закрытия выпадающих меню.
 */
export function useClickOutside(ref, handler, active = true) {
  useEffect(() => {
    if (!active) return undefined;
    const onPointer = (event) => {
      if (ref.current && !ref.current.contains(event.target)) handler();
    };
    const onKey = (event) => {
      if (event.key === 'Escape') handler();
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('touchstart', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('touchstart', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [ref, handler, active]);
}
