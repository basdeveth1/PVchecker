import { neon } from "@neondatabase/serverless";
import { checkAuth } from "./_auth.js";

const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  if (!checkAuth(req, res)) return;

  if (req.method === "GET") {
    const rows = await sql`
      select id, name, sollit_id, created_at
      from configs
      order by created_at desc
      limit 200
    `;
    res.status(200).json({ configs: rows });
    return;
  }

  if (req.method === "POST") {
    const { name, sollitId, payload } = req.body || {};
    if (!name || !String(name).trim() || !sollitId || !String(sollitId).trim() || !payload) {
      res.status(400).json({ error: "Naam, Sollit ID en payload zijn verplicht." });
      return;
    }
    const [row] = await sql`
      insert into configs (name, sollit_id, payload)
      values (${String(name).trim()}, ${String(sollitId).trim()}, ${JSON.stringify(payload)})
      returning id, name, sollit_id, created_at
    `;
    res.status(201).json({ config: row });
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
}
