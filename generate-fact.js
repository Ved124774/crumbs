const fs = require('fs');

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is missing. Check that the repository secret is named exactly GEMINI_API_KEY.");
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "Give me one short, surprising, true fun fact suitable for a general audience aged 7 and up. Just the fact itself, one or two sentences, no preamble." }] }]
      })
    }
  );

  const data = await res.json();

  // Always log the raw response so failures are debuggable, not just crashes
  console.log("HTTP status:", res.status);
  console.log("API response:", JSON.stringify(data, null, 2));

  if (!res.ok) {
    throw new Error(`Gemini API returned an error (status ${res.status}). See logged response above.`);
  }

  if (data.error) {
    throw new Error(`Gemini API error: ${data.error.message || JSON.stringify(data.error)}`);
  }

  if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
    throw new Error("Response had no usable candidate. Full response logged above — check for a safety block or quota issue.");
  }

  const fact = data.candidates[0].content.parts[0].text.trim();
  const today = new Date().toISOString().slice(0, 10);

  fs.writeFileSync('fact.json', JSON.stringify({ text: fact, date: today }, null, 2));
  console.log("Wrote fact for", today, ":", fact);
}

main().catch(err => {
  console.error("Script failed:", err.message);
  process.exit(1);
});
