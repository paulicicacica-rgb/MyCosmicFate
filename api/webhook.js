module.exports.config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = Buffer.alloc(0);
    req.on('data', chunk => { data = Buffer.concat([data, chunk]); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  // Verify Stripe signature
  const crypto = require('crypto');
  const parts = sig.split(',').reduce((acc, part) => {
    const [k, v] = part.split('=');
    if (!acc[k]) acc[k] = v;
    return acc;
  }, {});
  const signed = `${parts.t}.${rawBody.toString()}`;
  const expected = crypto.createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET).update(signed).digest('hex');
  const signatures = sig.split(',').filter(p => p.startsWith('v1=')).map(p => p.slice(3));
  if (!signatures.some(s => s === expected)) {
    console.error('Invalid webhook signature');
    return res.status(400).send('Invalid signature');
  }

  const event = JSON.parse(rawBody.toString());

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    if (session.payment_status !== 'paid') return res.status(200).end();

    const email = session.metadata?.email || session.customer_details?.email;
    const answers = JSON.parse(session.metadata?.answers || '{}');
    const tier = session.metadata?.tier || 'basic';
    const sessionId = session.id;

    console.log('Payment confirmed for:', email, 'tier:', tier);

    try {
      const report = await generateReport(answers, tier);
      console.log('Report generated, saving to Redis...');

      // Save to Redis with 30 day expiry
      await saveToRedis(sessionId, {
        report,
        tier,
        email,
        createdAt: new Date().toISOString(),
      });

      // Send email with link
      if (email) {
        const reportUrl = `https://mycosmicfate.com/report.html?id=${sessionId}`;
        await sendEmail(email, reportUrl, tier);
        console.log('Email sent to:', email);
      }
    } catch (err) {
      console.error('Failed:', err);
    }
  }

  res.status(200).json({ received: true });
};

// ─── Redis ────────────────────────────────────────────────────────────────────

async function saveToRedis(key, data) {
  const url = `${process.env.UPSTASH_REDIS_REST_URL}/set/report:${key}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      value: JSON.stringify(data),
      ex: 60 * 60 * 24 * 30, // 30 days
    }),
  });
  if (!res.ok) throw new Error('Redis save failed: ' + await res.text());
}

// ─── Claude ───────────────────────────────────────────────────────────────────

async function generateReport(a, tier) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: tier === 'deep' ? 4000 : 2500,
      messages: [{ role: 'user', content: buildPrompt(a, tier) }],
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(data));
  return data.content[0].text;
}

function buildPrompt(a, tier) {
  const decisionStyles = ['Analyse it alone', 'Talk it through', 'Act immediately', 'Step back and wait'];
  const patterns       = ['Starting strong, not finishing', 'Choosing the wrong people', 'Getting close, then retreating', 'Putting yourself last'];
  const strengths      = ['Clarity and straight answers', 'Emotional support', 'Ideas and new directions', 'Stability and grounding'];
  const shadows        = ['More tired than anyone knows', 'Afraid you have already missed it', 'You do not feel like you belong anywhere', 'Capable of much more than this'];
  const elements       = ['Fire — instinct and gut', 'Water — feeling and emotion', 'Earth — evidence and data', 'Air — logic and analysis'];
  const potentials     = ['Work and purpose', 'Relationships', 'Self-knowledge', 'Courage and action'];
  const wounds         = ['Let down by someone trusted', 'Worked hard for something that failed', 'Misunderstood or dismissed', 'Carried responsibility too early'];
  const relPatterns    = ['Gives more than receives', 'Struggles to let people in fully', 'Stays too long in wrong things', 'Needs more depth than most offer'];
  const visions        = ['Building something of real significance', 'A relationship of genuine depth', 'Freedom and self-determination', 'Peace — actual peace'];
  const numbers        = ['1 · 11 · 111 — independence and self-leadership', '3 · 33 · 333 — expression and creativity', '7 · 77 · 777 — depth and inner knowing', '9 · 99 · 999 — completion and service'];
  const blocks         = ['Fear of what changes if it works', 'Waiting until more ready', 'Does not fully believe they deserve it', 'Tried before and it failed'];
  const underrated     = ['Ability to see situations clearly', 'Capacity to keep going', 'Effect they have on people', 'Ability to build and create'];
  const angers         = ['Wasted potential', 'Dishonesty and performance', 'Injustice and imbalance', 'Being underestimated'];
  const locations      = ['In motion — building something', 'At a threshold — something needs to change', 'Rebuilding — after something that cost them', 'Stuck — and aware of it'];
  const needs          = ['Understand why they repeat the same patterns', 'Know what they are actually built for', 'Understand why relationships follow the same arc', 'Know what is stopping them from the life they can see'];

  const get = (arr, idx) => arr[a[idx]] !== undefined ? arr[a[idx]] : 'unknown';

  const dob = a[0] ? `Born: Day ${a[0]?.day || '?'}, Month ${a[0]?.month || '?'}, Year ${a[0]?.year || '?'}` : '';
  const birthtime = a[1] || 'unknown';
  const birthplace = a[2] || 'unknown';

  const deepSection = tier === 'deep' ? `

## SECTION 6: COMPATIBILITY & THE PATTERN IN LOVE

Write 400 words. Based on their relational pattern ("${get(relPatterns, 10)}") and core wound ("${get(wounds, 9)}"), tell them:
- The exact type of person they keep being drawn to and the hidden reason why
- The dynamic that plays out every time — the role they play, the role the other person plays
- What they are actually looking for underneath what they think they want
- The one internal shift that breaks the pattern permanently
- What a genuinely good relationship looks and feels like for this specific person

This section should feel like a mirror. Specific, honest, a little uncomfortable in the best way.` : '';

  return `You are writing a premium cosmic fate report for a paying customer. This is not a generic horoscope. Every sentence must feel like it was written specifically for this person. You have studied their chart carefully. Speak with authority and warmth. Be direct. Say real things.

THEIR CHART DATA:
- Date of birth: ${dob}
- Birth time: ${birthtime}
- Birth place: ${birthplace}
- How they face problems: ${get(decisionStyles, 3)}
- Recurring life pattern: ${get(patterns, 4)}
- What people come to them for: ${get(strengths, 5)}
- What they carry silently: ${get(shadows, 6)}
- Cognitive and elemental style: ${get(elements, 7)}
- Where unrealised potential lives: ${get(potentials, 8)}
- The wound still running code: ${get(wounds, 9)}
- Relationship pattern: ${get(relPatterns, 10)}
- Clearest life vision: ${get(visions, 11)}
- Repeating number frequency: ${get(numbers, 12)}
- The real internal block: ${get(blocks, 13)}
- Most underestimated strength: ${get(underrated, 14)}
- What genuinely angers them: ${get(angers, 15)}
- Where they are right now: ${get(locations, 16)}
- What they need from this reading: ${get(needs, 17)}

Write the following sections exactly as labelled. Each section heading must appear exactly as written below.

## SECTION 1: YOUR LIFE PATH NUMBER
Calculate their Life Path number from their date of birth (sum all digits to a single digit or master number 11/22/33). State the number clearly. Then write 300 words explaining what this number means for this specific person — their core nature, their mission, why they are wired the way they are. Reference their actual answers. Make it feel like a revelation.

## SECTION 2: YOUR SATURN RETURN & THE LESSON
Write 350 words about the pattern they named. Why it keeps happening. What Saturn is trying to teach them through it. What the cost of not learning it is. What life looks like when they finally do. Be specific. Reference their age/life stage from their birth year. Do not be vague.

## SECTION 3: YOUR MOON SIGN & WHAT YOU CARRY
Write 300 words about what they carry silently. Where it came from. How it has protected them. How it now limits them. The exact moment it starts to lose its grip. Name the emotion clearly. Do not soften it.

## SECTION 4: YOUR JUPITER OPENING
Write 300 words about where their biggest growth lives. Why the resistance exists there specifically. What opens up when they move through it. Give them 3 concrete, specific actions — not affirmations, actual moves they can make in the next 30 days.

## SECTION 5: YOUR COSMIC SIGNATURE
Write 250 words. This is the most important section. Tell them the rarest thing about them — what makes their energy unmistakable. What they do that other people cannot replicate. The gift they keep giving away for free. End with a single sentence that names what they have never been able to say about themselves. Make it true. Make it land.
${deepSection}

## YOUR NUMBER SEQUENCE
End with a short paragraph (100 words) about their repeating number. What it signals. What they should do when they see it. Make it feel like a private message from the universe specifically to them.

Format rules:
- Use the exact section headers above
- No bullet points anywhere — write in flowing paragraphs
- No generic phrases like "the stars suggest" or "you may find"
- Speak directly: "You" not "they"
- Every paragraph should contain at least one specific, surprising observation`;
}

// ─── Email ────────────────────────────────────────────────────────────────────

async function sendEmail(toEmail, reportUrl, tier) {
  const subject = tier === 'deep'
    ? 'Your MyCosmicFate Reading + Compatibility Report is ready ✦'
    : 'Your MyCosmicFate Reading is ready ✦';

  const htmlBody = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="background:#05071a;color:#e0d8f5;font-family:Georgia,serif;max-width:560px;margin:0 auto;padding:48px 24px;text-align:center;">
  <p style="font-size:0.65rem;color:rgba(184,145,255,0.3);letter-spacing:5px;margin-bottom:40px;">✦ MYCOSMICFATE</p>
  <div style="width:80px;height:80px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#9b6dff,#4a1a8a 50%,#0d0520 80%);margin:0 auto 32px;display:flex;align-items:center;justify-content:center;font-size:1.6rem;line-height:80px;">✦</div>
  <h1 style="font-family:Georgia,serif;font-size:1.4rem;color:#f0eaff;margin-bottom:12px;font-weight:normal;letter-spacing:1px;">Your reading is ready</h1>
  <p style="font-style:italic;font-size:1rem;color:rgba(200,180,255,0.55);line-height:1.8;margin-bottom:40px;">The stars have spoken. Your full cosmic fate report is waiting for you.</p>
  <a href="${reportUrl}" style="display:inline-block;background:linear-gradient(135deg,#8b45ff,#5a1fb5);color:#fff;text-decoration:none;padding:16px 48px;border-radius:50px;font-family:Georgia,serif;font-size:0.9rem;letter-spacing:2px;">Read My Report ✦</a>
  <p style="margin-top:40px;font-size:0.75rem;color:rgba(184,145,255,0.3);line-height:1.7;">Or copy this link:<br><span style="color:rgba(184,145,255,0.5);">${reportUrl}</span></p>
  <p style="margin-top:60px;font-size:0.65rem;color:rgba(184,145,255,0.2);letter-spacing:2px;">mycosmicfate.com · hello@mycosmicfate.com</p>
</body></html>`;

  const textBody = `Your MyCosmicFate reading is ready.\n\nRead it here: ${reportUrl}\n\nmycosmicfate.com`;

  const crypto = require('crypto');
  const region = process.env.AWS_REGION || 'eu-west-1';
  const endpoint = `https://email.${region}.amazonaws.com/v2/email/outbound-emails`;
  const body = JSON.stringify({
    FromEmailAddress: 'hello@mycosmicfate.com',
    Destination: { ToAddresses: [toEmail] },
    Content: {
      Simple: {
        Subject: { Data: subject, Charset: 'UTF-8' },
        Body: {
          Html: { Data: htmlBody, Charset: 'UTF-8' },
          Text: { Data: textBody, Charset: 'UTF-8' },
        },
      },
    },
  });

  const accessKey = process.env.AWS_ACCESS_KEY_ID;
  const secretKey = process.env.AWS_SECRET_ACCESS_KEY;
  const now = new Date();
  const dateStamp = now.toISOString().slice(0,10).replace(/-/g,'');
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g,'').slice(0,15)+'Z';
  const payloadHash = crypto.createHash('sha256').update(body).digest('hex');
  const canonicalHeaders = `content-type:application/json\nhost:email.${region}.amazonaws.com\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-amz-date';
  const canonicalRequest = `POST\n/v2/email/outbound-emails\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const credentialScope = `${dateStamp}/${region}/ses/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${crypto.createHash('sha256').update(canonicalRequest).digest('hex')}`;
  const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, dateStamp), region), 'ses'), 'aws4_request');
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  const authHeader = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const sesRes = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Amz-Date': amzDate, 'Authorization': authHeader },
    body,
  });
  if (!sesRes.ok) throw new Error('SES error: ' + await sesRes.text());
}
