import { GoogleGenAI } from "@google/genai";
import "dotenv/config";

async function main() {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_GEMINI_API_KEY not set");

  const ai = new GoogleGenAI({ apiKey });
  const list = await ai.models.list();
  console.log("Available models supporting generateContent:");
  for await (const m of list) {
    if (m.supportedActions?.includes("generateContent")) {
      console.log(`  ${m.name}`);
    }
  }
}

main();
