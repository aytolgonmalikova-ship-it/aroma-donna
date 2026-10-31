import { useTranslation } from 'react-i18next';

/** Статус наличия: в наличии / осталось мало / нет в наличии (демонстрационные данные) */
export default function AvailabilityBadge({ status }) {
  const { t } = useTranslation();
  return <span className={`availability availability--${status}`}>{t(`availability.${status}`)}</span>;
}
