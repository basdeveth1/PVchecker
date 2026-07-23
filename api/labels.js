import { neon } from "@neondatabase/serverless";
import { requireUser } from "./_auth.js";

const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;

  if (req.method === "GET") {
    const rows = await sql`select type, variant_id, label from component_labels`;
    res.status(200).json({ labels: rows });
    return;
  }

  if (req.method === "POST") {
    const { type, variantId, label } = req.body || {};
    if (type !== "panel" && type !== "inverter") {
      res.status(400).json({ error: "type moet 'panel' of 'inverter' zijn." });
      return;
    }
    if (!variantId || !String(variantId).trim()) {
      res.status(400).json({ error: "variantId is verplicht." });
      return;
    }
    const trimmed = String(label || "").trim();
    if (!trimmed) {
      // Leeg label = verwijderen, geen lege rijen laten rondslingeren.
      await sql`delete from component_labels where type = ${type} and variant_id = ${String(variantId).trim()}`;
      res.status(200).json({ label: null });
      return;
    }
    const [row] = await sql`
      insert into component_labels (type, variant_id, label, updated_at)
      values (${type}, ${String(variantId).trim()}, ${trimmed}, now())
      on conflict (type, variant_id) do update set label = excluded.label, updated_at = now()
      returning type, variant_id, label
    `;
    res.status(200).json({ label: row });
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
}
