const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  const { answers } = req.body;
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [{ price_data: {
      currency: 'eur',
      product_data: { name: 'MyCosmicFate — Full Reading' },
      unit_amount: 799
    }, quantity: 1 }],
    mode: 'payment',
    success_url: `https://mycosmicfate.com/report.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `https://mycosmicfate.com/quiz.html`,
    metadata: { answers: JSON.stringify(answers) }
  });
  res.json({ url: session.url });
};
