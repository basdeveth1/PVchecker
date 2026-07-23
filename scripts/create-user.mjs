import { createAuthClient } from "@neondatabase/neon-js/auth";
import { randomInt } from "crypto";
import { readFileSync } from "fs";

// Node's fetch stuurt van zichzelf geen Origin-header mee (een browser doet
// dat automatisch) — Better Auth vereist die wel voor schrijf-acties zoals
// signUp. Zet 'm hier op de site's eigen, echte origin (geen vervalsing van
// een andere identiteit, alleen het ontbrekende veld correct invullen).
const _fetch = globalThis.fetch;
globalThis.fetch = (url, opts = {}) => {
  const headers = new Headers(opts.headers);
  headers.set("origin", "http://localhost:3000");
  return _fetch(url, { ...opts, headers });
};

// Maakt een collega-account aan via Neon Auth. Gebruik:
//   node scripts/create-user.mjs "Volledige Naam" email@voorbeeld.nl
// Genereert een tijdelijk wachtwoord en print het eenmalig — deel dat apart
// (niet via dit script/de terminal-historie) met de collega.

const [, , name, email] = process.argv;
if (!name || !email) {
  console.error('Gebruik: node scripts/create-user.mjs "Volledige Naam" email@voorbeeld.nl');
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
    })
);

const chars = "abcdefghjkmnpqrstuvwxyz23456789"; // geen 0/o/1/l/i
let password = "";
for (let i = 0; i < 12; i++) password += chars[randomInt(chars.length)];

const client = createAuthClient(env.NEON_AUTH_BASE_URL);
const { data, error } = await client.signUp.email({ name, email, password });

if (error) {
  console.error("Aanmaken mislukt:", error.message || error);
  process.exit(1);
}

console.log(`Account aangemaakt voor ${name} <${email}>.`);
console.log(`Tijdelijk wachtwoord: ${password}`);
console.log("Deel dit apart met de collega — dit wordt nergens anders opgeslagen.");
