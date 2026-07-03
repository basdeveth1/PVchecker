import { neon } from "@neondatabase/serverless";
import { checkAuth } from "../_auth.js";

const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  if (!checkAuth(req, res)) return;

  const { id } = req.query;

  if (req.method === "GET") {
    const [row] = await sql`
      select id, name, sollit_id, payload, created_at
      from configs
      where id = ${id}
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
