import { useTranslation } from 'react-i18next';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import HeroBanner from '../components/home/HeroBanner';
import BenefitsSection from '../components/home/BenefitsSection';
import FeaturedProducts from '../components/home/FeaturedProducts';
import FragranceCategories from '../components/home/FragranceCategories';
import NewArrivals from '../components/home/NewArrivals';
import QuizPromo from '../components/home/QuizPromo';
import ReviewsSection from '../components/home/ReviewsSection';

export default function HomePage() {
  const { t } = useTranslation();
  useDocumentTitle(t('home.metaTitle'));
  return (
    <>
      <HeroBanner />
      <BenefitsSection />
      <FeaturedProducts />
      <FragranceCategories />
      <NewArrivals />
      <QuizPromo />
      <ReviewsSection />
    </>
  );
}
