import { neon } from "@neondatabase/serverless";
import { requireUser } from "../_auth.js";

const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;

  const { id } = req.query;

  if (req.method === "GET") {
    const [row] = await sql`
      select c.id, c.name, c.sollit_id, c.payload, c.created_at, u.name as created_by_name
      from configs c
      left join neon_auth."user" u on u.id = c.created_by
      where c.id = ${id}
    `;
    if (!row) {
      res.status(404).json({ error: "Configuratie niet gevonden." });
      return;
    }
    res.status(200).json({ config: row });
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
}
