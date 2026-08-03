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
  let prompt = `Give me one short, true fact from the category of ${category}, suitable for a general audience aged 7 and up. ` +
    "Accuracy matters more than anything else here. Only choose a fact you are highly confident is correct, well-established, and would appear consistently across reputable reference sources, such as an encyclopedia or textbook. " +
    "Avoid obscure claims, and avoid precise statistics, dates, or numbers unless they are extremely well-known and unlikely to be misremembered, since specific figures are the most common source of subtle errors. " +
    "If you are not fully confident in a fact, choose a different, simpler fact you are certain about instead, even if it is less surprising. " +
    "Fact requirements: one or two sentences, plain text with no markdown and no surrounding quotation marks. " +
    "Use metric units (kilograms, metres, kilometres, Celsius) rather than imperial units. " +
    "Do not use em dashes; use commas or separate sentences instead. " +
    "Do not use exclamation marks in the fact; keep its tone calm and matter-of-fact. " +
    "State the fact plainly and confidently; do not use hedging phrases like 'scientists believe' or 'some say'. " +
    "Avoid anything violent, disturbing, or scary. " +
    "Also write a short push notification teaser for this fact: playful and curious in tone (unlike the calm fact itself), under 90 characters, that hints at the fact without revealing the actual answer or detail, to make someone curious enough to open the app. It may include one relevant emoji if it fits naturally, but don't force one.";
  if (history.length > 0) {
    prompt += " Do not repeat or closely resemble any of these facts already used recently: " + history.map(h => `"${h}"`).join(", ") + ".";
  }
  return prompt;
}

async function callGeminiOnce(apiKey, prompt) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 1.1,
          responseMimeType: "application/json",
          responseSchema: {
            type: "object",
            properties: {
              fact: { type: "string" },
              notification: { type: "string" }
            },
            required: ["fact", "notification"]
          }
        }
      })
    }
  );
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(`Gemini API error (status ${res.status}): ${data.error ? data.error.message : JSON.stringify(data)}`);
  }
  if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
    throw new Error("No usable candidate in response: " + JSON.stringify(data));
  }
  const rawText = data.candidates[0].content.parts[0].text.trim();
  const parsed = JSON.parse(rawText);
  if (!parsed.fact || !parsed.notification) {
    throw new Error("Response missing required fields: " + rawText);
  }
  return parsed;
}

async function callGeminiWithRetries(apiKey, prompt, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await callGeminiOnce(apiKey, prompt);
    } catch (err) {
      const isQuotaError = err.message.includes("429") || err.message.includes("quota");
      console.log(`Attempt ${attempt} failed: ${err.message}`);
      if (isQuotaError || attempt === maxAttempts) throw err;
      await new Promise(r => setTimeout(r, 5000 * attempt));
    }
  }
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is missing.");

  const history = loadHistory();
  const category = pickCategory();
  const prompt = buildPrompt(history, category);
  const result = await callGeminiWithRetries(apiKey, prompt);
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
