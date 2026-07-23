import { createRemoteJWKSet, jwtVerify } from "jose";

// Echte per-gebruiker authenticatie via Neon Auth (Managed Better Auth).
// De frontend logt in met authClient.signIn.email(...) en stuurt daarna een
// kortlevende JWT (via authClient.token()) mee als "Authorization: Bearer
// <token>". Wij verifiëren die JWT tegen de JWKS van de Neon Auth-service —
// geen eigen wachtwoord-opslag, geen sessiebeheer, alleen verificatie.
const AUTH_BASE_URL = process.env.NEON_AUTH_BASE_URL;
const JWKS = AUTH_BASE_URL ? createRemoteJWKSet(new URL(`${AUTH_BASE_URL}/.well-known/jwks.json`)) : null;

// Verifieert het JWT en retourneert { id } (Neon Auth user-id, uuid) bij
// succes. Schrijft zelf een 401 en retourneert null bij een ontbrekend of
// ongeldig token — call sites doen: const user = await requireUser(req,
// res); if (!user) return;
export async function requireUser(req, res) {
  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token || !JWKS) {
    res.status(401).json({ error: "Niet ingelogd." });
    return null;
  }

  try {
    const { payload } = await jwtVerify(token, JWKS);
    if (!payload.sub) throw new Error("JWT mist sub-claim");
    return { id: payload.sub };
  } catch {
    res.status(401).json({ error: "Sessie verlopen of ongeldig — log opnieuw in." });
    return null;
  }
}
