import { useMemo } from 'react';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { selectProducts } from '../../features/products/productsSlice';
import ProductsShowcase from './ProductsShowcase';

/** Популярные товары: 4 товара с наибольшей популярностью */
export default function FeaturedProducts() {
  const { t } = useTranslation();
  const products = useSelector(selectProducts);
  const featured = useMemo(
    () => [...products].sort((a, b) => b.popularity - a.popularity).slice(0, 4),
    [products],
  );
  return (
    <ProductsShowcase
      id="featured-title"
      eyebrow={t('home.featuredEyebrow')}
      title={t('home.featuredTitle')}
      products={featured}
      linkTo="/catalog?sort=popular"
    />
  );
}
