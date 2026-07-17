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

await sql`
  create table if not exists component_labels (
    type text not null check (type in ('panel','inverter')),
    variant_id text not null,
    label text not null default '',
    updated_at timestamptz not null default now(),
    primary key (type, variant_id)
  )
`;

console.log("OK: component_labels tabel bestaat.");
