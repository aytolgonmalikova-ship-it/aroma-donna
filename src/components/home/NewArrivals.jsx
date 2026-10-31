import { useMemo } from 'react';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { selectProducts } from '../../features/products/productsSlice';
import ProductsShowcase from './ProductsShowcase';

/** Новинки: товары с признаком isNew */
export default function NewArrivals() {
  const { t } = useTranslation();
  const products = useSelector(selectProducts);
  const items = useMemo(() => products.filter((p) => p.isNew).slice(0, 4), [products]);
  return (
    <ProductsShowcase
      id="new-title"
      eyebrow={t('home.newEyebrow')}
      title={t('home.newTitle')}
      products={items}
      linkTo="/catalog?sort=new"
      tone="tinted"
    />
  );
}
