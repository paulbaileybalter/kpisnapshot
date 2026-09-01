import { json } from "../lib/auth.js";

const KEY = "prioryear:kpiDash";

// GET /api/prioryear -> { ok, months: { "July": {rows: [...], savedAt}, ... } }
export async function onRequestGet({ env }) {
  const raw = await env.SNAPSHOT_KV.get(KEY);
  const months = raw ? JSON.parse(raw) : {};
  return json({ ok: true, months });
}

// POST /api/prioryear  { month: "July", rows: [...] }
// Merges one month's prior-year KPI rows into the stored dict — uploading a
// second prior-year month later doesn't erase the first.
export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Bad request body." }, { status: 400 });
  }

  if (!body || !body.month || !Array.isArray(body.rows)) {
    return json({ ok: false, error: "Expected { month, rows }." }, { status: 400 });
  }

  const month = String(body.month).slice(0, 20);
  const raw = await env.SNAPSHOT_KV.get(KEY);
  const months = raw ? JSON.parse(raw) : {};
  months[month] = { rows: body.rows, savedAt: new Date().toISOString() };

  await env.SNAPSHOT_KV.put(KEY, JSON.stringify(months));
  return json({ ok: true, months });
}
