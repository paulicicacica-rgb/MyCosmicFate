module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { answers, email, tier } = req.body;
    const isDeep = tier === 'deep';

    const params = new URLSearchParams();
    params.append('payment_method_types[]', 'card');
    params.append('mode', 'payment');
    params.append('success_url', 'https://mycosmicfate.com/thank-you.html');
    params.append('cancel_url', 'https://mycosmicfate.com/quiz.html');
    params.append('line_items[0][price_data][currency]', 'eur');
    params.append('line_items[0][price_data][unit_amount]', isDeep ? '1599' : '799');
    params.append('line_items[0][price_data][product_data][name]', isDeep
      ? 'MyCosmicFate — Full Reading + Compatibility Report'
      : 'MyCosmicFate — Full Cosmic Reading');
    params.append('line_items[0][quantity]', '1');
    params.append('metadata[answers]', JSON.stringify(answers));
    params.append('metadata[email]', email || '');
    params.append('metadata[tier]', tier || 'basic');
    if (email) params.append('customer_email', email);

    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const session = await response.json();

    if (!response.ok) {
      console.error('Stripe error:', session);
      return res.status(500).json({ error: session.error?.message || 'Stripe error' });
    }

    res.json({ url: session.url });

  } catch (err) {
    console.error('Checkout error:', err);
    res.status(500).json({ error: 'Checkout failed' });
  }
};
