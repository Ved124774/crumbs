const fs = require('fs');

const HISTORY_FILE = 'history.json';

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

function buildPrompt(history, category) {
  let prompt = `Give me one true fact from the category of ${category}, suitable for a general audience aged 7 and up. ` +
    "Accuracy matters more than anything else here. Only choose a fact you are highly confident is correct, well-established, and would appear consistently across reputable reference sources, such as an encyclopedia or textbook. " +
    "Avoid obscure claims, and avoid precise statistics, dates, or numbers unless they are extremely well-known and unlikely to be misremembered, since specific figures are the most common source of subtle errors. " +
    "If you are not fully confident in a fact, choose a different, simpler fact you are certain about instead, even if it is less surprising. " +
    "At the same time, avoid facts so basic or commonly taught that most adults already know them; look for something true and verifiable but genuinely less obvious. " +
    "Presentation matters a lot: state the fact in the most vivid, concrete way possible rather than an abstract, generic, textbook phrasing. Where it fits naturally, anchor it with a real comparison to something familiar (size, time, distance, quantity) rather than stating a number in isolation. " +
    "For example, instead of 'Honey does not spoil,' prefer something like 'Archaeologists have found pots of honey in ancient Egyptian tombs that are still perfectly edible after 3,000 years.' Same idea, far more vivid and concrete. " +
    "Fact requirements: one or two sentences, plain text with no markdown and no surrounding quotation marks. " +
    "Use metric units (kilograms, metres, kilometres, Celsius) rather than imperial units. " +
    "Do not use em dashes; use commas or separate sentences instead. " +
    "Do not use exclamation marks in the fact; keep its tone calm and matter-of-fact, even while being vivid. " +
    "State the fact plainly and confidently; do not use hedging phrases like 'scientists believe' or 'some say'. " +
    "Avoid anything violent, disturbing, or scary. Avoid any reference to drugs, alcohol, tobacco, or other controlled or illegal substances, even in a purely historical or scientific context. " +
    "Also write a short push notification teaser for this fact: playful and curious in tone (unlike the calm fact itself), under 90 characters, that hints at the fact without revealing the actual answer or detail, to make someone curious enough to open the app. It may include one relevant emoji if it fits naturally, but don't force one. " +
    "For reference, here is an example showing the tone and format we want (do not reuse this exact fact, or anything closely resembling it, as your actual answer; it is only to illustrate style): " +
    `Example fact: "There are more possible unique chess games than there are atoms in the observable universe." ` +
    `Example notification: "Psst... want to know why a group of ravens is called a murder? 🐦" ` +
    `Respond only with valid JSON in exactly this format, no other text before or after: {"fact": "...", "notification": "..."}`;
  if (history.length > 0) {
    prompt += " Do not repeat or closely resemble any of these facts already used recently: " + history.map(h => `"${h}"`).join(", ") + ".";
  }
  return prompt;
}

async function callGroqOnce(apiKey, prompt) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      temperature: 1.1,
      response_format: { type: "json_object" }
    })
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(`Groq API error (status ${res.status}): ${data.error ? data.error.message : JSON.stringify(data)}`);
  }
  const rawText = data.choices[0].message.content.trim();
  const parsed = JSON.parse(rawText);
  if (!parsed.fact || !parsed.notification) {
    throw new Error("Response missing required fields: " + rawText);
  }
  return parsed;
}

async function callGroqWithRetries(apiKey, prompt, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await callGroqOnce(apiKey, prompt);
    } catch (err) {
      const isQuotaError = err.message.includes("429") || err.message.includes("quota") || err.message.includes("rate_limit");
      console.log(`Attempt ${attempt} failed: ${err.message}`);
      if (isQuotaError || attempt === maxAttempts) throw err;
      await new Promise(r => setTimeout(r, 5000 * attempt));
    }
  }
}

async function main() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY is missing.");

  const history = loadHistory();
  const category = pickCategory();
  const prompt = buildPrompt(history, category);
  const result = await callGroqWithRetries(apiKey, prompt);
  const today = new Date().toISOString().slice(0, 10);

  fs.writeFileSync('fact.json', JSON.stringify({
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
