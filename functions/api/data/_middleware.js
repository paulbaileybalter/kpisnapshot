import { isAuthenticated, json } from "../../_lib/auth.js";

export async function onRequest({ request, env, next }) {
  const authed = await isAuthenticated(request, env);
  if (!authed) {
    return json({ ok: false, error: "Not authenticated." }, { status: 401 });
  }
  return next();
}
