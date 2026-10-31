const escapeHtml = (value) => 
    String(value ?? '') 
       .replace(/&/g, '&amp;') 
       .replace(/</g, '&lt;') 
       .replace(/>/g, '&gt;');
// Статусы оплаты (данные банковской карты в заказ не попадают и сюда не приходят)
const PAYMENT_STATUS_LABELS = { paidDemo: 'Оплачен (DEMO)', awaitingPayment: 'Ожидает оплаты' };

export default async function handler(req, res) { 
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') { 
      return res.status(405).json({ ok: false, error: 'method_not_allowed' }); 
    }
    const token = process.env.TELEGRAM_BOT_TOKEN; 
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) { 
      return res.status(500).json({ ok: false, error: 'not_configured' }); 
    }
    const order = req.body;
    if ( 
      !order || 
      !order.id ||  
      !Array.isArray(order.items) ||  
      !order.customer?.name ||  
      !order.customer?.phone 
    ) { 
       return res.status(400).json({ ok: false, error: 'invalid_order' }); 
    }

    const items = order.items 
    .map((item) => 
       `• ${escapeHtml(item.name)} — ${escapeHtml(item.quantity)} шт. × ${escapeHtml(item.price)}`
    ) 
    .join('\n');

   const message = [ 
   '<b>🛍 Новый заказ — AROMA DONNA</b>', 
   '', 
   `<b>Номер:</b> ${escapeHtml(order.id)}`, 
    `<b>Дата:</b> ${escapeHtml(order.createdAt)}`, 
    `<b>Покупатель:</b> ${escapeHtml([order.customer.name, order.customer.lastName].filter(Boolean).join(' '))}`, 
    `<b>Телефон:</b> ${escapeHtml(order.customer.phone)}`, 
    `<b>Email:</b> ${escapeHtml(order.customer.email || 'Не указан')}`, 
   '', 
   `<b>Товары:</b>`, 
   items, 
   '', 
   `<b>Итого:</b> ${escapeHtml(order.total)}`, 
   `<b>Оплата:</b> ${escapeHtml(order.payment)}`, 
   `<b>Статус оплаты:</b> ${escapeHtml(PAYMENT_STATUS_LABELS[order.paymentStatus] || order.paymentStatus || '—')}`, 
   `<b>Доставка:</b> ${escapeHtml(order.shipping?.method)}`, 
   order.shipping?.address 
     ? `<b>Адрес:</b> ${escapeHtml([order.shipping.region, order.shipping.city, order.shipping.address].filter(Boolean).join(', '))}` 
     : null, 
   order.shipping?.comment ? `<b>Комментарий:</b> ${escapeHtml(order.shipping.comment)}` : null, 
   ].filter((line) => line !== null).join('\n');

   try { 
     const response = await fetch( 
     `https://api.telegram.org/bot${token}/sendMessage`, 
     { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ 
            chat_id: chatId, 
            text: message, 
            parse_mode: 'HTML', 
        }), 
    } 
    );

    const result = await response.json();

    if (!response.ok || !result.ok) {
      console.error('[order] Telegram error:', result.description);
      return res.status(502).json({ ok: false, error: 'telegram_failed' });
    }

    return res.status(200).json({ ok: true });
  } catch (error) { 
    console.error('[order] Telegram connection error:', error.message); 
    return res.status(502).json({ ok: false, error: 'network_error' }); 
  } 
}