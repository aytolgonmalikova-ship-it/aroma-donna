import { useEffect, useState } from 'react';

const matchesNow = (query) =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;

/**
 * Совпадает ли медиазапрос сейчас (например, '(max-width: 959px)'); обновляется при изменении ширины окна.
 * Без браузера (отрисовка на сервере, тесты) — false.
 */
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => matchesNow(query));

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia(query);
    const onChange = () => setMatches(media.matches);
    onChange();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
