import Anthropic from "@anthropic-ai/sdk";
import { checkAuth } from "./_auth.js";

const client = new Anthropic(); // ANTHROPIC_API_KEY uit env

// Zelfde velden als PANEL_VARIANT_FIELDS/INVERTER_VARIANT_FIELDS in
// PVConfigurator.jsx en VARIANT_FIELDS in api/components.js — één datasheet
// dekt vaak een hele familie (meerdere Wp-varianten), vandaar een array.
function buildPrompt(type) {
  if (type === "panel") {
    return `Lees deze paneel-datasheet. Geef terug:
{
  "familyName": "<merk + modelserie, bijv. 'JA Solar JAM54D41 GB (430 serie)'>",
  "betaVoc": <temperatuurcoëfficiënt Voc in %/°C, negatief getal>,
  "vsysMax": <maximale systeemspanning in V>,
  "variants": [
    { "id": "<exacte type-aanduiding>", "wp": <Wp>, "voc": <V>, "vmp": <V>, "isc": <A>, "imp": <A> }
  ]
}
Eén datasheet beschrijft vaak meerdere vermogensklassen (bijv. 410-435W) — geef voor elke klasse een apart object in "variants".
Geef alleen JSON terug, geen markdown, geen uitleg. Als je een veld niet zeker kan lezen, zet de waarde op null — gok niet.`;
  }
  return `Lees deze omvormer-datasheet. Geef terug:
{
  "familyName": "<merk + serienaam>",
  "variants": [
    {
      "id": "<exacte type-aanduiding>", "pmax": <max. DC-vermogen in W>, "vmax": <max. DC-spanning in V>,
      "vmpptMin": <V>, "vmpptMax": <V>, "imppt": <max. stroom per MPPT in A>, "isc": <max. kortsluitstroom per MPPT in A>,
      "nMppt": <aantal MPPT's>, "stringsPerMppt": <strings per MPPT>, "pacNom": <nominaal AC-vermogen in W>,
      "iacMax": <max. AC-stroom in A>, "iacMaxComputed": <true als je iacMax zelf berekende via pacNom/400V/√3 omdat de datasheet 'm niet expliciet geeft, anders false>
    }
  ]
}
Eén datasheet beschrijft vaak meerdere vermogensklassen — geef voor elke klasse een apart object in "variants".
Geef alleen JSON terug, geen markdown, geen uitleg. Als je een veld niet zeker kan lezen, zet de waarde op null — gok niet.`;
}

export default async function handler(req, res) {
  if (!checkAuth(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { fileBase64, mediaType, type } = req.body || {};
  if (!fileBase64 || !mediaType || (type !== "panel" && type !== "inverter")) {
    res.status(400).json({ error: "fileBase64, mediaType en type ('panel'/'inverter') zijn verplicht." });
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: "ANTHROPIC_API_KEY ontbreekt op de server." });
    return;
  }

  const isPdf = mediaType === "application/pdf";
  const fileBlock = isPdf
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: fileBase64 } }
    : { type: "image", source: { type: "base64", media_type: mediaType, data: fileBase64 } };

  let text;
  try {
    const msg = await client.messages.create({
      model: process.env.ANTHROPIC_VISION_MODEL || "claude-sonnet-5",
      max_tokens: 2048,
      messages: [{ role: "user", content: [fileBlock, { type: "text", text: buildPrompt(type) }] }],
    });
    text = msg.content.map((b) => b.text || "").join("");
  } catch (e) {
    res.status(502).json({ error: `Vision-model aanroepen mislukt: ${e.message}` });
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    if (!parsed.familyName || !Array.isArray(parsed.variants)) throw new Error("onverwachte vorm");
  } catch {
    res.status(502).json({ error: "Kon de datasheet niet als componenten lezen. Probeer opnieuw of vul handmatig in.", raw: text });
    return;
  }

  res.status(200).json(parsed);
}
