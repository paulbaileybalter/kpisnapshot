import { sha256Hex, createSession, sessionCookieHeader, json } from "../_lib/auth.js";

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

  // The password hash lives in KV (key: auth:password_hash), set once via
  // wrangler / the Cloudflare dashboard — see README for how to set/rotate it.
  const storedHash = await env.BALTER_KV.get("auth:password_hash");
  if (!storedHash) {
    return json(
      { ok: false, error: "No password has been configured for this site yet. See README setup step." },
      { status: 500 }
    );
  }

  const suppliedHash = await sha256Hex(password);
  if (suppliedHash !== storedHash) {
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
