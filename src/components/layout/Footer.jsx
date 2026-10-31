import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Logo from './Logo';
import Icon from '../common/Icon';
import { FaWhatsapp, FaInstagram } from 'react-icons/fa';

/** Подвал сайта: навигация, информация для покупателей, контакты, пометка о демо-проекте */
export default function Footer() {
  const { t } = useTranslation();
  const year = new Date().getFullYear();
  return (
    <footer className="footer">
      <div className="container footer__grid">
        <div className="footer__brand">
          <Logo />
          <p>{t('footer.about')}</p>
        </div>
        <div>
          <h3 className="footer__title">{t('footer.shop')}</h3>
          <ul>
            <li><Link to="/catalog">{t('nav.catalog')}</Link></li>
            <li><Link to="/catalog?category=women">{t('categories.women')}</Link></li>
            <li><Link to="/catalog?category=men">{t('categories.men')}</Link></li>
            <li><Link to="/catalog?category=unisex">{t('categories.unisex')}</Link></li>
            <li><Link to="/quiz">{t('nav.quiz')}</Link></li>
          </ul>
        </div>
        <div>
          <h3 className="footer__title">{t('footer.customers')}</h3>
          <ul>
            <li><Link to="/delivery">{t('nav.delivery')}</Link></li>
            <li><Link to="/faq">{t('nav.faq')}</Link></li>
            <li><Link to="/reviews">{t('nav.reviews')}</Link></li>
            <li><Link to="/about">{t('nav.about')}</Link></li>
            <li><Link to="/account">{t('nav.account')}</Link></li>
          </ul>
        </div>
        <div>
          <h3 className="footer__title">{t('footer.contacts')}</h3>
          <ul className="footer__contacts">
            <li><Icon name="pin" size={16} /> {t('contacts.addressValue')}</li>
            <li><Icon name="clock" size={16} /> {t('contacts.hoursValue')}</li>
            <li><Icon name="mail" size={16} /> <Link to="/contacts">{t('footer.writeUs')}</Link></li>
            <li>
              <a
                href="https://wa.me/996504889991"
                target="_blank"
                rel="noopener noreferrer"
                className="whatsapp-link"
               >
                <FaWhatsapp size={20} color="#25D366" />
                WhatsApp
              </a>
              </li>
              <li>
              <a
                href="https://www.instagram.com/aroma__donna/"
                target="_blank"
                rel="noopener noreferrer"
                className="instagram-link"
              >
                <FaInstagram size={20} color="#E1306C" />
                Instagram
              </a>
             </li>
            </ul>
        </div>
      </div>
      <div className="container footer__bottom">
        <p>© {year} AROMA DONNA. {t('footer.rights')}</p>
        <p className="footer__demo">{t('footer.demo')}</p>
      </div>
    </footer>
  );
}
