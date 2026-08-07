import Anthropic from "@anthropic-ai/sdk";
import { requireUser } from "./_auth.js";

const client = new Anthropic(); // ANTHROPIC_API_KEY uit env

// Anders dan parse-stringplan.js: hier is er nog GEEN stringindeling, alleen
// panelen per dakvlak/oriëntatie. Bewust een eigen, simpele prompt i.p.v. een
// derde geval in de al twee-smakige stringplan-prompt te proppen — dat soort
// dubbelzinnigheid leidde eerder al tot een dubbeltelling. Zelfde
// totaal+waarvan-valkuil kan zich hier ook voordoen (bijv. Sollit-achtige
// tools tonen "49x ... panelen (25970 Wp)" gevolgd door een "waarvan"-
// uitsplitsing naar oriëntatie) — dezelfde expliciete waarschuwing dus.
const PROMPT = `Lees dit paneel-/dakvlak-overzicht. Er is nog GEEN stringindeling gemaakt — alleen het aantal panelen per dakvlak/oriëntatie, eventueel met het paneeltype erboven.
Geef JSON terug:
{
  "panelWp": <vermogen per paneel in Wp, of null als niet leesbaar>,
  "panelFabrikant": "<merknaam, bijv. 'JA Solar', of null>",
  "roofFaces": [{ "count": <aantal panelen op dit dakvlak>, "azimuth": <graden, 0-359>, "helling": <graden, 0-90> }, ...]
}

Vaak staat er eerst een totaalregel (bijv. "49x Zonnepaneel ... 530Wp JA Solar ... (25970 Wp)"), gevolgd door een uitsplitsing naar oriëntatie (bijv. "33 panelen Azimuth: 150°; Helling: 15°" en "16 panelen Azimuth: 151°; Helling: 15°"). Geef in dat geval GEEN apart dakvlak-object voor de totaalregel — die is uitsluitend de som van de uitsplitsing eronder. Alleen één object per regel in de uitsplitsing. Tel nooit de totaalregel én de uitsplitsing allebei mee — dat verdubbelt het aantal panelen.

Geef alleen JSON terug, geen markdown, geen uitleg. Als je een veld niet zeker kan lezen, zet de waarde op null — gok niet.`;

export default async function handler(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
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

  let parsed;
  try {
    parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    if (!Array.isArray(parsed.roofFaces)) throw new Error("geen array");
  } catch {
    res.status(502).json({ error: "Kon de screenshot niet als dakvlak-overzicht lezen. Probeer opnieuw of vul handmatig in.", raw: text });
    return;
  }

  res.status(200).json({ roofFaces: parsed.roofFaces, panelWp: parsed.panelWp ?? null, panelFabrikant: parsed.panelFabrikant ?? null });
}
