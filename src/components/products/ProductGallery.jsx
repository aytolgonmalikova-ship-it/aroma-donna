import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import ProductImage from '../common/ProductImage';

/**
 * Галерея на странице товара: основное фото + миниатюры.
 * Для демонстрации используем изображение флакона и два «ракурса» (разный фон/масштаб).
 */
export default function ProductGallery({ product }) {
  const { t } = useTranslation();
  const views = [
    { id: 'front', className: '' },
    { id: 'close', className: 'gallery__img--zoom' },
    { id: 'mood', className: 'gallery__img--mood' },
  ];
  const [active, setActive] = useState(0);

  return (
    <div className="gallery">
      <div className="gallery__main">
        <ProductImage
          src={product.image}
          alt={`${product.brand} ${product.name}`}
          className={`gallery__img ${views[active].className}`}
          eager
        />
      </div>
      <div className="gallery__thumbs" role="tablist" aria-label={t('product.gallery')}>
        {views.map((view, index) => (
          <button
            key={view.id}
            type="button"
            role="tab"
            aria-selected={index === active}
            className={`gallery__thumb ${index === active ? 'is-active' : ''}`}
            onClick={() => setActive(index)}
            aria-label={`${t('product.photo')} ${index + 1}`}
          >
            <ProductImage src={product.image} alt="" className={`gallery__img ${view.className}`} />
          </button>
        ))}
      </div>
    </div>
  );
}
