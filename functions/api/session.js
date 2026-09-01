import { isAuthenticated, json } from "../_lib/auth.js";

export async function onRequestGet({ request, env }) {
  const authed = await isAuthenticated(request, env);
  return json({ authenticated: authed });
}
