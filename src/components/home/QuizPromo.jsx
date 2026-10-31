import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Icon from '../common/Icon';

/** Блок-приглашение пройти тест подбора аромата */
export default function QuizPromo() {
  const { t } = useTranslation();
  return (
    <section className="section">
      <div className="container">
        <div className="quiz-promo">
          <div>
            <p className="eyebrow">{t('home.quizEyebrow')}</p>
            <h2 className="section__title">{t('home.quizTitle')}</h2>
            <p>{t('home.quizText')}</p>
          </div>
          <Link to="/quiz" className="btn btn--primary btn--lg">
            <Icon name="sparkle" size={18} /> {t('home.quizCta')}
          </Link>
        </div>
      </div>
    </section>
  );
}
