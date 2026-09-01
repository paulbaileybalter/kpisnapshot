// Shared auth helpers for Balter KPI Dashboard Pages Functions.
// Sessions are opaque random tokens stored in Workers KV with a TTL —
// this is the "secure using Cloudflare's KV" mechanism the site relies on.
// Nothing about the password or session state lives in the client.

const COOKIE_NAME = "balter_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export async function sha256Hex(input) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function parseCookies(request) {
  const header = request.headers.get("Cookie") || "";
  const out = {};
  header.split(";").forEach((part) => {
    const idx = part.indexOf("=");
    if (idx === -1) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

export function sessionCookieHeader(token, { clear = false } = {}) {
  const maxAge = clear ? 0 : SESSION_TTL_SECONDS;
  const value = clear ? "" : token;
  return `${COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export async function getSessionToken(request) {
  const cookies = parseCookies(request);
  return cookies[COOKIE_NAME] || null;
}

export async function isAuthenticated(request, env) {
  const token = await getSessionToken(request);
  if (!token) return false;
  const record = await env.BALTER_KV.get(`sess:${token}`);
  return !!record;
}

export async function createSession(env) {
  const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  await env.BALTER_KV.put(`sess:${token}`, JSON.stringify({ createdAt: Date.now() }), {
    expirationTtl: SESSION_TTL_SECONDS,
  });
  return token;
}

export async function destroySession(request, env) {
  const token = await getSessionToken(request);
  if (token) await env.BALTER_KV.delete(`sess:${token}`);
}

export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
}

export { COOKIE_NAME, SESSION_TTL_SECONDS };
