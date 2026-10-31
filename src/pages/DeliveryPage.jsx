import { useTranslation } from 'react-i18next';
import PageHeader from '../components/common/PageHeader';
import Icon from '../components/common/Icon';
import DemoNotice from '../components/common/DemoNotice';
import { DELIVERY_METHODS } from '../utils/promo';
import { formatPrice } from '../utils/format';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

const ICONS = { courier: 'truck', pickup: 'pin', regions: 'gift' };

export default function DeliveryPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('delivery.title'));
  return (
    <>
      <PageHeader title={t('delivery.title')} subtitle={t('delivery.subtitle')} crumbs={[{ label: t('nav.delivery') }]} />
      <div className="container section--tight info-page">
        <h2 className="section__title section__title--sm">{t('delivery.methodsTitle')}</h2>
        <div className="info-cards">
          {Object.entries(DELIVERY_METHODS).map(([method, data]) => (
            <article key={method} className="card info-card">
              <span className="benefit__icon">
                <Icon name={ICONS[method]} size={22} />
              </span>
              <h3>{t(`delivery.methods.${method}.title`)}</h3>
              <p>{t(`delivery.methods.${method}.text`)}</p>
              <p className="info-card__price">
                {data.price === 0 ? t('cart.free') : formatPrice(data.price)}
                {data.freeFrom > 0 && <small> · {t('delivery.freeFrom', { amount: formatPrice(data.freeFrom) })}</small>}
              </p>
            </article>
          ))}
        </div>

        <h2 className="section__title section__title--sm">{t('delivery.paymentTitle')}</h2>
        <div className="info-cards info-cards--2">
          <article className="card info-card">
            <h3>{t('checkout.paymentMethods.cashOnDelivery')}</h3>
            <p>{t('delivery.cashText')}</p>
          </article>
          <article className="card info-card">
            <h3>{t('checkout.paymentMethods.cardOnDelivery')}</h3>
            <p>{t('delivery.cardText')}</p>
          </article>
        </div>
        <DemoNotice variant="warning">{t('delivery.noOnline')}</DemoNotice>

        <h2 className="section__title section__title--sm">{t('delivery.returnTitle')}</h2>
        <p className="info-page__text">{t('delivery.returnText')}</p>
      </div>
    </>
  );
}
