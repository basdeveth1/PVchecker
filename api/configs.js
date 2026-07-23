import { neon } from "@neondatabase/serverless";
import { requireUser } from "./_auth.js";

const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;

  if (req.method === "GET") {
    const rows = await sql`
      select c.id, c.name, c.sollit_id, c.created_at, u.name as created_by_name
      from configs c
      left join neon_auth."user" u on u.id = c.created_by
      order by c.created_at desc
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
      insert into configs (name, sollit_id, payload, created_by)
      values (${String(name).trim()}, ${String(sollitId).trim()}, ${JSON.stringify(payload)}, ${user.id})
      returning id, name, sollit_id, created_at
    `;
    res.status(201).json({ config: row });
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
}
