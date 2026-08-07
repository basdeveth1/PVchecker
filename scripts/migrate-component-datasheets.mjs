import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";

// Bewaart de originele datasheet-bestanden (PDF/foto) per componentfamilie,
// zodat je vanuit "Componenten beheren" de brondocument kunt terugvinden
// waaruit de waarden zijn overgenomen — zie project_datasheet_traceability_todo.

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

await sql`
  create table if not exists component_datasheets (
    id serial primary key,
    type text not null check (type in ('panel','inverter')),
    family_name text not null,
    filename text not null,
    mime_type text not null,
    file_base64 text not null,
    uploaded_by uuid references neon_auth."user"(id),
    uploaded_at timestamptz not null default now()
  )
`;

console.log("OK: component_datasheets tabel bestaat.");
