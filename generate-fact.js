const fs = require('fs');

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
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
  const fact = data.candidates[0].content.parts[0].text.trim();
  const today = new Date().toISOString().slice(0, 10);

  fs.writeFileSync('fact.json', JSON.stringify({ text: fact, date: today }, null, 2));
  console.log("Wrote fact for", today, ":", fact);
}

main();
