import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { selectProducts } from '../../features/products/productsSlice';
import { matchesSearch } from '../../utils/filterProducts';
import { formatPrice } from '../../utils/format';
import { useClickOutside } from '../../hooks/useClickOutside';
import Icon from './Icon';

/**
 * Поиск по названию и бренду.
 * Пока пользователь печатает — показываем до 5 подсказок.
 * Enter — переход в каталог с результатами (/catalog?q=...).
 */
export default function SearchBar({ onDone, id = 'site-search' }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const products = useSelector(selectProducts);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);
  const close = useCallback(() => setOpen(false), []);
  useClickOutside(wrapperRef, close, open);

  // Если пользователь в каталоге с ?q=..., показываем этот запрос в поле
  useEffect(() => {
    if (location.pathname === '/catalog') {
      setQuery(new URLSearchParams(location.search).get('q') || '');
    }
  }, [location.pathname, location.search]);

  const suggestions = useMemo(() => {
    if (query.trim().length < 2) return [];
    return products.filter((p) => matchesSearch(p, query)).slice(0, 5);
  }, [products, query]);

  const handleSubmit = (event) => {
    event.preventDefault();
    const q = query.trim();
    setOpen(false);
    navigate(q ? `/catalog?q=${encodeURIComponent(q)}` : '/catalog');
    onDone?.();
  };

  const goToProduct = (productId) => {
    setOpen(false);
    setQuery('');
    navigate(`/product/${productId}`);
    onDone?.();
  };

  return (
    <div className="search" ref={wrapperRef}>
      <form className="search__form" role="search" onSubmit={handleSubmit}>
        <label htmlFor={id} className="visually-hidden">
          {t('search.label')}
        </label>
        <Icon name="search" size={18} className="search__icon" />
        <input
          id={id}
          type="search"
          value={query}
          placeholder={t('search.placeholder')}
          autoComplete="off"
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
        />
      </form>
      {open && query.trim().length >= 2 && (
        <div className="search__dropdown">
          {suggestions.length === 0 ? (
            <p className="search__empty">{t('search.noResults')}</p>
          ) : (
            <ul>
              {suggestions.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => goToProduct(p.id)}>
                    <img src={p.image} alt="" width="40" height="44" />
                    <span className="search__name">
                      {p.name}
                      <small>{p.brand}</small>
                    </span>
                    <span className="search__price">{formatPrice(p.price)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="search__all" onClick={handleSubmit}>
            {t('search.showAll')} <Icon name="arrowRight" size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
