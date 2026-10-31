import { useTranslation } from 'react-i18next';
import PageHeader from '../components/common/PageHeader';
import ContactForm from '../components/forms/ContactForm';
import Icon from '../components/common/Icon';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

export default function ContactsPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('contacts.title'));
  const info = [
    { icon: 'pin', label: t('contacts.address'), value: t('contacts.addressValue') },
    { icon: 'clock', label: t('contacts.hours'), value: t('contacts.hoursValue') },
    { icon: 'phone', label: t('contacts.phone'), value: t('contacts.phoneValue') },
    { icon: 'mail', label: t('contacts.email'), value: t('contacts.emailValue') },
  ];
  return (
    <>
      <PageHeader title={t('contacts.title')} subtitle={t('contacts.subtitle')} crumbs={[{ label: t('nav.contacts') }]} />
      <div className="container section--tight contacts">
        <aside className="contacts__info card">
          <h2 className="section__title section__title--sm">{t('contacts.infoTitle')}</h2>
          <ul>
            {info.map((row) => (
              <li key={row.icon}>
                <span className="contacts__icon">
                  <Icon name={row.icon} size={20} />
                </span>
                <span>
                  <small>{row.label}</small>
                  {row.value}
                </span>
              </li>
            ))}
          </ul>
          <p className="form__note">{t('contacts.infoDemo')}</p>
        </aside>
        <section className="card contacts__form" aria-labelledby="contact-form-title">
          <h2 id="contact-form-title" className="section__title section__title--sm">
            {t('contacts.formTitle')}
          </h2>
          <ContactForm />
        </section>
      </div>
    </>
  );
}
