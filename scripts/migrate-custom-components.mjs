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
  create table if not exists custom_components (
    id serial primary key,
    type text not null check (type in ('panel','inverter')),
    family_name text not null,
    is_new_family boolean not null,
    family_meta jsonb,
    variant jsonb not null,
    created_at timestamptz not null default now()
  )
`;

console.log("OK: custom_components tabel bestaat.");
