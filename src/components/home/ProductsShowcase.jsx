import { Link } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { selectProductsStatus } from '../../features/products/productsSlice';
import ProductGrid from '../products/ProductGrid';
import LoadingSpinner from '../common/LoadingSpinner';
import CatalogLoadError from '../common/CatalogLoadError';
import Icon from '../common/Icon';
import { catalogView } from '../../utils/catalogStatus';

/** Общая обёртка секции с товарами: заголовок, ссылка «Смотреть все», сетка */
export default function ProductsShowcase({ id, eyebrow, title, products, linkTo, tone }) {
  const { t } = useTranslation();
  const view = catalogView(useSelector(selectProductsStatus));
  return (
    <section className={`section ${tone ? `section--${tone}` : ''}`} aria-labelledby={id}>
      <div className="container">
        <div className="section__head">
          <div>
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            <h2 id={id} className="section__title">
              {title}
            </h2>
          </div>
          {linkTo && (
            <Link to={linkTo} className="link-arrow">
              {t('common.viewAll')} <Icon name="arrowRight" size={16} />
            </Link>
          )}
        </div>
        {view === 'loading' ? (
          <LoadingSpinner />
        ) : view === 'error' ? (
          <CatalogLoadError />
        ) : (
          <ProductGrid products={products} />
        )}
      </div>
    </section>
  );
}
