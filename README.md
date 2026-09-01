# Balter Brew KPI Dashboard

A password-protected, team-shared dashboard for Balter Brewing's monthly **KPI Calculator**
(`KPI - Dash` tab) and **Production Plan Attainment** workbooks. Drop the two `.xlsx`
files in each month — everyone with the password sees the same dashboard, no re-uploading
required. There's also a one-click CSV export (KPI‑Dash rows + the current month's
Production Plan totals) sized for a NetSuite import.

Built as a static site (`index.html` / `styles.css` / `app.js`) plus a handful of small
Cloudflare Pages Functions for the password gate and shared data storage in Cloudflare KV.

## How it works

- **Parsing happens in your browser.** The `.xlsx` files never get uploaded as files —
  [SheetJS](https://sheetjs.com) (vendored locally in `vendor/`, no external CDN calls)
  reads them client-side, and only the extracted numbers are sent to the server when you
  press **Save to dashboard**.
- **Cloudflare KV holds sessions and data.** Every successful login gets a random session
  token stored in KV with a 30-day expiry — this is the "password protected, secured with
  KV" part — and KV also stores the parsed KPI/production numbers for each month, so every
  colleague who logs in sees the same shared dashboard immediately, without uploading
  anything themselves.
- **The password itself lives outside KV**, as an encrypted environment variable you set
  from the Cloudflare dashboard (step 5 below) — nothing to hash or run from a terminal.
- **No individual accounts.** Everyone uses the same team password. That's a reasonable
  bar for an internal monthly-numbers dashboard; if you later want per-person logins,
  audit logs, or SSO, put the whole site behind [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/)
  instead of (or in addition to) the built-in gate — no code changes needed.

## 1. Push this to GitHub

```bash
git init
git add .
git commit -m "Balter Brew KPI Dashboard"
git branch -M main
git remote add origin https://github.com/<your-org>/KPIsnapshot.git
git push -u origin main
```

## 2. Create the KV namespace

You need a Cloudflare account with Workers/Pages enabled.

```bash
npm install -g wrangler   # if you don't already have it
wrangler login
wrangler kv namespace create SNAPSHOT_KV
```

This prints an `id`. Keep it — you'll paste it into `wrangler.toml` (for local dev,
optional) and into the Pages dashboard binding (required).

## 3. Create the Pages project

In the Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect to Git**, pick
this repository, and use these build settings:

| Setting | Value |
|---|---|
| Framework preset | None |
| Build command | *(leave blank)* |
| Build output directory | `/` |

Deploy once (it'll be broken/blank until the next step — that's expected, there's no
password configured yet). Cloudflare names the project after the repo, lowercased, so
this will deploy to `https://kpisnapshot.pages.dev` (plus any custom domain you attach
under **Custom domains**).

## 4. Bind the KV namespace

**Workers & Pages → KPIsnapshot → Settings → Functions → KV namespace bindings
→ Add binding**

- Variable name: `SNAPSHOT_KV`
- KV namespace: the one you created in step 2

Redeploy (or it'll apply on the next deploy/commit) — the `Settings` change alone doesn't
touch existing deployments, so trigger a new one from the dashboard if needed.

## 5. Set the team password

**Workers & Pages → KPIsnapshot → Settings → Environment variables → Add variable**

- Variable name: `SITE_PASSWORD`
- Value: whatever you want the team password to be, typed in plain
- Click the **Encrypt** option next to it before saving — this turns it into a secret:
  Cloudflare stores it securely and won't display the value again anywhere in the
  dashboard, but your Functions code can still read it.
- Make sure it's added to the **Production** environment (and **Preview** too, if you use
  preview deployments).

Trigger a new deployment for the variable to take effect (same as the KV binding in step 4
— environment variable changes apply to the next deploy, not to ones already running).

To change the password later, edit the same variable and redeploy. Existing logins keep
working until their session expires (30 days) — if you want everyone logged out
immediately after a password change, delete the `sess:*` keys from the KV namespace via
**your KV namespace → View**.

## 6. Open the site

Visit the `*.pages.dev` URL (or your custom domain once attached under **Custom domains**),
enter the password, and drop in this month's two workbooks via **Update data**.

---

## Monthly workflow

1. Export/download the current `Balter_Brewery_KPI_Calculator_2026.xlsx` and
   `2026_Production_Plan_Attainment.xlsx` from Google Sheets (File → Download → Microsoft
   Excel).
2. Open the dashboard, click **Update data**, drag both files in.
3. The KPI workbook's `KPI - Dash` tab tells the app which month it is (cell B1, e.g. "Jul");
   the matching tab in the Production Plan workbook is auto-selected — check the dropdown
   if it picked the wrong one before saving.
4. Click **Save to dashboard**. Everyone with the password now sees this month's numbers.
5. Use **Export CSV** any time to download a NetSuite-ready CSV of the currently displayed
   month.

You can upload just one of the two files at a time if only one is ready — saving merges
with whatever's already stored for that month rather than overwriting it.

## Notes on a couple of judgment calls

- **Percentage scaling.** The KPI Calculator's `%`-unit values aren't stored consistently —
  some rows use a fraction (`0.72` = 72%) and others already use a percentage number
  (`95` = 95%). The dashboard treats any value with `|value| ≤ 1.5` as a fraction and
  scales it up; anything larger is shown as-is. This matched every row in the sample
  workbook, but worth a glance if a new KPI row ever shows an obviously wrong percentage.
- **Good/bad direction per KPI.** Complaints, losses, consumption and cost metrics are
  treated as "lower is better"; pass-rate, sensory-score, attainment and efficiency
  metrics are "higher is better". This lives in one place — the `KPI_DIRECTION` object at
  the top of `app.js` — so it's easy to correct. The three "UFE" metrics were assumed
  higher-is-better to match the ME metrics beside them; flip that if Balter defines UFE
  the other way round.
- **CSV column layout.** The export uses a generic `Month, Category, Metric, Unit, Budget
  (Month), Actual (Month), Variance (Month), Budget (YTD), Actual (YTD), Variance (YTD)`
  layout. If your NetSuite import template needs specific column names/order, that's all
  defined in one function — `buildCsv()` in `app.js`.

## Local development

```bash
npx wrangler pages dev . --kv SNAPSHOT_KV
```

For the password locally, create a `.dev.vars` file (already git-ignored) in the project
root with:

```
SITE_PASSWORD=whatever-you-want-locally
```

Wrangler picks it up automatically — no KV entry needed, same as production.

## File map

```
index.html                    Dashboard markup + password gate + upload modal
styles.css                    All styling (Balter brand colours/fonts)
app.js                        Parsing, rendering, auth calls, CSV export
manifest.json                 PWA manifest (uses the provided icons)
vendor/xlsx.full.min.js       SheetJS, vendored locally (no external CDN dependency)
favicon.svg / icon-*.png      Provided brand icons
_headers                      Cloudflare Pages response headers
functions/
  _lib/auth.js                 Shared session helpers (cookies, KV session storage)
  api/login.js                 POST — checks password against SITE_PASSWORD, issues a session
  api/logout.js                POST — deletes the KV session
  api/session.js                GET — is this visitor currently logged in?
  api/data/_middleware.js      Guards everything under /api/data with the session check
  api/data/index.js            GET latest snapshot + month list · POST a new snapshot
  api/data/[month].js          GET one archived month's snapshot
wrangler.toml                 Local dev config / KV binding reference
```
