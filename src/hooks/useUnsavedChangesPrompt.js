import { useEffect } from 'react';

/**
 * Предупреждение о несохранённых изменениях, пока when === true:
 * - закрытие или перезагрузка вкладки — стандартный вопрос браузера (beforeunload);
 * - переход по ссылке внутри сайта (меню, «Назад к списку») — window.confirm(message).
 *
 * Ссылки перехватываются на document в фазе погружения, до обработчика Link из React Router.
 * Кнопку «Назад» браузера так не перехватить: для этого нужен data router (useBlocker),
 * а приложение использует BrowserRouter.
 */
export function useUnsavedChangesPrompt(when, message) {
  useEffect(() => {
    if (!when) return undefined;

    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = ''; // нужно старым браузерам, чтобы показать вопрос
    };

    const onClick = (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = e.target instanceof Element ? e.target.closest('a[href]') : null;
      if (!link || (link.target && link.target !== '_self') || link.hasAttribute('download')) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      if (!window.confirm(message)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [when, message]);
}
