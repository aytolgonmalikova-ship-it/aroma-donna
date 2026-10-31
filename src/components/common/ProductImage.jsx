import { useState } from 'react';

const FALLBACK = '/images/products/placeholder.svg';

/**
 * Изображение товара с запасным вариантом:
 * если картинка не загрузилась (onError), показываем заглушку AROMA DONNA.
 */
export default function ProductImage({ src, alt, className = '', eager = false }) {
  const [failed, setFailed] = useState(false);
  return (
    <img
      className={className}
      src={failed || !src ? FALLBACK : src}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      width="400"
      height="440"
      onError={() => setFailed(true)}
    />
  );
}
