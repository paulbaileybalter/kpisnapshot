import { destroySession, sessionCookieHeader, json } from "../lib/auth.js";

export async function onRequestPost({ request, env }) {
  await destroySession(request, env);
  return json({ ok: true }, { headers: { "Set-Cookie": sessionCookieHeader("", { clear: true }) } });
}
