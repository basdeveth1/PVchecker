# Sollit-stringplan import (screenshot → strings)

## Doel

Een Sollit-stringplan screenshot automatisch omzetten naar de strings-invoer van de legplan-check, zodat je niet handmatig hoeft over te typen.

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

## Endpoint-schets (Node/Express voorbeeld)

```js
// POST /api/parse-stringplan  (multipart: image)
import Anthropic from "@anthropic-ai/sdk";
const client = new Anthropic(); // ANTHROPIC_API_KEY uit env

app.post("/api/parse-stringplan", upload.single("image"), async (req, res) => {
  const base64 = req.file.buffer.toString("base64");
  const msg = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: req.file.mimetype, data: base64 } },
        { type: "text", text: PROMPT } // de prompt hierboven
      ]
    }]
  });
  const text = msg.content.map(b => b.text || "").join("");
  const strings = JSON.parse(text.replace(/```json|```/g, "").trim());
  res.json({ strings });
});
```

De frontend matcht daarna elke `{ fabrikant, wp }` aan een database-variant en vult de legplan-strings in.
