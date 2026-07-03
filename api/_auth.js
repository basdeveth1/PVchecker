import { timingSafeEqual } from "crypto";

// Gedeeld-wachtwoord-gate voor alle /api/* routes. Geen accounts, geen
// sessies — één wachtwoord dat installateurs onderling delen, bedoeld om
// deze publieke, niet-ingelogde URL te beschermen tegen misbruik door
// buitenstaanders (kosten bij de Sollit-import, vervuiling van de
// gedeelde configuratielijst), niet om individuele gebruikers te scheiden.
export function checkAuth(req, res) {
  const provided = req.headers["x-app-key"] || "";
  const expected = process.env.APP_SHARED_KEY || "";

  const a = Buffer.from(String(provided));
  const b = Buffer.from(String(expected));
  const valid = expected.length > 0 && a.length === b.length && timingSafeEqual(a, b);

  if (!valid) {
    res.status(401).json({ error: "Ongeldig of ontbrekend wachtwoord." });
    return false;
  }
  return true;
}
