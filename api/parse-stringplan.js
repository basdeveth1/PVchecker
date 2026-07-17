import Anthropic from "@anthropic-ai/sdk";
import { checkAuth } from "./_auth.js";

const client = new Anthropic(); // ANTHROPIC_API_KEY uit env

const PROMPT = `Lees dit Sollit-stringplan. Geef voor elke string een JSON-object terug met:
{ "n": <aantal panelen>, "wp": <vermogen per paneel in Wp>, "fabrikant": "<naam>",
  "azimuth": <graden, 0-359>, "helling": <graden, 0-90> }
Geef een JSON-array, niets anders. Geen markdown, geen uitleg.
Als je een veld niet kan lezen, zet de waarde op null in plaats van te gokken.`;

export default async function handler(req, res) {
  if (!checkAuth(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { imageBase64, mediaType } = req.body || {};
  if (!imageBase64 || !mediaType) {
    res.status(400).json({ error: "imageBase64 en mediaType zijn verplicht." });
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: "ANTHROPIC_API_KEY ontbreekt op de server." });
    return;
  }

  let text;
  try {
    const msg = await client.messages.create({
      model: process.env.ANTHROPIC_VISION_MODEL || "claude-sonnet-5",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    });
    text = msg.content.map((b) => b.text || "").join("");
  } catch (e) {
    res.status(502).json({ error: `Vision-model aanroepen mislukt: ${e.message}` });
    return;
  }

  let strings;
  try {
    strings = JSON.parse(text.replace(/```json|```/g, "").trim());
    if (!Array.isArray(strings)) throw new Error("geen array");
  } catch {
    res.status(502).json({ error: "Kon de screenshot niet als stringplan lezen. Probeer opnieuw of vul handmatig in.", raw: text });
    return;
  }

  res.status(200).json({ strings });
}
