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
  const ex = 60 * 60 * 24 * 30;
  const res = await fetch(`${process.env.UPSTASH_REDIS_REST_URL}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([
      ['SET', `report:${key}`, JSON.stringify(data)],
      ['EXPIRE', `report:${key}`, ex],
    ]),
  });
  if (!res.ok) throw new Error('Redis save failed: ' + await res.text());
  console.log('Redis saved OK');
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

  return `You are writing a cosmic fate report. This person paid for it. They are probably a woman in her 20s or 30s. She has been through something. She is not naive — she believes in this because mainstream advice never fully fit her. She wants someone to finally say the true thing out loud.

Your job is not to comfort her. Your job is to see her — clearly, specifically, without softening it. One sentence in this report should hit so hard she screenshots it and sends it to her best friend. Write toward that sentence in every section.

Do not use the following phrases under any circumstances: "the stars suggest", "you may find", "it is possible that", "you have a gift for", "you are on a journey", "remember to be kind to yourself", "the universe has a plan". These are the phrases of someone who doesn't actually know anything. You know things. Say them.

THEIR DATA:
- Date of birth: ${dob}
- Birth time: ${birthtime}
- Birth place: ${birthplace}
- How they face difficulty: ${get(decisionStyles, 3)}
- The pattern that keeps repeating: ${get(patterns, 4)}
- What people come to them for: ${get(strengths, 5)}
- What they carry quietly: ${get(shadows, 6)}
- How they think and process: ${get(elements, 7)}
- Where their potential is stuck: ${get(potentials, 8)}
- The wound underneath everything: ${get(wounds, 9)}
- How love keeps going wrong: ${get(relPatterns, 10)}
- What they are actually trying to build: ${get(visions, 11)}
- The number that follows them: ${get(numbers, 12)}
- What is really stopping them: ${get(blocks, 13)}
- The strength they underestimate: ${get(underrated, 14)}
- What makes them genuinely angry: ${get(angers, 15)}
- Where they are in their life right now: ${get(locations, 16)}
- What they need this reading to give them: ${get(needs, 17)}

Write exactly these sections with exactly these headers:

## SECTION 1: YOUR LIFE PATH NUMBER
First, calculate the Life Path number from their birth date. Add every digit in the full date until you reach a single digit or a master number (11, 22, 33). State it at the start: "Your Life Path number is [X]."

Then write 300 words. Not about what Life Path [X] means in general — about what it means for THIS person given everything they told you. Why they have always felt slightly out of step with how other people operate. What they were actually built for. The thing that looks like a flaw but is the whole point of them. Be specific. Reference their answers. Do not write a textbook definition.

## SECTION 2: YOUR SATURN LESSON
Write 350 words about the pattern they named — the one that keeps happening no matter what they do. 

Do not explain what Saturn is. Do not say "Saturn governs". Just tell them the truth about why this keeps happening to them specifically. What they keep doing, what they keep attracting, why the same dynamic arrives in different costumes. What this pattern is protecting them from having to face. What breaks when they finally face it. What becomes possible after.

Use their birth year to reference where they are in their Saturn cycle — Saturn returns every 29 years. If they are in their late 20s, they are in their first return. If they are in their late 50s, their second. Name it.

End this section with one sentence that is so accurate it is almost uncomfortable.

## SECTION 3: WHAT YOU CARRY
Write 300 words about what they said they carry quietly.

Do not be gentle about where it came from. Name it. Tell them how long they have been carrying it. Tell them what it cost them — specifically, in their relationships, in their decisions, in the version of their life they didn't choose because of it. Then tell them the one thing that starts to change it. Not an affirmation. An actual shift — in how they see something, in what they stop waiting for, in what they decide to stop proving.

End with the sentence they have needed to hear for years.

## SECTION 4: YOUR JUPITER DOOR
Write 300 words about where their life opens up — the area they have been avoiding, circling, almost entering.

Tell them exactly why they have been avoiding it. Not a general reason — their specific reason, based on what they told you. Then tell them what is on the other side. Not in vague spiritual terms. In real terms — what their life actually looks like, feels like, when they walk through.

Give them 3 things to do in the next 30 days. Not affirmations. Not "journal about your feelings." Actual moves. Specific actions that create real change in the direction of what they said they want.

## SECTION 5: YOUR COSMIC SIGNATURE
Write 250 words. This is the most important section.

Tell them the one thing about them that is genuinely rare. Not a compliment — an observation. The thing that people feel in them before they understand it. The thing they give to every room, every relationship, every conversation, without knowing they are doing it. The thing they have been told is too much, or not enough, that is actually the whole point of them.

End this section with a single sentence — not a question, not advice, not a prediction. A statement. The truest thing about them. The sentence they will copy and send to someone they love and say "this is it. this is the thing."
${deepSection}

## YOUR NUMBER
Write 100 words about the number that follows them. Not what that number means in a numerology textbook. What it means as a signal specifically to them, given everything they told you. When they see it, what is it confirming. What it is asking them to notice. What they should do the next time it appears.

Rules:
- No bullet points. Flowing paragraphs only.
- Speak directly to them. "You" not "one" not "they".
- Every section must contain at least one sentence that could only be true for this specific person.
- The report should feel like it was written by someone who has been watching this person's life for years and finally decided to tell them everything.`;
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
