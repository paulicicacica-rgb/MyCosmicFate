module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { answers, email, tier } = req.body;
    const prices = {
      'basic': '799',
      'deep': '1599',
      'roadmap': '1999',
      'name-basic': '399',
      'soul-match': '499',
      'past-life': '499',
      'karma-score': '399',
      'dream-reader': '399',
      'bundle': '1999',
    };
    const names = {
      'basic': 'MyCosmicFate — Full Cosmic Reading',
      'deep': 'MyCosmicFate — Full Reading + Compatibility Report',
      'roadmap': 'MyCosmicFate — 2026 Cosmic Roadmap',
      'name-basic': 'MyCosmicFate — Full Name Meaning Reading',
      'soul-match': 'MyCosmicFate — Soul Match Compatibility Report',
      'past-life': 'MyCosmicFate — Past Life Reading',
      'karma-score': 'MyCosmicFate — Karma Score Report',
      'dream-reader': 'MyCosmicFate — Dream Interpretation',
      'bundle': 'MyCosmicFate — All 6 Readings Bundle',
    };
    const price = prices[tier] || '799';
    const productName = names[tier] || 'MyCosmicFate Reading';
    const isDeep = tier === 'deep';

    const params = new URLSearchParams();
    params.append('payment_method_types[]', 'card');
    params.append('mode', 'payment');
    params.append('success_url', 'https://mycosmicfate.com/thank-you.html');
    params.append('cancel_url', 'https://mycosmicfate.com/quiz.html');
    params.append('line_items[0][price_data][currency]', 'eur');
    params.append('line_items[0][price_data][unit_amount]', price);
    params.append('line_items[0][price_data][product_data][name]', productName);
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
