import Anthropic from "@anthropic-ai/sdk";
import { checkAuth } from "./_auth.js";

const client = new Anthropic(); // ANTHROPIC_API_KEY uit env

// De agent stelt alleen een indeling voor — of die elektrisch klopt bepaalt
// uitsluitend de rekenkern (checkLegplan in src/core/calculations.js),
// client-side, na het toepassen van dit voorstel. Dit endpoint valideert
// alleen de STRUCTUUR van de modelrespons (elke index precies één keer,
// capaciteit gerespecteerd) — nooit de elektrische geldigheid.
function buildPrompt({ strings, nMppt, stringsPerMppt, currentAssignment, instruction, previousAttempt }) {
  const stringLines = strings
    .map((s, i) => `${i}: ${s.n}× ${s.wp}Wp, azimuth ${s.azimuth}°, helling ${s.helling}°`)
    .join("\n");
  const fmtAssignment = (mppts) => mppts.map((idxs, m) => `MPPT ${m + 1}: [${idxs.join(", ")}]`).join("; ");

  let prompt = `Je verdeelt PV-strings over de MPPT-ingangen van een omvormer.

Omvormer: ${nMppt} MPPT's, elk max ${stringsPerMppt} strings.

Strings:
${stringLines}

Huidige indeling: ${fmtAssignment(currentAssignment.mppts)}

Instructie van de installateur: "${instruction}"
`;

  if (previousAttempt) {
    prompt += `
Je vorige voorstel was: ${fmtAssignment(previousAttempt.mppts)}
Dat voorstel voldoet niet aan de elektrische grenzen van de omvormer:
${previousAttempt.failures.map((f) => `- ${f}`).join("\n")}
Los dit specifieke probleem op terwijl je de instructie van de installateur zo veel mogelijk blijft volgen.
`;
  }

  prompt += `
Geef ALLEEN een JSON-object terug: { "mppts": [[...], ...] }
- Precies ${nMppt} arrays, in volgorde van MPPT 1 t/m ${nMppt}.
- Elke string-index (0 t/m ${strings.length - 1}) komt precies één keer voor, verdeeld over de arrays.
- Elk array bevat maximaal ${stringsPerMppt} indices.
Geen markdown, geen uitleg.`;

  return prompt;
}

function validateStructure(mppts, stringsCount, nMppt, stringsPerMppt) {
  if (!Array.isArray(mppts) || mppts.length !== nMppt) return `verwacht ${nMppt} MPPT-arrays, kreeg ${mppts?.length}`;
  const seen = new Set();
  for (const arr of mppts) {
    if (!Array.isArray(arr) || arr.length > stringsPerMppt) return `een MPPT-array is ongeldig of te lang (max ${stringsPerMppt})`;
    for (const idx of arr) {
      if (!Number.isInteger(idx) || idx < 0 || idx >= stringsCount) return `ongeldige string-index: ${idx}`;
      if (seen.has(idx)) return `string-index ${idx} komt dubbel voor`;
      seen.add(idx);
    }
  }
  if (seen.size !== stringsCount) return `niet alle ${stringsCount} strings zijn toegewezen`;
  return null;
}

export default async function handler(req, res) {
  if (!checkAuth(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { strings, nMppt, stringsPerMppt, currentAssignment, instruction, previousAttempt } = req.body || {};
  if (!Array.isArray(strings) || strings.length === 0 || !nMppt || !stringsPerMppt || !currentAssignment || !instruction?.trim()) {
    res.status(400).json({ error: "strings, nMppt, stringsPerMppt, currentAssignment en instruction zijn verplicht." });
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: "ANTHROPIC_API_KEY ontbreekt op de server." });
    return;
  }

  let text;
  try {
    const msg = await client.messages.create({
      model: process.env.ANTHROPIC_REASSIGN_MODEL || "claude-sonnet-5",
      max_tokens: 1024,
      messages: [{ role: "user", content: buildPrompt({ strings, nMppt, stringsPerMppt, currentAssignment, instruction, previousAttempt }) }],
    });
    text = msg.content.map((b) => b.text || "").join("");
  } catch (e) {
    res.status(502).json({ error: `Model aanroepen mislukt: ${e.message}` });
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch {
    res.status(502).json({ error: "Kon het antwoord van de agent niet lezen. Probeer een andere instructie.", raw: text });
    return;
  }

  const structureError = validateStructure(parsed.mppts, strings.length, nMppt, stringsPerMppt);
  if (structureError) {
    res.status(502).json({ error: `Voorstel van de agent is ongeldig: ${structureError}. Probeer een andere instructie.` });
    return;
  }

  res.status(200).json({ mppts: parsed.mppts });
}
