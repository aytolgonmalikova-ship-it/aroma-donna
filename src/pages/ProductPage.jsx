import { useParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import Breadcrumbs from '../components/common/Breadcrumbs';
import LoadingSpinner from '../components/common/LoadingSpinner';
import EmptyState from '../components/common/EmptyState';
import ProductGallery from '../components/products/ProductGallery';
import ProductInfo from '../components/products/ProductInfo';
import RelatedProducts from '../components/products/RelatedProducts';
import { selectProductById, selectProductsStatus } from '../features/products/productsSlice';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

/** Страница товара: /product/:id. id берётся из адреса с помощью useParams */
export default function ProductPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const status = useSelector(selectProductsStatus);
  const product = useSelector(selectProductById(id));
  useDocumentTitle(product ? `${product.name} — ${product.brand}` : t('product.notFoundTitle'));

  if (status === 'idle' || status === 'loading') return <LoadingSpinner />;

  if (!product) {
    return (
      <div className="container section">
        <EmptyState
          headingLevel="h1"
          icon="search"
          title={t('product.notFoundTitle')}
          text={t('product.notFoundText')}
          actionLabel={t('nav.catalog')}
          actionTo="/catalog"
        />
      </div>
    );
  }

  return (
    <>
      <div className="container product-page">
        <Breadcrumbs
          items={[
            { label: t('nav.catalog'), to: '/catalog' },
            { label: t(`categories.${product.category}`), to: `/catalog?category=${product.category}` },
            { label: product.name },
          ]}
        />
        <div className="product-page__grid">
          <ProductGallery key={`g-${product.id}`} product={product} />
          {/* key сбрасывает выбранный объём и количество при переходе к другому товару */}
          <ProductInfo key={product.id} product={product} />
        </div>
      </div>
      <RelatedProducts product={product} />
    </>
  );
}
