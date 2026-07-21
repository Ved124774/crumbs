const fs = require('fs');

const HISTORY_FILE = 'history.json';

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

function buildPrompt(history) {
  let prompt = "Give me one short, surprising, true fun fact suitable for a general audience aged 7 and up. Just the fact itself, one or two sentences, no preamble.";
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
        generationConfig: { temperature: 1.2 }
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
  return data.candidates[0].content.parts[0].text.trim();
}

async function callGeminiWithRetries(apiKey, prompt, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await callGeminiOnce(apiKey, prompt);
    } catch (err) {
      console.log(`Attempt ${attempt} failed: ${err.message}`);
      if (attempt === maxAttempts) throw err;
      await new Promise(r => setTimeout(r, 5000 * attempt));
    }
  }
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is missing.");

  const history = loadHistory();
  const prompt = buildPrompt(history);
  const fact = await callGeminiWithRetries(apiKey, prompt);
  const today = new Date().toISOString().slice(0, 10);

  fs.writeFileSync('fact.json', JSON.stringify({ text: fact, date: today }, null, 2));

  const updatedHistory = [...history, fact];
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(updatedHistory, null, 2));

  console.log("Wrote fact for", today, ":", fact);
}

main().catch(err => {
  console.error("Script failed:", err.message);
  process.exit(1);
});
