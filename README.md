# KPI Snapshot — Balter Brewing

A password-protected, team-shared dashboard for Balter Brewing's monthly **KPI Calculator**
(`KPI - Dash` tab) and **Production Plan Attainment** workbooks. Drop the two `.xlsx`
files in each month — everyone with the password sees the same dashboard, no re-uploading
required. There's also a one-click CSV export (KPI‑Dash rows + the current month's
Production Plan totals) sized for a NetSuite import.

Built as a static site (in `public/`) plus a small Cloudflare **Worker** (in `src/`) that
serves those files and handles the password gate and shared data storage in Cloudflare KV.
This deploys through Cloudflare's Workers "Import a repository" flow — the one that shows
a **Deploy command** field defaulting to `npx wrangler deploy` — rather than the older,
separate Pages product, since that's what's available for new projects on most accounts
now.

## How it works

- **Parsing happens in your browser.** The `.xlsx` files never get uploaded as files —
  [SheetJS](https://sheetjs.com) (vendored locally in `public/vendor/`, no external CDN
  calls) reads them client-side, and only the extracted numbers are sent to the server
  when you press **Save to dashboard**.
- **Cloudflare KV holds sessions and data.** Every successful login gets a random session
  token stored in KV with a 30-day expiry — this is the "password protected, secured with
  KV" part — and KV also stores the parsed KPI/production numbers for each month, so every
  colleague who logs in sees the same shared dashboard immediately, without uploading
  anything themselves.
- **The password itself lives outside KV**, as an encrypted variable you set from the
  Cloudflare dashboard (step 5 below) — nothing to hash or run from a terminal.
- **No individual accounts.** Everyone uses the same team password. That's a reasonable
  bar for an internal monthly-numbers dashboard; if you later want per-person logins,
  audit logs, or SSO, put the whole site behind [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/)
  instead of (or in addition to) the built-in gate — no code changes needed.

## 1. Push this to GitHub

```bash
git init
git add .
git commit -m "KPIsnapshot"
git branch -M main
git remote add origin https://github.com/<your-org>/KPIsnapshot.git
git push -u origin main
```

## 2. Create the KV namespace

You need a Cloudflare account with Workers enabled.

```bash
npm install -g wrangler   # if you don't already have it
wrangler login
wrangler kv namespace create SNAPSHOT_KV
```

This prints an `id`. Keep it — you'll paste it into `wrangler.toml` (for local dev,
optional) and into the dashboard binding in step 4 (required).

## 3. Create the Worker project

**Workers & Pages → Create**, then import this GitHub repository. On the "Set up your
application" screen:

| Setting | Value |
|---|---|
| Project name | `kpisnapshot` |
| Build command | *(leave blank)* |
| Deploy command | `npx wrangler deploy` *(this is the default — leave it as-is)* |

Deploy once (it'll be broken/blank until steps 4–5 — that's expected, there's no KV
binding or password configured yet). This deploys to `https://kpisnapshot.<your-subdomain>.workers.dev`
(plus any custom domain you attach under **Settings → Domains & Routes**).

If the deploy fails with an authentication error mentioning a "build token," go to
**Settings → Builds → API token** and select/create a token there — this is Cloudflare's
own build-system credential and is separate from anything in this repo.

## 4. Bind the KV namespace

**Workers & Pages → KPIsnapshot → Settings → Bindings → Add → KV Namespace**

- Variable name: `SNAPSHOT_KV`
- KV namespace: the one you created in step 2

Trigger a new deployment for the binding to take effect — a Settings change alone doesn't
touch a deployment that's already running.

## 5. Set the team password

**Workers & Pages → KPIsnapshot → Settings → Variables and Secrets → Add**

- Variable name: `SITE_PASSWORD`
- Value: whatever you want the team password to be, typed in plain
- Set its type to **Secret** (sometimes shown as an **Encrypt** toggle) before saving —
  Cloudflare stores it securely and won't display the value again anywhere in the
  dashboard, but the Worker can still read it.

Trigger a new deployment for the variable to take effect, same as step 4.

To change the password later, edit the same variable and redeploy. Existing logins keep
working until their session expires (30 days) — if you want everyone logged out
immediately after a password change, delete the `sess:*` keys from the KV namespace
(**Storage & Databases → KV → SNAPSHOT_KV → View**).

## 6. Open the site

Visit the `*.workers.dev` URL (or your custom domain), enter the password, and drop in
this month's two workbooks via **Update data**.

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
   Every other populated month tab in the Production Plan workbook is saved too, so past
   months become browsable from the **Month** dropdown immediately — not just the current
   one. (Empty future-month templates in the workbook, e.g. tabs for months that haven't
   happened yet, are detected and skipped.)
5. Use **Export CSV** any time to download a NetSuite-ready CSV of the currently displayed
   month.

You can upload just one of the files at a time if only some are ready — saving merges with
whatever's already stored for that month rather than overwriting it.

### Browsing previous months

The **Month** dropdown in the header lists every month that's been saved, most recent
first. Both the Production Plan and the KPI Calculator now backfill history automatically:

- **Production Plan** — every populated month tab in the workbook is saved, not just the
  current one.
- **KPI Calculator** — the `KPI - Dash` tab itself is only ever a snapshot of whichever
  month is "current" in the Google Sheet, but the workbook's `KPI - Actual`, `KPI - BU`,
  and `KPI - YTD` tabs each carry one column per month for the full year. Every month
  those three tabs have real data for gets reconstructed and saved too — so a single
  upload backfills the whole year's KPI history in one go, not just Production Plan's.
  (A handful of ratio-style metrics default to `0` or `#DIV/0!` for months that haven't
  happened yet; the backfill uses Plan Attainment specifically as the signal for "did
  this month really happen," since it's the one metric that's reliably only populated
  once a month has actually been reported.)

Either way, empty future-month templates are detected and skipped — you won't end up with
blank entries cluttering the dropdown for months that haven't happened yet.

### Year-over-year comparison

Drop last year's KPI Calculator export into the third ("optional") dropzone in the upload
modal. Just like the current year's file, it's not limited to whichever month happens to
be "current" in the sheet — every month its `KPI - Actual` / `KPI - BU` / `KPI - YTD` tabs
have real data for gets extracted and saved, keyed by month, independent of the current
month you're viewing.

Whenever the month you're currently viewing has a matching prior-year month saved, a
comparison bar appears on the Quality and Utilities & Efficiency hero (comparing Plan
Attainment), with up to three rows:

- **This** — this year, the month you're currently viewing
- **Last** — last year, that same month
- **Total** — last year's full-year total (the YTD value from whichever saved prior-year
  month is chronologically last — once that's December, YTD-at-December is the annual
  figure)

The "This"/"Last" rows and their delta badge only show up when there's an exact
same-month match; the "Total" row shows up independently whenever any prior-year data
exists at all, even without a month match. If there's no prior-year data at all, the bar
simply doesn't appear — nothing breaks, no error.

### Bar / pie chart toggle

The two small icon buttons in the header (next to **Update data**) switch every metric
tile's visualization between horizontal bars and small pie charts. The choice is
remembered per-browser (via `localStorage`), not per-account.

### Inspecting a tile up close

Click (or focus + Enter/Space) any metric tile on the Quality or Utilities & Efficiency
pages to see it enlarged — up to 400% (4×), automatically capped so it never overflows
the screen on smaller windows. Click the dimmed background, or press Escape, to close it.
It's an exact clone of the tile as currently rendered, so it works correctly in both bar
and pie chart mode.

## Notes on a couple of judgment calls

- **Percentage scaling.** The KPI Calculator's `%`-unit values aren't stored consistently.
  Only two rows (`Micro`, `Phys Chem`) store a fraction (`0.72` = 72%); every other `%`
  row is already a percentage number (`95` = 95%, and — importantly — `0.98` means
  `0.98%`, not 98%). This is a fixed lookup — `FRACTION_PERCENT_KPIS` near the top of
  `public/app.js` — checked against the actual workbook rather than guessed from
  magnitude, since a couple of the already-scaled rows are also under 1.5 in size.
- **Good/bad direction per KPI.** Complaints, losses, consumption and cost metrics are
  treated as "lower is better"; pass-rate, sensory-score, attainment and efficiency
  metrics are "higher is better". This lives in one place — the `KPI_DIRECTION` object in
  `public/app.js` — so it's easy to correct. The three "UFE" metrics were assumed
  higher-is-better to match the ME metrics beside them; flip that if Balter defines UFE
  the other way round.
- **CSV column layout.** The export uses a generic `Month, Category, Metric, Unit, Budget
  (Month), Actual (Month), Variance (Month), Budget (YTD), Actual (YTD), Variance (YTD)`
  layout. If your NetSuite import template needs specific column names/order, that's all
  defined in one function — `buildCsv()` in `public/app.js`.
- **Year-over-year comparison scope.** Only Plan Attainment is compared right now (it's
  the headline metric on both KPI pages). Extending this to more metrics is a matter of
  looping over more KPI names in `buildYoyStat()` in `public/app.js`.

## Local development

```bash
npx wrangler dev
```

For the password locally, create a `.dev.vars` file (already git-ignored) in the project
root with:

```
SITE_PASSWORD=whatever-you-want-locally
```

Wrangler picks up both `.dev.vars` and the KV binding in `wrangler.toml` automatically —
no dashboard setup needed for local testing.

## File map

```
public/                        Everything served as the static site
  index.html                    Dashboard markup + password gate + upload modal
  styles.css                    All styling (Balter brand colours/fonts)
  app.js                        Parsing, rendering, auth calls, CSV export
  manifest.json                 PWA manifest (uses the provided icons)
  vendor/xlsx.full.min.js       SheetJS, vendored locally (no external CDN dependency)
  favicon.svg / icon-*.png      Provided brand icons
  _headers                      Response headers (still honoured by Workers static assets)
src/                            The Worker itself
  worker.js                     Entry point — routes /api/* and falls back to static assets
  lib/auth.js                   Shared session helpers (cookies, KV session storage)
  routes/login.js               POST — checks password against SITE_PASSWORD, issues a session
  routes/logout.js              POST — deletes the KV session
  routes/session.js             GET — is this visitor currently logged in?
  routes/data.js                GET latest snapshot + month list · POST a new snapshot
  routes/data-month.js          GET one archived month's snapshot
  routes/prioryear.js           GET/POST prior-year KPI rows, keyed by month, for YoY comparison
wrangler.toml                   Worker config: entry point, assets directory, KV binding
```
