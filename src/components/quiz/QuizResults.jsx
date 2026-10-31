import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ProductImage from '../common/ProductImage';
import DemoNotice from '../common/DemoNotice';
import Icon from '../common/Icon';
import { useShopActions } from '../../hooks/useShopActions';
import { formatPrice, localized } from '../../utils/format';

/** Результаты теста: рекомендованные ароматы с процентом совпадения и причинами */
export default function QuizResults({ results, answers, onRestart }) {
  const { t, i18n } = useTranslation();
  const { addProductToCart } = useShopActions();
  const [best, ...others] = results;

  return (
    <div className="quiz-results">
      <div className="quiz-results__head">
        <p className="eyebrow">{t('quiz.resultsEyebrow')}</p>
        <h2 className="section__title">{t('quiz.resultsTitle')}</h2>
        <p className="quiz-results__summary">
          {t('quiz.yourChoice')}: {t(`categories.${answers.category}`)} · {t(`families.${answers.family}`)} ·{' '}
          {answers.notes.map((n) => t(`notes.items.${n}`)).join(', ')} · {t(`intensity.${answers.intensity}`)}
        </p>
      </div>

      <DemoNotice>{t('quiz.rulesNotice')}</DemoNotice>

      {best && (
        <article className="quiz-best card">
          <Link to={`/product/${best.product.id}`} className="quiz-best__image">
            <ProductImage src={best.product.image} alt={best.product.name} />
          </Link>
          <div className="quiz-best__info">
            <span className="match-badge">
              {t('quiz.match', { percent: best.match })}
            </span>
            <p className="product-card__brand">{best.product.brand}</p>
            <h3 className="quiz-best__name">{best.product.name}</h3>
            <p>{localized(best.product.description, i18n.resolvedLanguage)}</p>
            {best.reasons.length > 0 && (
              <ul className="quiz-reasons">
                {best.reasons.map((r) => (
                  <li key={r}>
                    <Icon name="check" size={16} /> {t(`quiz.reasons.${r}`)}
                  </li>
                ))}
              </ul>
            )}
            <p className="quiz-best__price">
              {t('product.from')} {formatPrice(best.product.price)}
            </p>
            <div className="quiz-best__actions">
              <Link to={`/product/${best.product.id}`} className="btn btn--primary">
                {t('quiz.viewProduct')}
              </Link>
              <button
                type="button"
                className="btn btn--outline"
                onClick={() => addProductToCart(best.product)}
                disabled={best.product.availability === 'outOfStock'}
              >
                <Icon name="cart" size={16} /> {t('product.addToCart')}
              </button>
            </div>
          </div>
        </article>
      )}

      {others.length > 0 && (
        <>
          <h3 className="quiz-results__more">{t('quiz.alsoLike')}</h3>
          <div className="quiz-others">
            {others.map(({ product, match }) => (
              <Link key={product.id} to={`/product/${product.id}`} className="quiz-other card">
                <ProductImage src={product.image} alt={product.name} />
                <span className="match-badge match-badge--sm">{t('quiz.match', { percent: match })}</span>
                <span className="product-card__brand">{product.brand}</span>
                <strong>{product.name}</strong>
                <span>{formatPrice(product.price)}</span>
              </Link>
            ))}
          </div>
        </>
      )}

      <div className="quiz-results__actions">
        <button type="button" className="btn btn--outline" onClick={onRestart}>
          <Icon name="refresh" size={16} /> {t('quiz.restart')}
        </button>
        <Link to="/catalog" className="btn btn--ghost">
          {t('nav.catalog')} <Icon name="arrowRight" size={16} />
        </Link>
      </div>
    </div>
  );
}
