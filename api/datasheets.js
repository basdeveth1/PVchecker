import { neon } from "@neondatabase/serverless";
import { requireUser } from "./_auth.js";

const sql = neon(process.env.DATABASE_URL);

// Bewaart de originele datasheet-bestanden per componentfamilie, zodat je
// vanuit "Componenten beheren" het brondocument kunt terugvinden waaruit de
// waarden zijn overgenomen (zie CLAUDE.md: datasheet-extractie is het
// grootste risico — kunnen terugvinden waar een waarde vandaan komt hoort
// daarbij).
export default async function handler(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;

  if (req.method === "GET") {
    const { id } = req.query || {};
    if (id) {
      const [row] = await sql`select id, type, family_name, filename, mime_type, file_base64, uploaded_at from component_datasheets where id = ${id}`;
      if (!row) {
        res.status(404).json({ error: "Datasheet niet gevonden." });
        return;
      }
      res.status(200).json({ datasheet: row });
      return;
    }
    // Lijstweergave zonder de (grote) file_base64-kolom.
    const rows = await sql`
      select id, type, family_name, filename, mime_type, uploaded_at
      from component_datasheets
      order by uploaded_at desc
    `;
    res.status(200).json({ datasheets: rows });
    return;
  }

  if (req.method === "POST") {
    const { type, familyName, filename, mimeType, fileBase64 } = req.body || {};
    if (type !== "panel" && type !== "inverter") {
      res.status(400).json({ error: "type moet 'panel' of 'inverter' zijn." });
      return;
    }
    if (!familyName || !String(familyName).trim()) {
      res.status(400).json({ error: "Familienaam is verplicht." });
      return;
    }
    if (!filename || !mimeType || !fileBase64) {
      res.status(400).json({ error: "filename, mimeType en fileBase64 zijn verplicht." });
      return;
    }
    const [row] = await sql`
      insert into component_datasheets (type, family_name, filename, mime_type, file_base64, uploaded_by)
      values (${type}, ${String(familyName).trim()}, ${filename}, ${mimeType}, ${fileBase64}, ${user.id})
      returning id, type, family_name, filename, mime_type, uploaded_at
    `;
    res.status(201).json({ datasheet: row });
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
}
