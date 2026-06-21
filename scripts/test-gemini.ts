import { GoogleGenAI } from "@google/genai";
import "dotenv/config";

async function main() {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_GEMINI_API_KEY not set");

  const ai = new GoogleGenAI({ apiKey });
  console.log("Pinging gemini-2.5-flash-lite with a one-token request...");
  try {
    const r = await ai.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents: [{ role: "user", parts: [{ text: "Say only the word: ok" }] }],
      config: { temperature: 0 },
    });
    console.log("✓ Response:", JSON.stringify(r.text));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log("✗ Failed:", msg.slice(0, 800));
  }
}

main();
