const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Anthropic = require('@anthropic-ai/sdk');

module.exports = async (req, res) => {
  const { session_id } = req.query;
  const session = await stripe.checkout.sessions.retrieve(session_id);
  if (session.payment_status !== 'paid') return res.status(403).json({ error: 'Not paid' });
  
  const answers = JSON.parse(session.metadata.answers);
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  
  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2000,
    messages: [{ role: 'user', content: buildPrompt(answers) }]
  });
  
  res.json({ report: message.content[0].text });
};

function buildPrompt(a) {
  return `You are a master numerologist and astrologer writing a deeply personal cosmic fate report.
Based on these answers generate a 5-section personal report. Be specific, psychologically grounded, warm but honest. No generic horoscope language.

Their answers:
- Decision style: ${a[3]}
- Recurring pattern: ${a[4]}  
- What people come to them for: ${a[5]}
- Hidden feeling: ${a[6]}
- Element/cognitive style: ${a[7]}
- Unrealised potential area: ${a[8]}
- Core wound: ${a[9]}
- Relationship pain: ${a[10]}
- Life vision: ${a[11]}
- Recurring number: ${a[12]}
- The real block: ${a[13]}
- Underestimated strength: ${a[14]}
- What makes them angry: ${a[15]}
- Where they are now: ${a[16]}
- What they need from this: ${a[17]}

Write 5 sections:
1. YOUR LIFE PATH — what their numbers reveal about their core nature
2. YOUR SATURN LESSON — the pattern they repeat and why
3. YOUR MOON TRUTH — what lives beneath the surface
4. YOUR JUPITER OPENING — where their biggest growth lives
5. YOUR MISSION — a direct, honest statement of what they are here to do

Each section 150-200 words. Direct. Specific to their answers. No vague cosmic filler.`;
}
