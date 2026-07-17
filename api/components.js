import { neon } from "@neondatabase/serverless";
import { checkAuth } from "./_auth.js";

const sql = neon(process.env.DATABASE_URL);

// Verplichte variant-velden per component-type — zelfde velden als in
// src/data/panels.json / inverters.json, zodat mergeCustomComponents()
// in src/data/loader.js de rij zonder verdere aanpassing kan mixen.
const VARIANT_FIELDS = {
  panel: ["id", "wp", "voc", "vmp", "isc", "imp"],
  inverter: ["id", "pmax", "vmax", "vmpptMin", "vmpptMax", "imppt", "isc", "nMppt", "stringsPerMppt", "pacNom", "iacMax"],
};

export default async function handler(req, res) {
  if (!checkAuth(req, res)) return;

  if (req.method === "GET") {
    const rows = await sql`
      select id, type, family_name, is_new_family, family_meta, variant, created_at
      from custom_components
      order by created_at asc
    `;
    res.status(200).json({ components: rows });
    return;
  }

  if (req.method === "POST") {
    const { type, familyName, isNewFamily, familyMeta, variant } = req.body || {};

    if (type !== "panel" && type !== "inverter") {
      res.status(400).json({ error: "type moet 'panel' of 'inverter' zijn." });
      return;
    }
    if (!familyName || !String(familyName).trim()) {
      res.status(400).json({ error: "Familienaam is verplicht." });
      return;
    }
    if (!variant || typeof variant !== "object") {
      res.status(400).json({ error: "Variant-gegevens ontbreken." });
      return;
    }
    const missing = VARIANT_FIELDS[type].filter((f) => variant[f] === undefined || variant[f] === "");
    if (missing.length > 0) {
      res.status(400).json({ error: `Ontbrekende velden voor ${type}: ${missing.join(", ")}.` });
      return;
    }
    if (isNewFamily && type === "panel" && (familyMeta?.betaVoc === undefined || familyMeta?.vsysMax === undefined)) {
      res.status(400).json({ error: "Nieuwe panelfamilie vereist betaVoc en vsysMax." });
      return;
    }

    const [row] = await sql`
      insert into custom_components (type, family_name, is_new_family, family_meta, variant)
      values (${type}, ${String(familyName).trim()}, ${!!isNewFamily}, ${familyMeta ? JSON.stringify(familyMeta) : null}, ${JSON.stringify(variant)})
      returning id, type, family_name, is_new_family, family_meta, variant, created_at
    `;
    res.status(201).json({ component: row });
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
}
