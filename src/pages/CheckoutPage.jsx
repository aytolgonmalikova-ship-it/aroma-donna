import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import PageHeader from '../components/common/PageHeader';
import CheckoutForm from '../components/forms/CheckoutForm';
import DemoCardPaymentModal from '../components/forms/DemoCardPaymentModal';
import CartSummary from '../components/cart/CartSummary';
import EmptyState from '../components/common/EmptyState';
import LoadingSpinner from '../components/common/LoadingSpinner';
import DemoNotice from '../components/common/DemoNotice';
import ProductImage from '../components/common/ProductImage';
import { clearCart, markPromoCodeUsed, selectCartItems, selectCartTotals } from '../features/cart/cartSlice';
import { selectProductsStatus } from '../features/products/productsSlice';
import { selectAuthState } from '../features/user/userSlice';
import { notify } from '../features/notifications/notificationsSlice';
import { createOrder } from '../services/orderService';
import { calcDelivery } from '../utils/promo';
import { createOrderId, formatPrice } from '../utils/format';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

/**
 * Оформление заказа (демонстрационное).
 * Порядок: проверка данных покупателя →
 *   • «Наличными курьеру»: сразу сохраняем заказ со статусом оплаты «Ожидает оплаты»;
 *   • «Банковской картой»: открываем окно DEMO-оплаты, и только после её успеха
 *     сохраняем заказ со статусом «Оплачен (DEMO)».
 * Далее: сохранение (orderService) → Telegram → страница успеха → очистка корзины.
 * Деньги не списываются. Данные карты остаются внутри DemoCardPaymentModal
 * и в объект заказа не попадают.
 */
export default function CheckoutPage() {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const items = useSelector(selectCartItems);
  const { subtotal, discount, total, promoCode } = useSelector(selectCartTotals);
  const status = useSelector(selectProductsStatus); console.log('Статус товаров', status);
  const { current: user, mode } = useSelector(selectAuthState);
  const [deliveryMethod, setDeliveryMethod] = useState('courier');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [pendingOrder, setPendingOrder] = useState(null); // данные покупателя, ожидающие DEMO-оплаты
  const submittedRef = useRef(false); // чтобы после очистки корзины не показать «корзина пуста»
  useDocumentTitle(t('checkout.title'));

  const delivery = calcDelivery(deliveryMethod, total);
  const grandTotal = total + delivery;

  if (status !== 'succeeded') {
  console.log('Страница ждёт товары. Текущий статус:', status);
  return <LoadingSpinner />;
}

  if (items.length === 0 && !submittedRef.current) {
    return (
      <div className="container section">
        <EmptyState
          headingLevel="h1"
          icon="cart"
          title={t('checkout.emptyTitle')}
          text={t('checkout.emptyText')}
          actionLabel={t('cart.goToCatalog')}
          actionTo="/catalog"
        />
      </div>
    );
  }

  // Форма уже проверила данные покупателя
  const handleFormSubmit = (values) => {
    setSubmitError('');
    if (values.payment === 'cardDemo') {
      setPendingOrder(values); // открываем окно банковской карты
      return;
    }
    placeOrder(values, 'awaitingPayment');
  };

  const placeOrder = async (values, paymentStatus) => {
    setSubmitting(true);
    setSubmitError('');
    // В заказ попадают только нужные для доставки данные (минимум личной информации)
    const order = {
      id: createOrderId(),
      createdAt: new Date().toISOString(),
      userId: user?.uid || null,
      items: items.map((i) => ({
        id: i.product.id,
        name: i.product.name,
        brand: i.product.brand,
        volume: i.volume,
        price: i.price,
        quantity: i.quantity,
      })),
      subtotal,
      discount,
      promoCode: discount > 0 ? promoCode : null,
      delivery,
      total: grandTotal,
      customer: {
        name: values.name.trim(),
        lastName: values.lastName.trim(),
        phone: values.phone.trim(),
        email: values.email.trim(),
      },
      shipping: {
        method: values.delivery,
        region: values.delivery === 'pickup' ? null : values.region,
        city: values.delivery === 'pickup' ? null : values.city,
        address: values.delivery === 'pickup' ? null : values.address.trim(),
        comment: values.comment.trim(),
      },
      payment: values.payment,
      paymentStatus, // 'paidDemo' — «Оплачен (DEMO)», 'awaitingPayment' — «Ожидает оплаты»
    };
    try {
      const saved = await createOrder(order, user);
      try {
  const response = await fetch('/api/order', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(saved),
  });

  if (!response.ok) {
    console.error('Не удалось отправить заказ в Telegram');
  }
} catch (error) {
  console.error('Ошибка отправки в Telegram:', error);
}
      submittedRef.current = true;
      if (saved.promoCode) dispatch(markPromoCodeUsed(saved.promoCode));
      navigate(`/order-success/${saved.id}`, { state: { order: saved }, replace: true });
      dispatch(clearCart());
      dispatch(notify({ message: 'notify.orderPlaced', params: { id: saved.id } }));
    } catch {
      setSubmitError(t('checkout.submitError'));
      setSubmitting(false);
    }
  };
  // Вызывается окном оплаты только после успешной DEMO-оплаты (данные карты сюда не передаются)
  const handleDemoPaymentSuccess = () => {
    const values = pendingOrder;
    setPendingOrder(null);
    if (values) placeOrder(values, 'paidDemo');
  };

  return (
    <>
      <PageHeader
        title={t('checkout.title')}
        crumbs={[{ label: t('cart.title'), to: '/cart' }, { label: t('checkout.title') }]}
      />
      <div className="container section--tight">
        <DemoNotice variant="warning">
          {mode === 'firebase' && user ? t('checkout.firebaseNotice') : t('checkout.demoNotice')}
        </DemoNotice>
        {!user && (
          <p className="checkout__guest">
            {t('checkout.guestNote')} <Link to="/login" state={{ from: '/checkout' }}>{t('auth.loginLink')}</Link>
          </p>
        )}
        {submitError && (
          <p className="form__error" role="alert">
            {submitError}
          </p>
        )}
        {pendingOrder && (
          <DemoCardPaymentModal
            amountLabel={formatPrice(grandTotal)}
            onSuccess={handleDemoPaymentSuccess}
            onCancel={() => setPendingOrder(null)}
          />
        )}

        <div className="cart-layout">
          <CheckoutForm
            initialValues={{ name: user?.name || '', email: user?.email || '' }}
            deliveryMethod={deliveryMethod}
            onDeliveryChange={setDeliveryMethod}
            onSubmit={handleFormSubmit}
            onCancel={() => navigate('/cart')}
            submitting={submitting}
            totalLabel={formatPrice(grandTotal)}
          />
          <CartSummary delivery={delivery} showCheckout={false} showPromo={false}>
            <ul className="summary__items">
              {items.map((item) => (
                <li key={item.key}>
                  <ProductImage src={item.product.image} alt="" />
                  <span>
                    {item.product.name}
                    <small>
                      {item.volume} {t('product.ml')} × {item.quantity}
                    </small>
                  </span>
                  <strong>{formatPrice(item.lineTotal)}</strong>
                </li>
              ))}
            </ul>
            <Link to="/cart" className="summary__edit">
              {t('checkout.editCart')}
            </Link>
          </CartSummary>
        </div>
      </div>
    </>
  );
}
