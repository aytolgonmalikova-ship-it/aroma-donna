import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageHeader from '../components/common/PageHeader';
import BenefitsSection from '../components/home/BenefitsSection';
import DemoNotice from '../components/common/DemoNotice';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

export default function AboutPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('about.title'));
  const values = ['quality', 'care', 'style'];
  return (
    <>
      <PageHeader title={t('about.title')} subtitle={t('about.subtitle')} crumbs={[{ label: t('nav.about') }]} />
      <div className="container section--tight about">
        <div className="about__intro">
          <div>
            <h2 className="section__title">{t('about.storyTitle')}</h2>
            <p>{t('about.story1')}</p>
            <p>{t('about.story2')}</p>
            <Link to="/catalog" className="btn btn--primary">
              {t('hero.ctaCatalog')}
            </Link>
          </div>
          <div className="about__visual" aria-hidden="true">
            <img src="/images/products/iris-lumiere.jpg" alt="" />
            <img src="/images/products/ala-too-breeze.jpg" alt="" />
          </div>
        </div>
        <div className="about__values">
          {values.map((v) => (
            <div key={v} className="card about__value">
              <h3>{t(`about.values.${v}.title`)}</h3>
              <p>{t(`about.values.${v}.text`)}</p>
            </div>
          ))}
        </div>
        <DemoNotice>{t('about.demo')}</DemoNotice>
      </div>
      <BenefitsSection />
    </>
  );
}
