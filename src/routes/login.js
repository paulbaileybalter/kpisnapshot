import { createSession, sessionCookieHeader, json } from "../lib/auth.js";

// POST /api/login  { password: string }
export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Bad request." }, { status: 400 });
  }

  const password = (body && body.password) || "";
  if (!password) return json({ ok: false, error: "Password required." }, { status: 400 });

  // The password itself lives as an encrypted Pages environment variable
  // (SITE_PASSWORD), set from the Cloudflare dashboard — see README. KV is
  // used for sessions and the saved dashboard data, not for the password.
  const expected = env.SITE_PASSWORD;
  if (!expected) {
    return json(
      { ok: false, error: "No password has been configured for this site yet. See README setup step." },
      { status: 500 }
    );
  }

  if (!timingSafeStringEqual(password, expected)) {
    return json({ ok: false, error: "Incorrect password." }, { status: 401 });
  }

  const token = await createSession(env);
  return json(
    { ok: true },
    { headers: { "Set-Cookie": sessionCookieHeader(token) } }
  );
}

export async function onRequestOptions() {
  return new Response(null, { status: 204 });
}

// Plain !== comparison would leak timing info about how many leading
// characters matched; this compares full-length regardless of where the
// difference is. Not that it matters much for a small internal team, but
// costs nothing to do properly.
function timingSafeStringEqual(a, b) {
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ bBytes[i];
  return diff === 0;
}
