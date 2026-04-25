const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { answers, email, tier } = req.body;
    const isDeep = tier === 'deep';

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      customer_email: email || undefined,
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: isDeep
              ? 'MyCosmicFate — Full Reading + Compatibility Report'
              : 'MyCosmicFate — Full Cosmic Reading',
          },
          unit_amount: isDeep ? 1599 : 799,
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: 'https://mycosmicfate.com/thank-you.html',
      cancel_url: 'https://mycosmicfate.com/quiz.html',
      metadata: {
        answers: JSON.stringify(answers),
        email: email || '',
        tier: tier || 'basic',
      },
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Checkout failed' });
  }
};
