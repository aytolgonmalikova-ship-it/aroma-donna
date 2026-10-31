import { useTranslation } from 'react-i18next';
import Icon from '../common/Icon';

const BENEFITS = [
  { icon: 'sparkle', key: 'selection' },
  { icon: 'truck', key: 'delivery' },
  { icon: 'gift', key: 'packaging' },
  { icon: 'shield', key: 'payment' },
];

/** Преимущества магазина (4 карточки) */
export default function BenefitsSection() {
  const { t } = useTranslation();
  return (
    <section className="section benefits" aria-label={t('benefits.title')}>
      <div className="container benefits__grid">
        {BENEFITS.map((b) => (
          <div key={b.key} className="benefit">
            <span className="benefit__icon">
              <Icon name={b.icon} size={24} />
            </span>
            <h3>{t(`benefits.${b.key}.title`)}</h3>
            <p>{t(`benefits.${b.key}.text`)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
