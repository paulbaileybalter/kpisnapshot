import { json } from "../lib/auth.js";

export async function onRequestGet({ env, params }) {
  const month = String(params.month || "").slice(0, 20);
  const raw = await env.SNAPSHOT_KV.get(`data:month:${month}`);
  if (!raw) return json({ ok: true, snapshot: null });
  return json({ ok: true, snapshot: JSON.parse(raw) });
}
