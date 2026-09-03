const fs = require('fs');

const HISTORY_FILE = 'history.json';
const FACT_FILE = 'fact.json';
const MAX_FACT_LENGTH = 160;

const CATEGORIES = [
  "science", "history", "space", "animals", "geography",
  "the human body", "technology", "the ocean", "ancient civilizations", "language and words"
];

function loadHistory() {
  if (fs.existsSync(HISTORY_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    } catch {
      return [];
    }
  }
  return [];
}

function pickCategory() {
  const dayIndex = Math.floor(Date.now() / 86400000);
  return CATEGORIES[dayIndex % CATEGORIES.length];
}

function buildPrompt(history, category, rejectionNote) {
  let prompt = `Give me one true fact from the category of ${category}, suitable for a general audience aged 7 and up. ` +
    "HARD LENGTH LIMIT: the fact must be under 150 characters. This is a strict requirement, not a suggestion; a fact over 150 characters will be rejected automatically regardless of how good it is. Count carefully before answering. " +
    "Accuracy matters more than anything else here. Only choose a fact you are highly confident is correct, well-established, and would appear consistently across reputable reference sources, such as an encyclopedia or textbook. " +
    "Avoid obscure claims, and avoid precise statistics, dates, or numbers unless they are extremely well-known and unlikely to be misremembered, since specific figures are the most common source of subtle errors. " +
    "Pay special attention to comparisons and superlatives (e.g. 'more than X', 'the largest', 'more Y than all Z combined') and to units of measurement (kg vs lbs, metres vs feet) since these are the most common source of small but real errors. " +
    "Do not combine two separate real techniques or facts into one claim that implies they happened together, unless that combination is itself well documented. " +
    "If you are not fully confident in a fact, choose a different, simpler fact you are certain about instead, even if it is less surprising. " +
    "At the same time, avoid facts so basic or commonly taught that most adults already know them; look for something true and verifiable but genuinely less obvious. " +
    "Presentation matters, within the length limit: prefer a vivid, concrete phrasing over an abstract, generic one, but never let vividness push you over 150 characters; a shorter, simpler true fact is always better than a longer, more elaborate one. " +
    "Important: vivid framing must remain literally, physically true, not just true in spirit. " +
    "Plain text only, no markdown, no surrounding quotation marks. Use metric units (kilograms, metres, kilometres, Celsius) rather than imperial units. " +
    "Do not use em dashes; use commas or separate sentences instead. Do not use exclamation marks; keep the tone calm and matter-of-fact. " +
    "State the fact plainly and confidently; do not use hedging phrases like 'scientists believe' or 'some say'. " +
    "Avoid anything violent, disturbing, or scary. Avoid any reference to drugs, alcohol, tobacco, or other controlled or illegal substances, even in a purely historical or scientific context. " +
    "Also write a short push notification teaser: playful and curious in tone, under 90 characters, that hints at the fact without revealing the answer, to make someone curious enough to open the app. One relevant emoji is fine if it fits naturally, but don't force one. " +
    `Respond only with valid JSON in exactly this format, no other text before or after: {"fact": "...", "notification": "..."}`;
  if (history.length > 0) {
    prompt += " Do not repeat or closely resemble any of these facts already used recently: " + history.map(h => `"${h}"`).join(", ") + ".";
  }
  if (rejectionNote) {
    prompt += ` Your previous attempt was rejected: the fact "${rejectionNote.fact}" had this problem: ${rejectionNote.issue}. Choose a different fact and avoid this exact kind of error.`;
  }
  return prompt;
}

async function callGroqRaw(apiKey, messages, maxTokens) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "openai/gpt-oss-120b",
      messages,
      temperature: 1.1,
      max_completion_tokens: maxTokens,
      response_format: { type: "json_object" }
    })
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(`Groq API error (status ${res.status}): ${data.error ? data.error.message : JSON.stringify(data)}`);
  }
  return JSON.parse(data.choices[0].message.content.trim());
}

async function withRetries(fn, maxAttempts = 4) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isRateLimit = err.message.includes("rate_limit") || err.message.includes("tokens per minute") || err.message.includes("TPM") || err.message.includes("429");
      console.log(`Attempt ${attempt} failed: ${err.message}`);
      if (!isRateLimit || attempt === maxAttempts) throw err;
      const waitSeconds = 20 * attempt;
      console.log(`Rate limit hit, waiting ${waitSeconds}s before retrying...`);
      await new Promise(r => setTimeout(r, waitSeconds * 1000));
    }
  }
}

async function generateFact(apiKey, prompt) {
  const parsed = await withRetries(() => callGroqRaw(apiKey, [{ role: "user", content: prompt }], 300));
  if (!parsed.fact || !parsed.notification) {
    throw new Error("Response missing required fields: " + JSON.stringify(parsed));
  }
  return parsed;
}

async function verifyFact(apiKey, factText) {
  const verifyPrompt =
    "You are a strict, skeptical fact-checker. Verify this claim: " +
    `"${factText}" ` +
    "Check especially: comparisons/superlatives must be precisely correct, not roughly true; units must be exactly correct (kg vs lbs, metres vs feet); numbers must be accurate; the claim must not combine two separate real things into one false combined claim. " +
    "Keep your explanation to one short sentence, maximum 15 words. " +
    `Respond only with valid JSON, no other text: {"accurate": true or false, "issue": "brief reason if false, otherwise null"}`;
  return withRetries(() => callGroqRaw(apiKey, [{ role: "user", content: verifyPrompt }], 100));
}

async function generateVerifiedFact(apiKey, history, category, maxRegenerations = 3) {
  let rejectionNote = null;
  for (let attempt = 1; attempt <= maxRegenerations; attempt++) {
    const prompt = buildPrompt(history, category, rejectionNote);
    const result = await generateFact(apiKey, prompt);
    console.log(`Generation attempt ${attempt}: "${result.fact}" (${result.fact.length} chars)`);

    if (result.fact.length > MAX_FACT_LENGTH) {
      console.log(`Rejected: too long (${result.fact.length} chars, max ${MAX_FACT_LENGTH})`);
      rejectionNote = { fact: result.fact, issue: `too long at ${result.fact.length} characters, must be under 150` };
      continue;
    }

    const verification = await verifyFact(apiKey, result.fact);
    if (verification.accurate) {
      console.log("Verified accurate.");
      return result;
    }

    console.log(`Verification failed: ${verification.issue}`);
    rejectionNote = { fact: result.fact, issue: verification.issue };
  }
  return null;
}

async function main() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY is missing.");

  const history = loadHistory();
  const category = pickCategory();
  const today = new Date().toISOString().slice(0, 10);

  const result = await generateVerifiedFact(apiKey, history, category);

  if (!result) {
    console.log("No fact passed verification after multiple attempts. Keeping yesterday's fact unchanged.");
    return;
  }

  fs.writeFileSync(FACT_FILE, JSON.stringify({
    text: result.fact,
    notification: result.notification,
    date: today
  }, null, 2));

  const updatedHistory = [...history, result.fact];
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(updatedHistory, null, 2));

  console.log("Wrote fact for", today, ":", result.fact);
  console.log("Notification:", result.notification);
}

main().catch(err => {
  console.error("Script failed:", err.message);
  process.exit(1);
});
