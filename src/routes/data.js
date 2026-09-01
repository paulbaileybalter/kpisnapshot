import { json, getSessionToken } from "../lib/auth.js";

const INDEX_KEY = "data:index"; // JSON array of month keys, e.g. ["Jan","Feb",...]
const LATEST_KEY = "data:latest"; // month key string of the most recently saved snapshot

function monthKeyFor(snapshot) {
  return (snapshot && snapshot.month) || "Unfiled";
}

export async function onRequestGet({ env }) {
  const latestMonth = await env.SNAPSHOT_KV.get(LATEST_KEY);
  const indexRaw = await env.SNAPSHOT_KV.get(INDEX_KEY);
  const monthIndex = indexRaw ? JSON.parse(indexRaw) : [];

  if (!latestMonth) {
    return json({ ok: true, snapshot: null, months: monthIndex });
  }

  const snapRaw = await env.SNAPSHOT_KV.get(`data:month:${latestMonth}`);
  const snapshot = snapRaw ? JSON.parse(snapRaw) : null;
  return json({ ok: true, snapshot, months: monthIndex });
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Bad request body." }, { status: 400 });
  }

  if (!body || !body.month || (!body.kpiDash && !body.productionPlan)) {
    return json({ ok: false, error: "Snapshot must include a month and at least one dataset." }, { status: 400 });
  }

  const month = String(body.month).slice(0, 20);
  const key = `data:month:${month}`;

  // Merge with anything already saved for that month, so uploading the KPI
  // workbook and the Production Plan workbook separately (in either order)
  // doesn't clobber the other one.
  const existingRaw = await env.SNAPSHOT_KV.get(key);
  const existing = existingRaw ? JSON.parse(existingRaw) : {};

  const token = await getSessionToken(request);
  const snapshot = {
    ...existing,
    ...body,
    month,
    savedAt: new Date().toISOString(),
    savedBySession: token ? token.slice(0, 8) : "unknown",
  };

  await env.SNAPSHOT_KV.put(key, JSON.stringify(snapshot));
  await env.SNAPSHOT_KV.put(LATEST_KEY, month);

  const indexRaw = await env.SNAPSHOT_KV.get(INDEX_KEY);
  const monthIndex = indexRaw ? JSON.parse(indexRaw) : [];
  if (!monthIndex.includes(month)) {
    monthIndex.push(month);
    await env.SNAPSHOT_KV.put(INDEX_KEY, JSON.stringify(monthIndex));
  }

  return json({ ok: true, snapshot });
}
