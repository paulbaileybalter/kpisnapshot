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

The dashboard has four pages, switched via tabs in the header: **Quality**, **Utilities**,
**Efficiency**, and **Production Plan**, each sized to fit a typical laptop screen without
scrolling. The one exception is the Quality page specifically — it has more metrics than
the others (12, versus 4 for Utilities and 9 for Efficiency), so on the smallest screens
this project is tested against (1366×768 and 1280×800) its last row or so needs a small
internal scroll to reach. Nothing else moves when that happens — the header, hero, and
tabs stay in place; only the tile grid itself scrolls.

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
"This"/"Last" comparison bar appears on the hero of all three KPI pages — Quality,
Utilities, and Efficiency (comparing Plan Attainment), with a delta badge. If there's no
exact same-month match, the bar simply doesn't appear on the hero — nothing breaks, no
error.

Separately, **every individual metric tile** gets a third bar of its own — "vs Last Year"
— comparing that specific KPI's year-to-date total against last year's full-year total
(the YTD value from whichever saved prior-year month is chronologically last; once that's
December, YTD-at-December is the annual figure). It shows a gold tick mark for last year's
total alongside the usual dark target tick, so you can see at a glance where this year
stands relative to both. The bar's headline number is the *change* between the two years
(e.g. "+8.9 pp"), not this year's total again — the "This month"/"Year to date" sections
above it already show that figure, so repeating it here as the headline made the section
look like a copy-paste duplicate rather than a real comparison; both actual values are
still there, just as compact text under the bar ("73.4% vs LY 64.5%"). This one only needs
*any* prior-year data for that KPI, not a month match, so it's usually available even when
the hero's "This/Last" bar isn't.

### Bar / pie chart toggle

The two small icon buttons in the header (next to **Update data**) switch every metric
tile's visualization between horizontal bars and small pie charts. The choice is
remembered per-browser (via `localStorage`), not per-account.

### Consolidated metric cards

A few closely-related KPIs share one card instead of getting one each, to cut down on
card count and keep near-duplicates from crowding a page — right now that's nine
complaint-related KPIs on the Quality page (Consumer Complaints Total/Cans & Bottles/Kegs,
its PPM/hL Ratio, the Cans-only breakdown, Controllable Complaints and its Ratio, and Keg
Returns and its Ratio), shown as a single "Consumer Complaints" card with a small toggle
to switch between them. Cost of Quality used to be part of this group too, but per a
manager request it now gets its own card, placed immediately after Consumer Complaints
regardless of where it naturally falls in the data — see `PINNED_RELATIVE_TO_GROUP` near
`METRIC_GROUPS` in `public/app.js` if a similar "pull this one out and place it here"
request comes up again for another metric (each entry supports `position: "before"` or
`"after"`).

Everything else about the group card — the bars, the pie mode, the "vs Last Year"
comparison, the trend chart when zoomed — works exactly like a normal tile; only the
toggle is new, and clicking it switches variants without affecting the zoom-to-inspect
click on the rest of the card. The toggle also works correctly once the card is zoomed in
(clicking a toggle inside the zoomed view switches its content too, including reloading
the trend chart for whichever KPI is now selected).

Not every variant shows up every month — "CC Cans" (the cans-only breakdown) only comes
from the workbook's `KPI - Actual` history tabs, not the curated `KPI - Dash` tab, so it
only appears on months backfilled through that route, not on the "live" current month.
That's expected, not a bug — the card only shows toggles for whichever variants actually
have data for the month you're viewing.

The Efficiency page has two more groups. "Package Loss" pairs Total Package Loss with
Total Can Loss — it has the same "only on backfilled months" caveat as CC Cans above,
since "Total Can Loss" isn't in the curated `KPI - Dash` tab either, so on the live
current month that card falls back to a normal single tile showing just Total Package
Loss (still correct, just not a toggle, since there's nothing to toggle to yet); it
becomes a real two-way toggle once you're viewing a backfilled month where both variants
are present. This "falls back to a plain tile when only one variant has data" behavior
applies to every group, not just this one. "Line Efficiency" combines all six ME/UFE
metrics into one card — Packaging, Can Line, and Keg Line, each with their ME and UFE
figures — so instead of three separate two-way toggles, it's one six-way toggle.

To consolidate another set of related metrics the same way, add an entry to
`METRIC_GROUPS` near the top of `public/app.js` — each entry just needs a title and a list
of `{ key, label, kpi }` variants naming the exact KPI rows to combine. A group renders
automatically wherever 2+ of its named KPIs are present that month; if only one is present,
it falls back to a normal single tile so nothing goes missing.

### Inspecting a tile up close

Click (or focus + Enter/Space) any metric tile on the Quality, Utilities, or Efficiency
pages to see it enlarged — up to 200% (2×), automatically capped so it never overflows
the screen on smaller windows. Click the dimmed background, or press Escape, to close it.
It's rebuilt fresh from the same data (not a clone of the compact tile's markup) — mainly
so it works correctly in both bar and pie chart mode, since a clone wouldn't pick up a
chart-style change made while the tile was zoomed.

While zoomed, press the **Left/Right arrow keys**, or click the round **prev/next
buttons** at the edges of the screen, to move to the neighboring tile on the same page
without closing the overlay — it cycles through every tile on whichever page you had open
(Quality, Utilities, or Efficiency independently), wrapping from the last tile back to the
first and vice versa. The buttons hide themselves automatically if a page only has one
tile, since there'd be nothing to navigate to.

### Trend chart

Every metric tile's "Year to date" bar is a small line chart instead, plotting that KPI's
actual value across the last 6-7 months (whichever months have been saved — a KPI with
less history just shows however many months exist, with a plain note if there's only
one), with a dashed horizontal line marking the target. "This month" and "vs Last Year"
stay as bars — a trend chart is for showing direction over time, which is exactly what a
single bar can't do, but a two-number comparison (this month vs last year) is still best
served by a bar. The line is a single color the whole way across — teal if the latest
month is on the right side of target, orange if not — rather than color-coded per
segment, to stay legible at this size.

This was originally zoomed-view-only — the compact grid didn't have room for a 6-7 point
trend back when each page had 9-12 cards. Once the consolidated group cards (see above)
got that down to 4 cards per page, there was enough room to spare that the compact tiles
now show the same chart as the zoomed view, not a separate simplified version — confirmed
still fits every tested screen size with room to spare. For a consolidated group card
(Consumer Complaints, Line Efficiency), switching the toggle reloads the chart for
whichever KPI is now selected, whether or not the tile is zoomed.

Underlying data comes from the same monthly snapshots already saved for the month
switcher and prior-year backfill — nothing new to upload. Each month's data is fetched
once (via the existing `/api/data/<month>` endpoint) and cached in memory for the rest of
the session, so opening zoom on a second tile doesn't refetch months already pulled for
the first one.

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
- **Year-over-year comparison scope.** The hero's "This/Last" bar only compares Plan
  Attainment (it's the headline metric on both KPI pages) — extending that to more metrics
  is a matter of looping over more KPI names in `buildYoyStat()` in `public/app.js`. The
  per-tile "vs Last Year" bar already covers every metric automatically, since
  `renderTileYoyPeriod()` looks up whichever KPI that tile represents.

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
