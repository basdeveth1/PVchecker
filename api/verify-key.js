import { checkAuth } from "./_auth.js";

// Alleen voor de login-gate: valideert het wachtwoord zonder verder iets te
// doen (geen DB, geen AI) — goedkoop genoeg om bij elk bezoek te draaien.
export default function handler(req, res) {
  if (!checkAuth(req, res)) return;
  res.status(200).json({ ok: true });
}
