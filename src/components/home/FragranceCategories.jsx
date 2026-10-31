import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

// Подборки ароматов: каждая ведёт в каталог с уже включённым фильтром
const COLLECTIONS = [
  { family: 'floral', image: 'jasmin-de-minuit' },
  { family: 'oriental', image: 'ambre-oriental' },
  { family: 'woody', image: 'cedar-noir' },
  { family: 'gourmand', image: 'vanilla-cashmere' },
  { family: 'citrus', image: 'citrus-soleil' },
  { family: 'aquatic', image: 'issyk-kul-blue' },
];

export default function FragranceCategories() {
  const { t } = useTranslation();
  return (
    <section className="section" aria-labelledby="collections-title">
      <div className="container">
        <div className="section__head">
          <div>
            <p className="eyebrow">{t('home.collectionsEyebrow')}</p>
            <h2 id="collections-title" className="section__title">
              {t('home.collectionsTitle')}
            </h2>
          </div>
        </div>
        <div className="collections">
          {COLLECTIONS.map((c) => (
            <Link key={c.family} to={`/catalog?family=${c.family}`} className={`collection collection--${c.family}`}>
              <img src={`/images/products/${c.image}.jpg`} alt="" loading="lazy" />
              <span className="collection__body">
                <span className="collection__name">{t(`families.${c.family}`)}</span>
                <span className="collection__text">{t(`familyDescriptions.${c.family}`)}</span>
              </span>
            </Link>
          ))}
        </div>
        <div className="gender-links">
          {['women', 'men', 'unisex'].map((c) => (
            <Link key={c} to={`/catalog?category=${c}`} className="gender-link">
              {t(`categories.${c}`)}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
