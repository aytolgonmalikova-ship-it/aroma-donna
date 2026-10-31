import { useEffect } from 'react';

/** Меняет заголовок вкладки браузера: «Каталог — AROMA DONNA» */
export function useDocumentTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} — AROMA DONNA` : 'AROMA DONNA';
  }, [title]);
}
