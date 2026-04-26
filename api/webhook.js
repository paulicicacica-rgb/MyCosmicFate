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
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(data));
  return data.content[0].text;
}

async function generateSoulMatch(a) {
  const dob1 = a.dob0 ? `${a.dob0.day}/${a.dob0.month}/${a.dob0.year}` : 'unknown';
  const dob2 = a.dob1 ? `${a.dob1.day}/${a.dob1.month}/${a.dob1.year}` : 'unknown';
  const connections = ['Romantic partner', 'Someone they are interested in', 'An ex', 'Someone they cannot figure out'];
  const patterns = ['Intense connection then distance', 'Understanding each other too well', 'Same wants different timing', 'One always needs more'];
  const feelings = ['Like themselves completely', 'Like a better version', 'Slightly off balance', 'Waiting for something to break'];
  const get = (arr, idx) => arr[a[idx]] || 'unknown';
  const prompt = `You are writing a cosmic compatibility report for two people. Be specific, direct, honest. No vague language.

THEIR DATA:
- Person 1 born: ${dob1}
- Person 2 born: ${dob2}
- Connection type: ${get(connections, 2)}
- Pattern between them: ${get(patterns, 3)}
- How they feel in the connection: ${get(feelings, 4)}

Write these sections with exact headers:

## SECTION 1: YOUR COSMIC CONNECTION TYPE
What type of soul connection this is. Not generic — specific to these two birth dates and their dynamic.

## SECTION 2: THE PATTERN BETWEEN YOU
Why the pattern they named keeps happening. What each person brings to it. What it is protecting them from.

## SECTION 3: THE KARMIC AXIS
What this relationship is here to teach them. What they owe each other. What becomes possible if they learn it.

## SECTION 4: THE HONEST FORECAST
What this connection actually looks like long term based on their charts. Be honest. Not harsh — honest.

## SECTION 5: THE ONE MOVE
The single most important shift one or both of them needs to make for this connection to reach its potential.

No bullet points. Speak directly to the person reading. Every section must feel specific to these two people.`;
  return callClaude(prompt, 2500);
}

async function generatePastLife(a) {
  const dob = a.dob ? `${a.dob.day}/${a.dob.month}/${a.dob.year}` : 'unknown';
  const eras = ['Ancient — Egypt, Greece, Rome', 'Medieval', 'Renaissance', 'Modern — revolutions, world wars'];
  const gifts = ['Leading and commanding', 'Healing and caring', 'Creating and making', 'Knowing things before they happen'];
  const fears = ['Being trapped or imprisoned', 'Being abandoned', 'Fire, water, sudden disaster', 'Being powerless'];
  const roles = ['Protector or warrior', 'Leader or ruler', 'Healer or guide', 'Outcast or rebel'];
  const get = (arr, idx) => arr[a[idx]] || 'unknown';
  const prompt = `You are writing a past life reading. Write it as a story — vivid, specific, believable. Not a spiritual lecture. A narrative.

THEIR DATA:
- Born: ${dob}
- Era they feel pulled to: ${get(eras, 1)}
- Gift that came naturally: ${get(gifts, 3)}
- Unexplained fear: ${get(fears, 4)}
- Role they keep being pulled into: ${get(roles, 5)}

Write these sections with exact headers:

## WHO YOU WERE
Write 300 words. Tell them who they were in their most significant past life. Give them a name if you feel one. Name the era, the place, the role. Make it vivid and specific. Connect it directly to their answers.

## WHAT YOU LIVED THROUGH
Write 300 words. The key events of that life. What they built, what they lost, how it ended. Make it feel real.

## WHAT YOU CARRIED FORWARD
Write 250 words. The specific things from that life that arrived with them into this one — the gifts, the fears, the patterns, the wounds. Connect each one to what they told you.

## WHAT YOUR SOUL CAME BACK TO COMPLETE
Write 200 words. The unfinished business. What that past life left unresolved. What this life is the continuation of.

End with a single italicised line that names the thread connecting who they were to who they are.

No bullet points. Write in flowing paragraphs. Make it feel like you are telling them their own story.`;
  return callClaude(prompt, 3000);
}

async function generateKarmaScore(a) {
  const dob = a.dob ? `${a.dob.day}/${a.dob.month}/${a.dob.year}` : 'unknown';
  const debts = ['More kindness', 'More honesty', 'More courage', 'Nothing — given enough'];
  const credits = ['A love that stays', 'Recognition', 'A real chance', 'Nothing — no belief'];
  const weights = ['Someone else's guilt', 'Someone else's pain', 'Someone else's expectations', 'Only their own'];
  const releases = ['Need to prove themselves', 'Fear of abandonment', 'Belief they must earn love', 'Running out of time'];
  const get = (arr, idx) => arr[a[idx]] || 'unknown';
  const prompt = `You are writing a karmic debt and credit report. Be direct and honest. This person wants to understand the cosmic balance of their soul.

THEIR DATA:
- Born: ${dob}
- What they feel they owe: ${get(debts, 1)}
- What they feel owed: ${get(credits, 2)}
- What they carry for others: ${get(weights, 4)}
- What they are ready to release: ${get(releases, 5)}

Write these sections with exact headers:

## YOUR KARMIC DEBT
What this soul owes based on their answers and birth chart. Be specific. What action or shift is required to clear it. How long they have been carrying it.

## YOUR KARMIC CREDIT
What the universe owes this soul. What they have given that has not yet been returned. When and how that return typically arrives.

## WHAT YOU ARE CARRYING FOR OTHERS
The weight they admitted to carrying. Where it came from. Why they took it on. What releasing it actually looks like in practice.

## THE RELEASE
The specific thing they said they are ready to let go of. Why now is the right time. What their life looks like on the other side of releasing it. Give them 2 concrete actions.

## YOUR KARMIC VERDICT
One honest paragraph. Where this soul stands in their karmic journey. What the next chapter requires. End with the truest sentence about what they are owed and what they owe.

No bullet points. Speak directly. Be honest without being harsh.`;
  return callClaude(prompt, 2500);
}

async function generateDreamReport(a) {
  const dream = a.dream || 'unknown dream';
  const feelings = ['Afraid or anxious', 'Lost or confused', 'Chased or in danger', 'Calm but aware'];
  const settings = ['A place from the past', 'Somewhere unfamiliar', 'Changes but feels the same', 'No setting — just feelings'];
  const wakes = ['Disturbed — it stays with them', 'Relieved', 'Empty or unsettled', 'Like they received something'];
  const get = (arr, idx) => arr[a[idx]] || 'unknown';
  const prompt = `You are interpreting a recurring dream. This person has been having this dream repeatedly. Your job is to tell them what it means — not in vague spiritual terms, but specifically and honestly.

THE DREAM:
${dream}

HOW THEY FEEL DURING IT: ${get(feelings, 1)}
WHERE IT HAPPENS: ${get(settings, 2)}
HOW THEY FEEL WAKING: ${get(wakes, 5)}

Write these sections with exact headers:

## WHAT YOUR DREAM IS SAYING
Write 300 words. The core message of this dream. What the symbols mean specifically — not from a dream dictionary, but in the context of what they described. What their subconscious is trying to communicate.

## WHAT IT IS CONNECTED TO
Write 300 words. What in their waking life this dream is processing. What event, belief, fear, or unresolved situation generated it. Be specific about the psychological or emotional root.

## WHY IT KEEPS RETURNING
Write 200 words. The reason a dream recurs is always the same — the message hasn't been received. Tell them specifically what they have not yet acknowledged or addressed that is keeping this dream alive.

## HOW TO ANSWER IT
Write 200 words. What they need to do in their waking life for this dream to stop or change. Not symbolic actions — real ones. Specific. Practical. Things that address the actual root.

End with one sentence that names exactly what this dream has been trying to tell them.

No bullet points. Write in flowing paragraphs. Make them feel understood.`;
  return callClaude(prompt, 2500);
}

async function generateBundleReport(a) {
  // Bundle gets cosmic fate + name + past life summary
  const cosmicReport = await generateReport(a, 'basic');
  const nameReport = a.fullname ? await generateNameReport(a) : '';
  if (nameReport) {
    return cosmicReport + '\n\n---\n\n' + nameReport;
  }
  return cosmicReport;
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
  <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 32px;"><tr><td width="80" height="80" align="center" valign="middle" style="border-radius:50%;background:radial-gradient(circle at 35% 35%,#9b6dff,#4a1a8a 50%,#0d0520 80%);font-size:1.6rem;color:#f0eaff;text-align:center;vertical-align:middle;">✦</td></tr></table>
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
    FromEmailAddress: 'MyCosmicFate ✶ <hello@mycosmicfate.com>',
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
