import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FaWhatsapp, FaInstagram, FaCommentDots } from 'react-icons/fa';
import Icon from '../common/Icon';
import { useMediaQuery } from '../../hooks/useMediaQuery';

/** Контакты магазина — те же ссылки, что в подвале (Footer.jsx) */
const CONTACTS = [
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    href: 'https://wa.me/996504889991',
    Icon: FaWhatsapp,
    labelKey: 'floatingContacts.whatsapp',
  },
  {
    id: 'instagram',
    name: 'Instagram',
    href: 'https://www.instagram.com/aroma__donna/',
    Icon: FaInstagram,
    labelKey: 'floatingContacts.instagram',
  },
];

/** На этих страницах на телефоне кнопки скрываются, чтобы не перекрывать корзину и оформление заказа */
const HIDE_ON_MOBILE = ['/cart', '/checkout'];

/** Телефон: одна кнопка, раскрывающая меню контактов (тот же @media, что в components.css) */
export const CONTACTS_COMPACT_QUERY = '(max-width: 768px)';
const MENU_ID = 'floating-contacts-menu';

/** Отступ от низа страницы, где кнопки снова видны: под ними место в подвале (.footer padding-bottom) */
const NEAR_BOTTOM = 140;
const NEAR_TOP = 80;

/**
 * Плавающие кнопки быстрой связи в правом нижнем углу экрана.
 * Компьютер (шире 768px) — две кнопки, WhatsApp и Instagram, как раньше.
 * Телефон (C3.2) — одна кнопка «Быстрая связь» (aria-expanded) раскрывает меню из двух ссылок с подписями.
 * Меню закрывается повторным нажатием, нажатием вне меню, Escape, прокруткой и после перехода по ссылке;
 * если фокус был в меню, он возвращается на кнопку. Пока страницу прокручивают вниз, кнопка уходит за край
 * и возвращается при прокрутке вверх, в начале страницы и у подвала — так она не закрывает содержимое.
 */
export default function FloatingContacts() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const hideOnMobile = HIDE_ON_MOBILE.includes(pathname);
  const compact = useMediaQuery(CONTACTS_COMPACT_QUERY);
  const [away, setAway] = useState(false);
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const launcherRef = useRef(null);

  /** Закрыть меню; фокус — на кнопку, если он был внутри меню (или если просят явно) */
  const close = useCallback((focusLauncher = false) => {
    setOpen(false);
    const root = rootRef.current;
    if (focusLauncher || (root && root.contains(document.activeElement) && document.activeElement !== launcherRef.current)) {
      launcherRef.current?.focus();
    }
  }, []);

  useEffect(() => {
    setAway(false); // новая страница — кнопки на месте, меню закрыто
    setOpen(false);
    let lastY = window.scrollY;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const y = window.scrollY;
        const nearBottom = window.innerHeight + y >= document.documentElement.scrollHeight - NEAR_BOTTOM;
        if (y < NEAR_TOP || nearBottom) setAway(false);
        else if (y > lastY + 4) setAway(true);
        else if (y < lastY - 4) setAway(false);
        lastY = y;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, [pathname]);

  // Открытое меню: Escape, нажатие вне меню и прокрутка закрывают его
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close(true);
      }
    };
    const onPointer = (e) => {
      if (!rootRef.current?.contains(e.target)) close();
    };
    const onScroll = () => close();
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('scroll', onScroll);
    };
  }, [open, close]);

  // Окно стало шире 768px — меню не нужно
  useEffect(() => {
    if (!compact) setOpen(false);
  }, [compact]);

  const classes = [
    'floating-contacts',
    compact && 'floating-contacts--compact',
    open && 'is-open',
    hideOnMobile && 'floating-contacts--hide-mobile',
    away && !open && 'floating-contacts--away',
  ]
    .filter(Boolean)
    .join(' ');

  if (!compact) {
    return (
      <nav className={classes} aria-label={t('floatingContacts.title')}>
        {CONTACTS.map((contact) => (
          <a
            key={contact.id}
            href={contact.href}
            target="_blank"
            rel="noopener noreferrer"
            className={`floating-contacts__btn floating-contacts__btn--${contact.id}`}
            aria-label={t(contact.labelKey)}
          >
            <contact.Icon className="floating-contacts__icon" aria-hidden="true" />
            <span className="floating-contacts__tooltip" aria-hidden="true">
              {contact.name}
            </span>
          </a>
        ))}
      </nav>
    );
  }

  return (
    <nav
      ref={rootRef}
      className={classes}
      aria-label={t('floatingContacts.title')}
      onBlur={(e) => {
        // Фокус ушёл из меню клавишей Tab — меню закрывается
        if (open && !rootRef.current?.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={launcherRef}
        type="button"
        className="floating-contacts__launcher"
        aria-label={t('floatingContacts.title')}
        aria-expanded={open}
        aria-controls={MENU_ID}
        onClick={() => (open ? close(true) : setOpen(true))}
      >
        {open ? <Icon name="close" size={22} /> : <FaCommentDots className="floating-contacts__icon" aria-hidden="true" />}
      </button>
      <ul id={MENU_ID} className="floating-contacts__menu" hidden={!open}>
        {CONTACTS.map((contact) => (
          <li key={contact.id}>
            <a
              href={contact.href}
              target="_blank"
              rel="noopener noreferrer"
              className={`floating-contacts__item floating-contacts__item--${contact.id}`}
              aria-label={t(contact.labelKey)}
              onClick={() => close(true)}
            >
              <span className="floating-contacts__item-icon" aria-hidden="true">
                <contact.Icon />
              </span>
              {contact.name}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
