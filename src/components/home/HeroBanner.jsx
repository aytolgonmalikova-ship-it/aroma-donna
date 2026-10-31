import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Icon from '../common/Icon';

/** Большой баннер на главной: заголовок, текст, две кнопки и фотография флакона на фоне */
export default function HeroBanner() {
  const { t } = useTranslation();
  return (
    <section className="hero">
      {/* Мобильный баннер (≤768px): текст и кнопка уже нарисованы на картинке, поэтому весь баннер — ссылка в каталог */}
      <Link to="/catalog" className="hero__mobile" aria-label={t('hero.ctaCatalog')}>
        <img
          src="/images/hero/banner-mobile.png"
          alt=""
          width="1024"
          height="1536"
          className="hero__mobile-img"
        />
      </Link>
      {/* Кнопки квиза нет на мобильной картинке — выводим её под баннером */}
      <div className="container hero__mobile-actions">
        <Link to="/quiz" className="btn btn--outline btn--lg">
          <Icon name="sparkle" size={18} /> {t('hero.ctaQuiz')}
        </Link>
        <ul className="hero__stats" aria-hidden="true">
          <li><strong>24</strong> {t('hero.statScents')}</li>
          <li><strong>6</strong> {t('hero.statBrands')}</li>
          <li><strong>3</strong> {t('hero.statLanguages')}</li>
        </ul>
      </div>
      <div className="container hero__inner">
        <div className="hero__content">
          <p className="eyebrow">{t('hero.eyebrow')}</p>
          <h1 className="hero__title">
            {t('hero.titleStart')} <em>{t('hero.titleAccent')}</em>
          </h1>
          <p className="hero__text">{t('hero.text')}</p>
          <div className="hero__actions">
            <Link to="/catalog" className="btn btn--primary btn--lg">
              {t('hero.ctaCatalog')} <Icon name="arrowRight" size={18} />
            </Link>
            <Link to="/quiz" className="btn btn--outline btn--lg">
              <Icon name="sparkle" size={18} /> {t('hero.ctaQuiz')}
            </Link>
          </div>
          <ul className="hero__stats">
            <li><strong>24</strong> {t('hero.statScents')}</li>
            <li><strong>6</strong> {t('hero.statBrands')}</li>
            <li><strong>3</strong> {t('hero.statLanguages')}</li>
          </ul>
        </div>
        {/* Фото флакона задано фоном .hero (pages.css); блок держит для него место в сетке */}
        <div className="hero__visual" aria-hidden="true" />
      </div>
    </section>
  );
}
