import { Link } from 'react-router-dom';

/** Логотип магазина — ссылка на главную */
export default function Logo({ onClick }) {
  return (
    <Link to="/" className="logo" aria-label="AROMA DONNA" onClick={onClick}>
      <span className="logo__mark" aria-hidden="true">
        <svg viewBox="0 0 32 32" width="30" height="30">
          <rect x="12" y="2" width="8" height="6" rx="1.5" fill="currentColor" opacity=".9" />
          <rect x="6" y="9" width="20" height="21" rx="6" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path d="M11 22c2-5 8-5 10 0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </span>
      <span className="logo__text">
        AROMA <em>DONNA</em>
      </span>
    </Link>
  );
}
