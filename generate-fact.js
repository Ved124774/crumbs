const fs = require('fs');

const HISTORY_FILE = 'history.json';
const FACT_FILE = 'fact.json';
const MAX_FACT_LENGTH = 150;

const CATEGORIES = [
  "science", "history", "space", "animals", "geography",
  "the human body", "technology", "the ocean", "ancient civilizations", "language and words"
];

const FACT_SCHEMA = {
  name: "fact_response",
  strict: true,
  schema: {
    type: "object",
    properties: {
      fact: { type: "string" },
      notification: { type: "string" }
    },
    required: ["fact", "notification"],
    additionalProperties: false
  }
};

const VERIFY_SCHEMA = {
  name: "verify_response",
  strict: true,
  schema: {
    type: "object",
    properties: {
      accurate: { type: "boolean" },
      issue: { type: ["string", "null"] }
    },
    required: ["accurate", "issue"],
    additionalProperties: false
  }
};

const DUPLICATE_SCHEMA = {
  name: "duplicate_response",
  strict: true,
  schema: {
    type: "object",
    properties: {
      is_duplicate: { type: "boolean" },
      matched: { type: ["string", "null"] }
    },
    required: ["is_duplicate", "matched"],
    additionalProperties: false
  }
};

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

function isExactRepeat(factText, history) {
  const normalize = s => s.trim().toLowerCase().replace(/[.,!?]/g, '');
  const normalizedFact = normalize(factText);
  return history.some(h => normalize(h) === normalizedFact);
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
    "Also write a short push notification teaser: playful and curious in tone, under 90 characters, that hints at the fact without revealing the answer, to make someone curious enough to open the app. One relevant emoji is fine if it fits naturally, but don't force one.";
  if (history.length > 0) {
    prompt += " Do not repeat or closely resemble any of these facts already used recently: " + history.map(h => `"${h}"`).join(", ") + ".";
  }
  if (rejectionNote) {
    prompt += ` Your previous attempt was rejected: the fact "${rejectionNote.fact}" had this problem: ${rejectionNote.issue}. Choose a different fact and avoid this exact kind of error.`;
  }
  return prompt;
}

function buildSafeFallbackPrompt(history, category) {
  let prompt = `Give me one extremely well-known, widely documented, simple true fact from the category of ${category}, suitable for a general audience aged 7 and up. ` +
    "This is a fallback request: prioritize certainty and simplicity far above novelty or vividness. Choose something that would appear identically in almost any encyclopedia, with no room for ambiguity, no comparisons, no superlatives, and no precise numbers. " +
    "Keep it under 150 characters, one sentence if possible. Plain text, no markdown, no quotation marks. Use metric units. No em dashes, no exclamation marks. " +
    "Also write a short, calm push notification teaser under 90 characters that hints at the fact without revealing it.";
  if (history.length > 0) {
    prompt += " Avoid repeating these recent facts: " + history.slice(-15).map(h => `"${h}"`).join(", ") + ".";
  }
  return prompt;
}

async function callGroqRaw(apiKey, messages, maxTokens, schema) {
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
      reasoning_effort: "low",
      response_format: { type: "json_schema", json_schema: schema }
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
  const parsed = await withRetries(() => callGroqRaw(apiKey, [{ role: "user", content: prompt }], 700, FACT_SCHEMA));
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
    "If accurate, set issue to null. Otherwise keep the issue explanation to one short sentence, maximum 15 words.";
  return withRetries(() => callGroqRaw(apiKey, [{ role: "user", content: verifyPrompt }], 300, VERIFY_SCHEMA));
}

async function checkDuplicate(apiKey, factText, history) {
  if (history.length === 0) return { is_duplicate: false, matched: null };
  const checkPrompt =
    "Compare this new fact against a list of recently used facts. " +
    `New fact: "${factText}" ` +
    "Recently used facts: " + history.map(h => `"${h}"`).join(", ") + ". " +
    "Is the new fact the same underlying fact as any of these, or a close rewording of one, even if the phrasing is different? Focus on whether the core piece of information is the same, not just whether the wording matches. " +
    "If it is a duplicate, set matched to the matching fact, kept under 12 words. Otherwise set matched to null.";
  return withRetries(() => callGroqRaw(apiKey, [{ role: "user", content: checkPrompt }], 300, DUPLICATE_SCHEMA));
}

async function tryOneCandidate(apiKey, prompt, history) {
  const result = await generateFact(apiKey, prompt);
  console.log(`Candidate: "${result.fact}" (${result.fact.length} chars)`);

  if (result.fact.length > MAX_FACT_LENGTH) {
    return { ok: false, result, issue: `too long at ${result.fact.length} characters, must be under 150` };
  }
  if (isExactRepeat(result.fact, history)) {
    return { ok: false, result, issue: "this is an exact repeat of a fact already used before" };
  }
  const dupCheck = await checkDuplicate(apiKey, result.fact, history);
  if (dupCheck.is_duplicate) {
    return { ok: false, result, issue: `too similar to a previously used fact: "${dupCheck.matched}"` };
  }
  const verification = await verifyFact(apiKey, result.fact);
  if (!verification.accurate) {
    return { ok: false, result, issue: verification.issue };
  }
  return { ok: true, result };
}

async function generateVerifiedFact(apiKey, history, category, maxRegenerations = 6) {
  let rejectionNote = null;
  for (let attempt = 1; attempt <= maxRegenerations; attempt++) {
    console.log(`--- Attempt ${attempt} of ${maxRegenerations} ---`);
    const prompt = buildPrompt(history, category, rejectionNote);
    const outcome = await tryOneCandidate(apiKey, prompt, history);
    if (outcome.ok) {
      console.log("Verified accurate and not a duplicate.");
      return outcome.result;
    }
    console.log(`Rejected: ${outcome.issue}`);
    rejectionNote = { fact: outcome.result.fact, issue: outcome.issue };
  }

  console.log("--- Normal attempts exhausted, trying safe fallback ---");
  for (let attempt = 1; attempt <= 2; attempt++) {
    const prompt = buildSafeFallbackPrompt(history, category);
    const outcome = await tryOneCandidate(apiKey, prompt, history);
    if (outcome.ok) {
      console.log("Fallback fact verified.");
      return outcome.result;
    }
    console.log(`Fallback rejected: ${outcome.issue}`);
  }

  return null;
}

// If everything above fails, reach back into history rather than repeat
// yesterday's fact. Picks something from at least ~14 entries back if
// there's enough history, so it reads as "an old favorite" rather than
// a suspicious back-to-back repeat.
function pickOldFactForRecycling(history) {
  if (history.length === 0) return null;
  const minBack = 14;
  if (history.length > minBack) {
    const pool = history.slice(0, history.length - minBack);
    return pool[Math.floor(Math.random() * pool.length)];
  }
  return history[0];
}

async function main() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY is missing.");

  const history = loadHistory();
  const category = pickCategory();
  const today = new Date().toISOString().slice(0, 10);

  const result = await generateVerifiedFact(apiKey, history, category);

  if (!result) {
    console.log("No fact passed checks even with fallback. Recycling an older fact instead of repeating yesterday's.");
    const recycled = pickOldFactForRecycling(history);
    const text = recycled || "Here's a fact: today's new one is taking a little longer than usual.";
    fs.writeFileSync(FACT_FILE, JSON.stringify({
      text,
      notification: "Today's fact is ready for you.",
      date: today
    }, null, 2));
    console.log("Recycled fact for", today, ":", text);
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
