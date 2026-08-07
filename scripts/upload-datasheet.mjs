import { createAuthClient } from "@neondatabase/neon-js/auth";
import { readFileSync } from "fs";

// Eenmalig hulpscript om een datasheet rechtstreeks te uploaden naar
// /api/datasheets zonder door de UI's file-picker te hoeven — logt in als
// het opgegeven account en post het bestand. Gebruik:
//   node scripts/upload-datasheet.mjs <pad-naar-pdf> <type> "<familienaam>" <email> <wachtwoord> [base-url]

const [, , filePath, type, familyName, email, password, baseUrl = "http://localhost:3000"] = process.argv;
if (!filePath || !type || !familyName || !email || !password) {
  console.error('Gebruik: node scripts/upload-datasheet.mjs <pad-naar-pdf> <panel|inverter> "<familienaam>" <email> <wachtwoord> [base-url]');
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

// Node's fetch heeft geen cookie-jar zoals een browser — vangt de
// session-cookie na signIn dus zelf op en stuurt 'm terug mee.
let sessionCookie = "";
const _fetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const headers = new Headers(opts.headers);
  headers.set("origin", baseUrl);
  if (sessionCookie) headers.set("cookie", sessionCookie);
  const res = await _fetch(url, { ...opts, headers, credentials: "include" });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) sessionCookie = setCookie.split(";")[0];
  return res;
};

const client = createAuthClient(env.NEON_AUTH_BASE_URL);
const { error: signInError } = await client.signIn.email({ email, password });
if (signInError) {
  console.error("Inloggen mislukt:", signInError.message || signInError);
  process.exit(1);
}

const tokenRes = await fetch(`${env.NEON_AUTH_BASE_URL}/token`, { credentials: "include" });
const { token } = await tokenRes.json().catch(() => ({}));
if (!token) {
  console.error("Kon geen JWT ophalen na inloggen.");
  process.exit(1);
}

const fileBuffer = readFileSync(filePath);
const fileBase64 = fileBuffer.toString("base64");
const filename = filePath.split("/").pop();
const mimeType = filename.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/png";

const res = await fetch(`${baseUrl}/api/datasheets`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ type, familyName, filename, mimeType, fileBase64 }),
});
const data = await res.json();
if (!res.ok) {
  console.error("Upload mislukt:", data.error || res.status);
  process.exit(1);
}
console.log("Geüpload:", JSON.stringify(data.datasheet));
