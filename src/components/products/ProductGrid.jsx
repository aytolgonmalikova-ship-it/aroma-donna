import ProductCard from './ProductCard';

/** Сетка карточек товаров (адаптивная: 1–4 колонки в зависимости от ширины экрана) */
export default function ProductGrid({ products, columns = 4 }) {
  return (
    <div className={`product-grid product-grid--${columns}`}>
      {products.map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}
    </div>
  );
}
