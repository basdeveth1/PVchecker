import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";

// Zet bestaande opgeslagen configuraties van het oude vaste-MPPT-grid-formaat
// ({ panelId, inverterId, checkStrings, tMinCold, tMaxHot, connId }) om naar
// het nieuwe, flexibele strings-lijst-formaat dat de samengevoegde "Ontwerp
// checken"-flow gebruikt ({ strings, inverterId, assignMode, manualAssign,
// tMinCold, tMaxHot, connId }). De oorspronkelijke MPPT-indeling blijft
// exact behouden (manualAssign), niet opnieuw automatisch verdeeld.

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

const rows = await sql`select id, name, payload from configs`;
console.log(`${rows.length} configuratie(s) gevonden.`);

for (const row of rows) {
  const p = row.payload;
  if (!p.checkStrings) {
    console.log(`- "${row.name}": al nieuw formaat, overgeslagen.`);
    continue;
  }

  const strings = [];
  const manualAssign = p.checkStrings.map((mpptStrings) =>
    mpptStrings.reduce((idxs, s) => {
      if (s.n > 0) {
        idxs.push(strings.length);
        strings.push({ n: s.n, panelId: p.panelId, azimuth: s.azimuth, helling: s.helling });
      }
      return idxs;
    }, [])
  );

  const newPayload = {
    strings,
    inverterId: p.inverterId,
    assignMode: "manual",
    manualAssign,
    tMinCold: p.tMinCold,
    tMaxHot: p.tMaxHot,
    connId: p.connId,
  };

  await sql`update configs set payload = ${JSON.stringify(newPayload)} where id = ${row.id}`;
  console.log(`- "${row.name}": gemigreerd (${strings.length} strings, indeling behouden).`);
}

console.log("Klaar.");
