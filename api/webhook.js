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
      const report =
        tier === 'roadmap'      ? await generateRoadmap(answers) :
        tier === 'name-basic'   ? await generateNameReport(answers) :
        tier === 'soul-match'   ? await generateSoulMatch(answers) :
        tier === 'past-life'    ? await generatePastLife(answers) :
        tier === 'karma-score'  ? await generateKarmaScore(answers) :
        tier === 'dream-reader' ? await generateDreamReport(answers) :
        tier === 'bundle'       ? await generateReport(answers, 'basic') :
        await generateReport(answers, tier);

      console.log('Report generated, saving to Redis...');

      await saveToRedis(sessionId, {
        report,
        tier,
        email,
        createdAt: new Date().toISOString(),
      });

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

// ─── Shared Claude caller ─────────────────────────────────────────────────────

async function callClaude(prompt, maxTokens) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens || 2500,
      system: 'You are a cosmic reading writer. You ALWAYS write the requested reading regardless of how complete the data is. If birth data is missing or approximate, use what you have and make reasonable astrological inferences. You NEVER refuse, explain limitations, or ask for more information. A paying customer is waiting. Write the best reading possible with whatever data is provided.',
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(data));
  return data.content[0].text;
}

// ─── Main cosmic fate report ──────────────────────────────────────────────────

async function generateReport(a, tier) {
  return callClaude(buildPrompt(a, tier), tier === 'deep' ? 4000 : 2500);
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

## SECTION 6: COMPATIBILITY & RELATIONSHIPS
Based on their relational wound and pattern, write a detailed section on the type of person they are cosmically drawn to and why, the dynamic that keeps repeating, what their chart says they actually need in a partner, and the one shift that changes everything. Make this feel like the reader is being seen for the first time.` : '';

  return `You are writing a cosmic fate report for a paying customer. This person is probably a woman in her 20s or 30s going through something. She wants someone to finally say the true thing out loud.

Do not use these phrases: "the stars suggest", "you may find", "you have a gift for", "you are on a journey", "remember to be kind to yourself".

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

Write exactly these sections:

## SECTION 1: YOUR LIFE PATH NUMBER
Calculate Life Path from birth date. State: "Your Life Path number is [X]." Then 300 words about what this means for THIS person specifically.

## SECTION 2: YOUR SATURN LESSON
350 words about the pattern they named. Why it keeps happening. What it protects them from. What breaks when they face it. End with one sentence so accurate it is uncomfortable.

## SECTION 3: WHAT YOU CARRY
300 words about what they carry quietly. Where it came from. What it cost them. The one thing that starts to change it. End with the sentence they have needed to hear for years.

## SECTION 4: YOUR JUPITER DOOR
300 words about where their life opens up. Why they have been avoiding it. What is on the other side. Give 3 concrete actions for the next 30 days.

## SECTION 5: YOUR COSMIC SIGNATURE
250 words. The rarest thing about them. End with one sentence — the truest thing about them that they will screenshot and send to someone.
${deepSection}

## YOUR NUMBER
100 words about the number that follows them. What it signals specifically to them.

No bullet points. Speak directly. Every section must feel written for this specific person.`;
}

// ─── Roadmap ──────────────────────────────────────────────────────────────────

async function generateRoadmap(a) {
  const dob = a[0] ? `${a[0].day}/${a[0].month}/${a[0].year}` : 'unknown';
  return callClaude(`Write a 2026 Cosmic Roadmap for someone born ${dob}. Month by month guidance for the rest of 2026.

Write these sections with exact headers:

## 2026: THE YEAR IN ONE LINE
One sentence capturing the essential theme of this year for this person.

## MAY — JUNE 2026
What is happening cosmically and what it means for them. What to do, what to avoid.

## JULY — AUGUST 2026
Same format.

## SEPTEMBER — OCTOBER 2026
Same format. This is often a turning point — name what it is.

## NOVEMBER — DECEMBER 2026
How the year closes. What they are moving into.

## YOUR POWER MONTH
Name the single best month for a major decision or beginning. Say exactly why.

## YOUR WARNING MONTH
Name the month to be careful in. What the risk is.

## THE MOVE TO MAKE BEFORE YEAR END
One specific concrete action before December 31st.

No bullet points. Speak directly.`, 2500);
}

// ─── Name report ─────────────────────────────────────────────────────────────

async function generateNameReport(a) {
  const name = a.fullname || 'Unknown';
  const firstName = name.split(' ')[0];
  const dob = a.dob ? `${a.dob.day}/${a.dob.month}/${a.dob.year}` : 'unknown';

  let num = name.toUpperCase().split('').reduce((acc, c) => {
    const val = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.indexOf(c) + 1;
    return val > 0 ? acc + val : acc;
  }, 0);
  while (num > 9 && num !== 11 && num !== 22 && num !== 33) {
    num = String(num).split('').reduce((a, d) => a + parseInt(d), 0);
  }

  const feelings = ['Calm and trust', 'Energy and excitement', 'Depth and mystery', 'Warmth and safety'];
  const relationships = ['Loves it', 'Fine — just a name', 'Never felt it fits', 'Goes by nickname'];
  const needs = ['Destiny and purpose', 'Energy and how others see them', 'What name has been trying to tell them', 'Whether living up to name'];

  return callClaude(`Write a personalised name meaning report for ${name} (born ${dob}). Name number: ${num}.
What people feel hearing their name: ${feelings[a[2]] || 'unknown'}.
Relationship with name: ${relationships[a[5]] || 'unknown'}.
What they need: ${needs[a[7]] || 'unknown'}.

Write these sections:

## YOUR NAME NUMBER
State "Your name number is ${num}." Then 250 words about what this means for ${firstName} specifically.

## THE LETTERS IN ${name.toUpperCase()}
250 words on the energetic signature — first letter governs first impressions, vowels carry the soul, last letter governs how remembered.

## WHAT YOUR NAME HAS BEEN DOING TO YOU
250 words on how carrying this name shaped them — expectations placed on them, role they keep being pulled into.

## WHAT YOUR NAME IS CALLING YOU TO BECOME
200 words on the highest expression of this name. End with one sentence naming what ${firstName} was always meant to be.

No bullet points. Speak directly to ${firstName}.`, 2000);
}

// ─── Soul Match ───────────────────────────────────────────────────────────────

async function generateSoulMatch(a) {
  const d1 = a.dob0 || a['dob0'];
  const d2 = a.dob1 || a['dob1'];
  const dob1 = d1 && d1.day ? `${d1.day}/${d1.month}/${d1.year}` : 'not provided';
  const dob2 = d2 && d2.day ? `${d2.day}/${d2.month}/${d2.year}` : 'not provided';

  const connections = ['Romantic partner', 'Someone they are interested in', 'An ex', 'Someone they cannot figure out'];
  const patterns = ['Intense connection then distance', 'Understanding each other too well', 'Same wants different timing', 'One always needs more'];
  const feelings = ['Like themselves completely', 'Like a better version', 'Slightly off balance', 'Waiting for something to break'];
  const needs = ['Whether this is the right person', 'Why this dynamic keeps repeating', 'What this connection is here to teach', 'Whether to stay or let go'];

  const get = (arr, idx) => arr[a[idx]] || 'unknown';

  return callClaude(`Write a cosmic compatibility report.
Person 1 born: ${dob1}
Person 2 born: ${dob2}
Connection type: ${get(connections, 2)}
Pattern between them: ${get(patterns, 3)}
How they feel in connection: ${get(feelings, 4)}
What they need from reading: ${get(needs, 7)}

Write these sections:

## SECTION 1: YOUR COSMIC CONNECTION TYPE
What type of soul connection this is. Specific to these two people.

## SECTION 2: THE PATTERN BETWEEN YOU
Why the pattern keeps happening. What each person brings to it. What it protects them from.

## SECTION 3: THE KARMIC AXIS
What this relationship is here to teach. What they owe each other. What becomes possible if they learn it.

## SECTION 4: THE HONEST FORECAST
What this connection looks like long term. Be honest, not harsh.

## SECTION 5: THE ONE MOVE
The single most important shift for this connection to reach its potential.

No bullet points. Speak directly. Every section must feel specific to these two people.`, 2500);
}

// ─── Past Life ────────────────────────────────────────────────────────────────

async function generatePastLife(a) {
  const dob = a.dob ? `${a.dob.day}/${a.dob.month}/${a.dob.year}` : 'unknown';
  const eras = ['Ancient — Egypt, Greece, Rome', 'Medieval', 'Renaissance', 'Modern — revolutions, world wars'];
  const gifts = ['Leading and commanding', 'Healing and caring', 'Creating and making', 'Knowing things before they happen'];
  const fears = ['Being trapped or imprisoned', 'Being abandoned', 'Fire, water, sudden disaster', 'Being powerless'];
  const roles = ['Protector or warrior', 'Leader or ruler', 'Healer or guide', 'Outcast or rebel'];
  const get = (arr, idx) => arr[a[idx]] || 'unknown';

  return callClaude(`Write a past life reading. Write it as a story — vivid, specific, believable.
Born: ${dob}
Era they feel pulled to: ${get(eras, 1)}
Gift that came naturally: ${get(gifts, 3)}
Unexplained fear: ${get(fears, 4)}
Role they keep being pulled into: ${get(roles, 5)}

Write these sections:

## WHO YOU WERE
300 words. Who they were in their most significant past life. Name the era, place, role. Make it vivid.

## WHAT YOU LIVED THROUGH
300 words. Key events of that life. What they built, lost, how it ended.

## WHAT YOU CARRIED FORWARD
250 words. Specific things from that life that arrived with them — gifts, fears, patterns, wounds.

## WHAT YOUR SOUL CAME BACK TO COMPLETE
200 words. The unfinished business. What that past life left unresolved.

End with one italicised sentence connecting who they were to who they are.
No bullet points. Write in flowing paragraphs.`, 2500);
}

// ─── Karma Score ──────────────────────────────────────────────────────────────

async function generateKarmaScore(a) {
  const dob = a.dob ? `${a.dob.day}/${a.dob.month}/${a.dob.year}` : 'unknown';
  const debts = ['More kindness', 'More honesty', 'More courage', 'Nothing — given enough'];
  const credits = ['A love that stays', 'Recognition', 'A real chance', 'Nothing'];
  const weights = ["Someone else's guilt", "Someone else's pain", "Someone else's expectations", 'Only their own'];
  const releases = ['Need to prove themselves', 'Fear of abandonment', 'Belief they must earn love', 'Running out of time'];
  const get = (arr, idx) => arr[a[idx]] || 'unknown';

  return callClaude(`Write a karmic debt and credit report.
Born: ${dob}
What they feel they owe: ${get(debts, 1)}
What they feel owed: ${get(credits, 2)}
What they carry for others: ${get(weights, 4)}
What they are ready to release: ${get(releases, 5)}

Write these sections:

## YOUR KARMIC DEBT
What this soul owes. What action clears it. How long they have been carrying it.

## YOUR KARMIC CREDIT
What the universe owes them. What they have given unreturned. When that return arrives.

## WHAT YOU ARE CARRYING FOR OTHERS
Where it came from. Why they took it on. What releasing it looks like in practice.

## THE RELEASE
The specific thing they are ready to let go of. Why now. What life looks like after. Give 2 concrete actions.

## YOUR KARMIC VERDICT
One honest paragraph. Where this soul stands. What the next chapter requires. End with the truest sentence about what they are owed and what they owe.

No bullet points. Speak directly.`, 2500);
}

// ─── Dream Reader ─────────────────────────────────────────────────────────────

async function generateDreamReport(a) {
  const dream = a.dream || 'a recurring dream';
  const feelings = ['Afraid or anxious', 'Lost or confused', 'Chased or in danger', 'Calm but aware'];
  const settings = ['A place from the past', 'Somewhere unfamiliar', 'Changes but feels the same', 'No setting — just feelings'];
  const wakes = ['Disturbed — it stays with them', 'Relieved', 'Empty or unsettled', 'Like they received something'];
  const get = (arr, idx) => arr[a[idx]] || 'unknown';

  return callClaude(`Interpret this recurring dream. Tell them exactly what it means — specifically, not vaguely.

THE DREAM: ${dream}
How they feel during it: ${get(feelings, 1)}
Where it happens: ${get(settings, 2)}
How they feel waking: ${get(wakes, 5)}

Write these sections:

## WHAT YOUR DREAM IS SAYING
300 words. The core message. What the symbols mean in the context of what they described.

## WHAT IT IS CONNECTED TO
300 words. What in their waking life this dream is processing. The psychological or emotional root.

## WHY IT KEEPS RETURNING
200 words. The message has not been received. What they have not yet acknowledged.

## HOW TO ANSWER IT
200 words. What they need to do in waking life for this dream to stop. Real, specific, practical actions.

End with one sentence naming exactly what this dream has been trying to tell them.
No bullet points. Write in flowing paragraphs.`, 2500);
}

// ─── Email ────────────────────────────────────────────────────────────────────

async function sendEmail(toEmail, reportUrl, tier) {
  const subjects = {
    'basic': 'Your MyCosmicFate Reading is ready ✦',
    'deep': 'Your MyCosmicFate Reading + Compatibility Report is ready ✦',
    'roadmap': 'Your 2026 Cosmic Roadmap is ready ✦',
    'name-basic': 'Your Name Meaning Reading is ready ✦',
    'soul-match': 'Your Soul Match Report is ready ✦',
    'past-life': 'Your Past Life Reading is ready ✦',
    'karma-score': 'Your Karma Score Report is ready ✦',
    'dream-reader': 'Your Dream Interpretation is ready ✦',
    'bundle': 'Your MyCosmicFate Bundle is ready ✦',
  };
  const subject = subjects[tier] || 'Your MyCosmicFate Reading is ready ✦';

  const htmlBody = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="background:#05071a;color:#e0d8f5;font-family:Georgia,serif;max-width:560px;margin:0 auto;padding:0;text-align:center;">
  <div style="padding:32px 24px 0;">
    <img src="https://mycosmicfate.com/logo-email.png" alt="MyCosmicFate" width="260" style="max-width:260px;height:auto;display:block;margin:0 auto;" />
  </div>
  <div style="height:1px;background:linear-gradient(90deg,transparent,rgba(184,145,255,0.2),transparent);margin:28px 24px;"></div>
  <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 28px;"><tr><td width="80" height="80" align="center" valign="middle" style="border-radius:50%;background:#2a0a5a;border:2px solid #8b45ff;font-size:28px;color:#f0eaff;text-align:center;vertical-align:middle;line-height:80px;">&#10022;</td></tr></table>
  <h1 style="font-family:Georgia,serif;font-size:1.5rem;color:#f0eaff;margin:0 0 12px;font-weight:normal;letter-spacing:1px;padding:0 24px;">Your reading is ready</h1>
  <p style="font-style:italic;font-size:1rem;color:rgba(200,180,255,0.55);line-height:1.8;margin:0 0 36px;padding:0 24px;">The stars have spoken. Your personalised report is waiting for you.</p>
  <div style="padding:0 24px 40px;">
    <a href="${reportUrl}" style="display:inline-block;background:#8b45ff;color:#fff;text-decoration:none;padding:16px 48px;border-radius:50px;font-family:Georgia,serif;font-size:0.9rem;letter-spacing:2px;">Read My Report &#10022;</a>
  </div>
  <p style="font-size:0.72rem;color:rgba(184,145,255,0.25);line-height:1.7;padding:0 24px;">Or copy this link:<br><span style="color:rgba(184,145,255,0.4);">${reportUrl}</span></p>
  <div style="margin-top:48px;padding:20px 24px;border-top:1px solid rgba(184,145,255,0.08);">
    <p style="font-size:0.62rem;color:rgba(184,145,255,0.18);letter-spacing:3px;margin:0;">MYCOSMICFATE.COM &nbsp;&#183;&nbsp; HELLO@MYCOSMICFATE.COM</p>
  </div>
</body></html>`;

  const textBody = `Your MyCosmicFate reading is ready.\n\nRead it here: ${reportUrl}\n\nmycosmicfate.com`;

  const crypto = require('crypto');
  const region = process.env.AWS_REGION || 'eu-west-1';
  const endpoint = `https://email.${region}.amazonaws.com/v2/email/outbound-emails`;
  const body = JSON.stringify({
    FromEmailAddress: 'MyCosmicFate \u2736 <hello@mycosmicfate.com>',
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
