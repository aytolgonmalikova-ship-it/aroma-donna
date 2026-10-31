import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageHeader from '../components/common/PageHeader';
import FAQAccordion from '../components/info/FAQAccordion';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

// Ключи вопросов; тексты вопросов и ответов — в файлах переводов (faq.items.*)
const FAQ_KEYS = ['original', 'choose', 'concentration', 'delivery', 'payment', 'promo', 'return', 'account', 'quiz', 'storage'];

export default function FAQPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('faq.title'));
  const items = FAQ_KEYS.map((key) => ({ q: t(`faq.items.${key}.q`), a: t(`faq.items.${key}.a`) }));
  return (
    <>
      <PageHeader title={t('faq.title')} subtitle={t('faq.subtitle')} crumbs={[{ label: t('nav.faq') }]} />
      <div className="container section--tight faq-page">
        <FAQAccordion items={items} />
        <p className="faq-page__more">
          {t('faq.more')} <Link to="/contacts">{t('faq.contactUs')}</Link>
        </p>
      </div>
    </>
  );
}
