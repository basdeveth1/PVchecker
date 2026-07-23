import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
    })
);

const sql = neon(env.DATABASE_URL);

const [before] = await sql`select trusted_origins from neon_auth.project_config`;
console.log("voor:", JSON.stringify(before.trusted_origins));

// Alleen toevoegen aan de bestaande lijst, niets overschrijven/verwijderen.
await sql`
  update neon_auth.project_config
  set trusted_origins = (
    select coalesce(jsonb_agg(distinct origin), '[]'::jsonb)
    from jsonb_array_elements_text(trusted_origins || '["https://pvchecker.vercel.app"]'::jsonb) as origin
  )
`;

const [after] = await sql`select trusted_origins from neon_auth.project_config`;
console.log("na:", JSON.stringify(after.trusted_origins));
