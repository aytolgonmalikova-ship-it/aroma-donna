import { useMemo } from 'react';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { selectProducts } from '../../features/products/productsSlice';
import ProductGrid from './ProductGrid';

/**
 * Похожие товары: то же семейство ароматов или та же категория.
 * Сортируем по «похожести» (семейство важнее категории), берём 4 товара.
 */
export default function RelatedProducts({ product }) {
  const { t } = useTranslation();
  const products = useSelector(selectProducts);

  const related = useMemo(
    () =>
      products
        .filter((p) => p.id !== product.id)
        .map((p) => ({
          p,
          score:
            (p.fragranceFamily === product.fragranceFamily ? 2 : 0) +
            (p.category === product.category ? 1 : 0) +
            (p.brand === product.brand ? 0.5 : 0),
        }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score || b.p.popularity - a.p.popularity)
        .slice(0, 4)
        .map((x) => x.p),
    [products, product],
  );

  if (related.length === 0) return null;
  return (
    <section className="section" aria-labelledby="related-title">
      <div className="container">
        <h2 id="related-title" className="section__title">
          {t('product.related')}
        </h2>
        <ProductGrid products={related} />
      </div>
    </section>
  );
}
