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
import CatalogLoadError from '../components/common/CatalogLoadError';
import DemoNotice from '../components/common/DemoNotice';
import ProductImage from '../components/common/ProductImage';
import CheckoutReviewNotice from '../components/cart/CheckoutReviewNotice';
import {
  clearCart,
  markPromoCodeUsed,
  removeFromCart,
  selectCartEntries,
  selectCartHasUnavailable,
  selectCartItems,
  selectCartTotals,
} from '../features/cart/cartSlice';
import { catalogRefreshed, selectProductsSource, selectProductsStatus } from '../features/products/productsSlice';
import { selectAuthState } from '../features/user/userSlice';
import { notify } from '../features/notifications/notificationsSlice';
import { createDemoOrder, saveRecentOrder, submitOrder } from '../services/orderService';
import { fetchProductsApi } from '../services/productsApi';
import { buildOrder, reviewCheckout } from '../utils/checkoutReview';
import { buildOrderRequest, checkoutErrorMessage, nextAttempt, reviewFromServer } from '../utils/orderRequest';
import { calcDelivery } from '../utils/promo';
import { createOrderId, formatPrice } from '../utils/format';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { catalogView } from '../utils/catalogStatus';

/**
 * Оформление заказа (демонстрационное).
 * Порядок: проверка данных покупателя →
 *   • «Наличными курьеру»: сразу сохраняем заказ со статусом оплаты «Ожидает оплаты»;
 *   • «Банковской картой»: открываем окно DEMO-оплаты, и только после её успеха
 *     сохраняем заказ со статусом «Оплачен (DEMO)».
 * Далее: сохранение (orderService) → Telegram → страница успеха → очистка корзины.
 *
 * Перед окном оплаты и ещё раз прямо перед сохранением каталог заново читается из Firestore
 * (fetchProductsApi), и корзина сверяется с ним (utils/checkoutReview.js). Заказ собирается
 * только из этих свежих данных, а не из Redux или localStorage:
 *   • товар скрыт, удалён, нет в наличии или нет выбранного объёма — заказ не оформляется,
 *     покупатель может удалить такие позиции, выбрать другой объём в корзине или вернуться в каталог;
 *   • изменилась цена или итог — показываются новые цены и сумма, нужно подтвердить заказ ещё раз;
 *   • каталог витрины переключился на резервный (демо) или не загрузился — заказ не оформляется.
 * Свежий каталог попадает в Redux без очистки корзины (catalogRefreshed), чтобы сумма на странице
 * и в окне оплаты была актуальной.
 * Деньги не списываются. Данные карты остаются внутри DemoCardPaymentModal
 * и в объект заказа не попадают.
 */
export default function CheckoutPage() {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const items = useSelector(selectCartItems);
  const cartEntries = useSelector(selectCartEntries);
  const catalogSource = useSelector(selectProductsSource);
  const { total, promoCode } = useSelector(selectCartTotals);
  const hasUnavailable = useSelector(selectCartHasUnavailable);
  const view = catalogView(useSelector(selectProductsStatus));
  const { current: user, mode } = useSelector(selectAuthState);
  const [deliveryMethod, setDeliveryMethod] = useState('courier');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [pendingOrder, setPendingOrder] = useState(null); // данные покупателя, ожидающие DEMO-оплаты
  const [review, setReview] = useState(null); // итог проверки: { status: 'blocked' | 'confirm', values, … }
  const submittedRef = useRef(false); // чтобы после очистки корзины не показать «корзина пуста»
  // Попытка оформления: тот же requestId при повторе того же запроса (без второго заказа), новый — при изменении
  const attemptRef = useRef(null);
  useDocumentTitle(t('checkout.title'));

  const delivery = calcDelivery(deliveryMethod, total);
  const grandTotal = total + delivery;

  if (view === 'loading') return <LoadingSpinner />;

  if (view === 'error') {
    return (
      <div className="container section">
        <CatalogLoadError />
      </div>
    );
  }

  if (items.length === 0 && !submittedRef.current && !review) {
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

  // Выбранного объёма больше нет в каталоге — заказ с такими данными оформлять нельзя
  // (если проверка перед оформлением уже нашла проблему — показывается её сообщение)
  if (hasUnavailable && !submittedRef.current && !review) {
    return (
      <div className="container section">
        <EmptyState
          headingLevel="h1"
          icon="cart"
          title={t('checkout.fixCartTitle')}
          text={t('cart.fixVolumes')}
          actionLabel={t('checkout.editCart')}
          actionTo="/cart"
        />
      </div>
    );
  }

  /**
   * Свежий каталог из Firestore и сверка корзины с ним. Возвращает итог reviewCheckout со статусом ok
   * или null — тогда покупатель уже видит сообщение (ошибка, недоступные товары или новые цены).
   */
  const verifyCart = async (values) => {
    let fresh;
    try {
      fresh = await fetchProductsApi(0);
    } catch {
      setSubmitError(t('checkout.review.verifyError'));
      return null;
    }
    const result = reviewCheckout({
      cartItems: cartEntries,
      seenLines: items,
      seenGrandTotal: grandTotal,
      fresh,
      expectedSource: catalogSource,
      promoCode,
      deliveryMethod,
    });
    if (result.status === 'unverified') {
      // Резервный демо-каталог в Redux не попадает и заказ по нему не оформляется
      setSubmitError(t('checkout.review.verifyError'));
      return null;
    }
    dispatch(catalogRefreshed(fresh)); // страница и окно оплаты показывают актуальные цены
    if (result.status !== 'ok') {
      setReview({ ...result, values });
      return null;
    }
    setReview(null);
    return result;
  };

  // Форма уже проверила данные покупателя
  const handleFormSubmit = async (values) => {
    if (submitting) return;
    setSubmitError('');
    setSubmitting(true);
    const checked = await verifyCart(values);
    if (!checked) {
      setSubmitting(false);
      return;
    }
    if (values.payment === 'cardDemo') {
      setSubmitting(false);
      setPendingOrder(values); // открываем окно банковской карты с проверенной суммой
      return;
    }
    placeOrder(values, checked);
  };

  /**
   * Оформление заказа. checked — итог проверки, если она только что прошла (наличные);
   * после окна DEMO-оплаты проверка повторяется: за это время каталог мог измениться.
   * Firebase: заказ создаёт сервер (/api/order) — браузер отправляет позиции, способы доставки и оплаты,
   * данные покупателя и сумму, которую он видел; статус оплаты всегда «Ожидает оплаты» (ставит сервер).
   * Корзина очищается только после подтверждённого ответа сервера.
   */
  const placeOrder = async (values, checked = null) => {
    setSubmitting(true);
    setSubmitError('');
    const result = checked || (await verifyCart(values));
    if (!result) {
      setSubmitting(false);
      return;
    }

    // Демо-режим без Firebase: заказ только в этом браузере, как раньше
    if (mode !== 'firebase') {
      const order = buildOrder({
        id: createOrderId(),
        createdAt: new Date().toISOString(),
        user,
        lines: result.lines,
        totals: result.totals,
        promoCode,
        values,
        paymentStatus: 'awaitingPayment',
      });
      try {
        const saved = await createDemoOrder(order);
        submittedRef.current = true;
        if (saved.promoCode) dispatch(markPromoCodeUsed(saved.promoCode));
        navigate(`/order-success/${saved.id}`, { state: { order: saved }, replace: true });
        dispatch(clearCart());
        dispatch(notify({ message: 'notify.orderPlaced', params: { id: saved.id } }));
      } catch {
        setSubmitError(t('checkout.submitError'));
        setSubmitting(false);
      }
      return;
    }

    const request = buildOrderRequest({
      lines: result.lines,
      promoCode,
      deliveryMethod,
      values,
      expectedTotal: result.totals.grandTotal,
    });
    attemptRef.current = nextAttempt(attemptRef.current, request, () => crypto.randomUUID());
    try {
      const { order } = await submitOrder(request, { requestId: attemptRef.current.requestId, signedIn: Boolean(user) });
      attemptRef.current = null;
      submittedRef.current = true;
      saveRecentOrder(order); // только номер, сумма и состав — без телефона, e-mail и адреса
      if (order.promoCode) dispatch(markPromoCodeUsed(order.promoCode));
      navigate(`/order-success/${order.orderId}`, { state: { order }, replace: true });
      dispatch(clearCart());
      dispatch(notify({ message: 'notify.orderPlaced', params: { id: order.orderId } }));
    } catch (err) {
      setSubmitting(false);
      // Цены, сумма или наличие изменились: актуальные данные сервера и повторное подтверждение
      const serverReview = reviewFromServer(err, items);
      if (serverReview) {
        try {
          dispatch(catalogRefreshed(await fetchProductsApi(0)));
        } catch {
          /* каталог обновится при следующей проверке */
        }
        setReview({ ...serverReview, values });
        return;
      }
      const message = checkoutErrorMessage(err);
      setSubmitError(t(message.key, message.params));
    }
  };

  // Недоступные позиции — из корзины; затем покупатель снова подтверждает заказ
  const handleRemoveProblems = () => {
    review.problems.forEach((l) => dispatch(removeFromCart(l.key)));
    setReview(null);
  };

  // Повторное подтверждение по новым ценам: та же проверка ещё раз (цены могли снова измениться)
  const handleConfirmNewPrices = () => {
    const { values } = review;
    setReview(null);
    handleFormSubmit(values);
  };

  // Вызывается окном оплаты только после успешной DEMO-оплаты (данные карты сюда не передаются)
  const handleDemoPaymentSuccess = () => {
    const values = pendingOrder;
    setPendingOrder(null);
    if (values) placeOrder(values); // DEMO: деньги не списаны, статус оплаты — «Ожидает оплаты»
  };

  return (
    <>
      <PageHeader
        title={t('checkout.title')}
        crumbs={[{ label: t('cart.title'), to: '/cart' }, { label: t('checkout.title') }]}
      />
      <div className="container section--tight">
        <DemoNotice variant="warning">
          {mode === 'firebase' ? t(user ? 'checkout.firebaseNotice' : 'checkout.firebaseGuestNotice') : t('checkout.demoNotice')}
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
        {review && (
          <CheckoutReviewNotice
            review={review}
            cardPayment={review.values.payment === 'cardDemo'}
            submitting={submitting}
            onRemoveProblems={handleRemoveProblems}
            onConfirm={handleConfirmNewPrices}
          />
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
