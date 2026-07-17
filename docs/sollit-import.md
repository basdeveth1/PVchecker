# Sollit-stringplan import (screenshot → strings)

## Doel

Een Sollit-stringplan screenshot automatisch omzetten naar de strings-invoer van de legplan-check, zodat je niet handmatig hoeft over te typen.

## Status: geïmplementeerd

Dit is gebouwd. De endpoint is `api/parse-stringplan.js`, de upload-UI zit in
zowel "Configuratie checken" als "Legplan-check" in
`src/components/PVConfigurator.jsx`. `ANTHROPIC_API_KEY` moet je zelf in
`.env.local` en de Vercel-omgevingsvariabelen zetten — die staat niet in de
repo.

## Waarom dit een backend vereist

Een React-frontend kan geen vision-model aanroepen zonder een API-sleutel bloot te stellen. De extractie moet via een backend-endpoint dat:

1. de geüploade afbeelding ontvangt
2. die naar Claude stuurt met een prompt die om gestructureerde JSON vraagt
3. de strings teruggeeft aan de frontend

## Wat het model uit de screenshot moet halen

Per string in het legplan:
- aantal panelen
- paneeltype (Wp, fabrikant) — koppelen aan de component-database
- azimuth (°)
- helling (°)

In de voorbeeldscreenshots van Sollit staat dit als rijen, bijv. "19x JA Solar - 430 Wp ... Azimuth: 142°; Helling: 5°".

## Voorgestelde prompt-structuur

Vraag het model expliciet om **alleen JSON** terug te geven, geen toelichting:

```
Lees dit Sollit-stringplan. Geef voor elke string een JSON-object terug met:
{ "n": <aantal panelen>, "wp": <vermogen per paneel>, "fabrikant": "<naam>",
  "azimuth": <graden>, "helling": <graden> }
Geef een JSON-array, niets anders. Geen markdown, geen uitleg.
```

## Belangrijke aandachtspunten

- **Koppeling aan database**: het model geeft "JA Solar 430 Wp" terug; matchen aan de exacte database-variant (`JAM54D41-430/GB`) doet de frontend, niet het model. Bij meerdere kandidaten: vraag de gebruiker.
- **Controlestap**: toon de geëxtraheerde strings altijd ter bevestiging vóór de check. OCR/vision kan een cijfer verkeurd lezen — een verkeerde azimuth of aantal verandert de uitkomst.
- **Geen aannames**: als het model een veld niet kan lezen, laat het leeg en vraag de gebruiker, in plaats van te gokken.

## Endpoint (Vercel serverless, zoals gebouwd)

Geen multipart — de frontend leest het bestand zelf als base64 via
`FileReader.readAsDataURL` en stuurt een gewone JSON-body. Dat is simpeler en
betrouwbaarder in een Vercel Node-function dan multipart-parsing (geen
extra dependency zoals `multer`/`busboy` nodig, en Vercel parsed JSON-bodies
al automatisch, zie `api/configs.js`).

```js
// POST /api/parse-stringplan  body: { imageBase64, mediaType }
import Anthropic from "@anthropic-ai/sdk";
const client = new Anthropic(); // ANTHROPIC_API_KEY uit env

export default async function handler(req, res) {
  const { imageBase64, mediaType } = req.body;
  const msg = await client.messages.create({
    model: process.env.ANTHROPIC_VISION_MODEL || "claude-sonnet-5",
    max_tokens: 1024,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
        { type: "text", text: PROMPT } // de prompt hierboven
      ]
    }]
  });
  const text = msg.content.map(b => b.text || "").join("");
  const strings = JSON.parse(text.replace(/```json|```/g, "").trim());
  res.status(200).json({ strings });
}
```

De frontend (`matchExtractedPanel` in `PVConfigurator.jsx`) matcht elke
`{ fabrikant, wp }` aan een database-variant op Wp (±2 W) + familienaam.
Bij precies één match wordt die voorgesteld, anders laat het veld leeg voor
handmatige keuze. Niets wordt toegepast voordat de gebruiker de
bevestigingstabel met "Toepassen" accepteert.
