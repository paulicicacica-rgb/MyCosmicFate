module.exports.config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = Buffer.alloc(0);
    req.on('data', chunk => { data = Buffer.concat([data, chunk]); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function stripeSign(payload, secret) {
  // Verify Stripe webhook signature manually
  const crypto = require('crypto');
  const sig = arguments[2];
  const parts = sig.split(',').reduce((acc, part) => {
    const [k, v] = part.split('=');
    acc[k] = v;
    return acc;
  }, {});
  const timestamp = parts.t;
  const signatures = Object.keys(parts).filter(k => k.startsWith('v1')).map(k => parts[k]);
  const signed = `${timestamp}.${payload}`;
  const expected = crypto.createHmac('sha256', secret).update(signed).digest('hex');
  return signatures.some(s => s === expected);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  // Verify signature
  const crypto = require('crypto');
  const parts = sig.split(',').reduce((acc, part) => {
    const [k, v] = part.split('=');
    if (!acc[k]) acc[k] = v;
    return acc;
  }, {});
  const timestamp = parts.t;
  const signed = `${timestamp}.${rawBody.toString()}`;
  const expected = crypto.createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET).update(signed).digest('hex');
  const signatures = sig.split(',').filter(p => p.startsWith('v1=')).map(p => p.slice(3));
  const valid = signatures.some(s => s === expected);

  if (!valid) {
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

    console.log('Payment confirmed, generating report for:', email);

    try {
      const report = await generateReport(answers, tier);
      console.log('Report generated, sending email...');
      if (email) {
        await sendEmail(email, report, tier);
        console.log('Email sent to:', email);
      }
    } catch (err) {
      console.error('Report/email failed:', err);
    }
  }

  res.status(200).json({ received: true });
};

async function generateReport(a, tier) {
  const prompt = buildPrompt(a, tier);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: tier === 'deep' ? 3000 : 2000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(data));
  return data.content[0].text;
}

function buildPrompt(a, tier) {
  const decisionStyles = ['Logic and evidence', 'Gut feeling', 'What others think', 'What feels aligned'];
  const patterns       = ['Starting strong, fading out', 'Attracting the wrong people', 'Self-sabotage near success', 'Giving more than I receive'];
  const strengths      = ['Advice and perspective', 'Emotional support', 'Practical help', 'Creative ideas'];
  const shadows        = ["I am not enough", "I will be abandoned", "I don't deserve this", "Something is wrong with me"];
  const elements       = ['Fire — action and drive', 'Water — depth and feeling', 'Earth — structure and patience', 'Air — ideas and connection'];
  const potentials     = ['Creative expression', 'Leadership', 'Deep relationships', 'Financial security'];
  const wounds         = ['Rejection', 'Failure', 'Being seen', 'Loss of control'];
  const relPatterns    = ['Walls go up immediately', 'I give everything too fast', 'I attract unavailable people', 'I leave before they can'];
  const visions        = ['Freedom and independence', 'Love and belonging', 'Impact and legacy', 'Peace and simplicity'];
  const blocks         = ['Fear', 'Timing', 'Money', 'Other people'];
  const underrated     = ['Resilience', 'Intuition', 'The ability to love', 'Intelligence'];
  const angers         = ['Injustice', 'Being ignored', 'Incompetence', 'Dishonesty'];
  const locations      = ['On the edge of something', 'In the middle of rebuilding', 'Lost and searching', 'Finally arriving'];
  const needs          = ["Confirmation I'm on the right path", "To understand why this keeps happening", "Permission to want what I want", "A name for what I already feel"];

  const get = (arr, idx) => arr[a[idx]] || 'unknown';

  const deepSection = tier === 'deep' ? `

6. COMPATIBILITY & RELATIONSHIPS
Based on their relational wound and pattern, write a detailed section on the type of person they are cosmically drawn to and why, the dynamic that keeps repeating, what their chart says they actually need in a partner, and the one shift that changes everything. Make this feel like the reader is being seen for the first time.` : '';

  return `You are a master numerologist and astrologer. Write a deeply personal, psychologically grounded cosmic fate report. No generic horoscope language. Speak directly to this person as if you have studied them for years. Be specific. Be honest. Be warm.

THEIR PROFILE:
- How they make decisions: ${get(decisionStyles, 3)}
- Recurring life pattern: ${get(patterns, 4)}
- What people come to them for: ${get(strengths, 5)}
- Hidden feeling about themselves: ${get(shadows, 6)}
- Element / cognitive style: ${get(elements, 7)}
- Unrealised potential: ${get(potentials, 8)}
- Core wound: ${get(wounds, 9)}
- Relationship pattern: ${get(relPatterns, 10)}
- Life vision: ${get(visions, 11)}
- What blocks them: ${get(blocks, 13)}
- Most underestimated strength: ${get(underrated, 14)}
- What makes them angry: ${get(angers, 15)}
- Where they are right now: ${get(locations, 16)}
- What they need from this reading: ${get(needs, 17)}

Write exactly 5 sections with these exact headers:

1. YOUR LIFE PATH
2. YOUR SATURN LESSON
3. YOUR SHADOW & YOUR POWER
4. YOUR NEXT CHAPTER
5. YOUR COSMIC SIGNATURE
${deepSection}

End with a single closing line in italics — something true and unforgettable that belongs only to this person.`;
}

async function sendEmail(toEmail, reportText, tier) {
  const subject = tier === 'deep'
    ? 'Your MyCosmicFate Full Reading + Compatibility Report ✦'
    : 'Your MyCosmicFate Full Cosmic Reading ✦';

  const lines = reportText.split('\n').map(line => {
    if (/^\d+\.\s[A-Z\s&+]+$/.test(line.trim()))
      return `<h2 style="font-family:Georgia,serif;font-size:0.8rem;color:#c9a84c;letter-spacing:4px;text-transform:uppercase;margin:36px 0 12px;">${line.trim()}</h2>`;
    if (line.trim().startsWith('*') || line.trim().startsWith('_'))
      return `<p style="font-style:italic;color:#b891ff;text-align:center;font-size:1.05rem;margin-top:36px;">${line.replace(/[*_]/g,'').trim()}</p>`;
    if (line.trim())
      return `<p style="font-size:0.93rem;line-height:1.9;color:rgba(220,210,245,0.8);margin-bottom:12px;">${line.trim()}</p>`;
    return '';
  }).join('\n');

  const htmlBody = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="background:#05071a;color:#e0d8f5;font-family:Georgia,serif;max-width:620px;margin:0 auto;padding:40px 24px;">
<p style="font-size:0.65rem;color:rgba(184,145,255,0.3);letter-spacing:5px;margin-bottom:32px;">✦ MYCOSMICFATE</p>
${lines}
<p style="margin-top:60px;font-size:0.65rem;color:rgba(184,145,255,0.2);letter-spacing:2px;text-align:center;">mycosmicfate.com · hello@mycosmicfate.com</p>
</body></html>`;

  // Send via AWS SES using REST API directly — no SDK needed
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
          Text: { Data: reportText, Charset: 'UTF-8' },
        },
      },
    },
  });

  // AWS Signature Version 4
  const accessKey = process.env.AWS_ACCESS_KEY_ID;
  const secretKey = process.env.AWS_SECRET_ACCESS_KEY;
  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, '');
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15) + 'Z';

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

  const sesResponse = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Amz-Date': amzDate,
      'Authorization': authHeader,
    },
    body,
  });

  if (!sesResponse.ok) {
    const err = await sesResponse.text();
    throw new Error('SES error: ' + err);
  }
}
