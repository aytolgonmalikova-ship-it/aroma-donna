import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FaWhatsapp, FaInstagram } from 'react-icons/fa';

/** Контакты магазина — те же ссылки, что в подвале (Footer.jsx) */
const CONTACTS = [
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    href: 'https://wa.me/996504889991',
    icon: <FaWhatsapp className="floating-contacts__icon" aria-hidden="true" />,
    labelKey: 'floatingContacts.whatsapp',
  },
  {
    id: 'instagram',
    name: 'Instagram',
    href: 'https://www.instagram.com/aroma__donna/',
    icon: <FaInstagram className="floating-contacts__icon" aria-hidden="true" />,
    labelKey: 'floatingContacts.instagram',
  },
];

/** На этих страницах на телефоне кнопки скрываются, чтобы не перекрывать корзину и оформление заказа */
const HIDE_ON_MOBILE = ['/cart', '/checkout'];

/** Плавающие кнопки быстрой связи в правом нижнем углу экрана */
export default function FloatingContacts() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const hideOnMobile = HIDE_ON_MOBILE.includes(pathname);

  return (
    <nav
      className={`floating-contacts${hideOnMobile ? ' floating-contacts--hide-mobile' : ''}`}
      aria-label={t('floatingContacts.title')}
    >
      {CONTACTS.map(({ id, name, href, icon, labelKey }) => (
        <a
          key={id}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={`floating-contacts__btn floating-contacts__btn--${id}`}
          aria-label={t(labelKey)}
        >
          {icon}
          <span className="floating-contacts__tooltip" aria-hidden="true">{name}</span>
        </a>
      ))}
    </nav>
  );
}
