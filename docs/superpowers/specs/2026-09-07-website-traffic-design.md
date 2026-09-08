# Website traffic in the CRM — Design

**Date:** 2026-09-07 · **Status:** decided by danlo in conversation; layout locked
on the mockup at `docs/design/website-section.html` · **Origin:** danlo's ask
for an "SEO section" that lets a client see the traffic on the website BIS
built for them, standardized so every BIS-built site plugs in the same way,
with the data landing in their CRM.

## The program, and what this spec covers

danlo wants four things a client (or a prospect) sees. They build on each
other and ship in this order, each as its own spec, plan and PR:

1. **Website traffic in the CRM** — this spec. Visits, pages, sources, places
   and devices, stored nightly in BIS and shown on a "Website" section.
2. **Leads the site produced** — a report joining these rows to the
   attribution the public forms already capture (`contacts.attribution`,
   `form_submissions.attribution`: `utm_*`, `ref`, `gclid`, `fbclid`).
3. **Google search performance** — clicks, impressions, average position from
   Google Search Console, read through ONE agency Google account that owns
   every BIS-built domain's property (verified at build time; no client
   sign-in).
4. **Prospect audit** — paste a prospect's URL, run Google's PageSpeed
   check, store the scores on their opportunity as its first record.

Pieces 2–4 reuse this spec's `sites` record and cron pass. Nothing here
anticipates them beyond that record.

## Decisions (danlo, 2026-09-07)

1. **Traffic first**, the other three after; all four wanted.
2. **Hosting is Vercel, one project per client, on danlo's team.** Therefore
   the traffic source is **Vercel Web Analytics** (approach A), read through
   Vercel's REST API with a team-scoped token. Not a BIS-served tracking
   snippet (approach B), not GA4 (approach C).
3. **Nightly snapshots stored in BIS**, not live reads from Vercel on page
   load. The CRM reads only its own tables.
4. **The first site is BIS's own website** (`bis-website`,
   `prj_TDD9bT1z3Ow0fjLFaXxfxqIeH6w0`), as the dogfood, on an agency-only
   internal account. **MarBran is NOT linked — they are not a client.**
5. **The screen is a first-class design surface.** danlo: "a world-leading
   UI/UX designer … a nice vivid output." Layout locked: C's sentence on top
   of B's tiles and chart, with C's "Where they were" panel integrated
   beside pages and sources. `DESIGN.md` governs every token and chart rule.

## Architecture

A client's website is a first-class record: a `sites` row links their BIS
account to their Vercel project. Everything else hangs off that link.

**The pull.** A new `site_traffic` pass in the existing cron harness
(`api/cron/reminders`, the `*/15` tick). Once per day per site — the first
tick after 03:00 in the account's timezone — it calls the Web Analytics API
for the day that just ended (in the account's timezone) and writes the
rows below. Five queries per site per day:

| Query | Endpoint | Grouping | Cap |
|---|---|---|---|
| totals | `/v1/query/web-analytics/visits/count` | — | — |
| pages | `/visits/aggregate` | `requestPath` | 20 |
| sources | `/visits/aggregate` | `referrerHostname` | 20 |
| places | `/visits/aggregate` | city if the API offers it, else `country` (see Open checks) | 20 |
| devices | `/visits/aggregate` | `deviceType` | 20 |

Each returns `visitors` and `pageviews`. The pass stamps
`sites.last_synced_day`. If days were missed (cron outage, token rotated),
the next run backfills from `last_synced_day + 1` up to 30 days, oldest
first, stopping at the first failure so a hole is never left behind a
success.

**Isolation, in the harness's own terms.** One `now` per tick; a fixed cap
of sites per tick (10, like the other passes); a per-site `try` so one bad
project never blocks the rest; a failure leaves `last_synced_day` where it
was and logs the reason; Vercel 429/5xx is logged and retried next tick,
never looped within the tick. The Vercel client is constructed LAZILY inside
the pass (the SMS-provider precedent): a missing token fails that pass
loudly on its tick and touches nothing else.

**Env (server only, never the browser):** `VERCEL_API_TOKEN` (team-scoped)
and `VERCEL_TEAM_ID`.

**No visitor-level data ever enters BIS.** Vercel returns aggregates; the
tables hold counts per day per dimension value and nothing else.

## Data model — migration 0029

All three tables are tenant-scoped with the member READ policy
`form_submissions` uses; no client-side write path (service role only).

**`sites`** — one per client website (unique on `account_id` for now; a
table rather than columns on `accounts` so a second site is a row, not a
migration).

| column | type | note |
|---|---|---|
| `id` | uuid pk | |
| `account_id` | uuid fk accounts on delete restrict, unique | |
| `vercel_project_id` | text not null unique | `prj_…` |
| `domain` | text not null | production hostname, read from the project, editable |
| `analytics_enabled_at` | timestamptz | set when "Test connection" first succeeds |
| `last_synced_day` | date | null until the first pull |
| `created_at` | timestamptz default now() | |

**`site_traffic_daily`** — `(site_id, day)` pk · `visitors int` ·
`pageviews int`. The chart line and the tile numbers.

**`site_traffic_breakdown`** — `(site_id, day, dimension, value)` pk ·
`dimension text check in ('page','source','place','device')` · `value text`
· `visitors int` · `pageviews int`. Top 20 per dimension per day; the page
sums over the selected range.

Rows are tiny (≈80 per site per day). Nothing is pruned; history outlives
Vercel's retention by construction.

**`channelOf(referrerHostname)`** — one pure function, tested with a table:
empty → `Direct`; `google.*`, `bing.*`, `duckduckgo.*`, `yahoo.*` →
`Google`, `Bing`, `DuckDuckGo`, `Yahoo` (search engines by name);
`facebook.*`, `l.facebook.*`, `instagram.*`, `t.co`, `linkedin.*`,
`youtube.*`, `tiktok.*` → `Social`; anything else → `Other websites`.
Piece 2 reuses it so "Google" means the same on both screens.

## The screen — "Website"

Reference: `docs/design/website-section.html` (the locked mockup).
Placement: under OVERVIEW, directly below Dashboard, in both the client's
workspace and the agency's per-account view. The client sees only their
site; the agency sees the same page inside any account.

**Header.** Title "Website"; the period switch `7D · 14D · 30D` (default
14); the stamp `UPDATED THIS MORNING · 6:00 AM` in the mono label style.
The comparison in every delta and in the sentence is always the
same-length period immediately before.

**1. The sentence panel** (label `THE LAST 14 DAYS`). One paragraph built
from the same rows as the tiles, so it can never disagree with them:
"**1,284 people** visited your website, **18% more** than the two weeks
before. Most of them found you on **Google**, the page they read most was
**Services**, and seven in ten were on a phone." Bold fragments are the
accent colour. Rules, each pinned by a test:
- the top source and the top page are named only when the leader is at
  least 10 points of share ahead of the runner-up; otherwise the clause is
  dropped;
- a change under 5% reads "about the same as";
- under 20 visitors in the period, no percentages at all — the plain count
  and nothing more ("14 people visited your website");
- device clause only when one device type has ≥ 60% share.

**2. Four tiles** with sparklines (the CRM's existing `StatTile`
language): Visitors (count, delta), Pageviews (count, delta), From Google
(share of visitors whose channel is Google, delta in points), Top page
(name, visitors, share).

**3. Visitors by day**, full width: thin accent bars, 4px rounded tops,
weekend bars muted (`--surface-3`), mono axis labels, hover tooltip on
every bar with the date, visitors and pageviews. Under it, a slim device
strip (Phone / Desktop / Tablet) with a legend — accent, accent-soft,
`--line-strong` — so the four tiles stay the four that matter.

**4. Three panels in a row:** Pages people read · Where visitors came from
(channels via `channelOf`, then hostnames under "Other websites" on hover)
· Where they were (cities if available, else the fallback in Open checks;
the last row rolls the rest up as "Elsewhere"). Each row: name,
proportional bar, value, top five.

**States, all designed:**
- *No site linked:* the section stays in the nav. One sentence that sells
  the feature — "See who visits your website, where they come from, and
  what they read" — and one action: client → "Ask BIS about a website"
  (a `mailto:` to the agency's support address with a prefilled subject —
  no new mechanism; BIS has no client-to-agency conversation feature);
  agency → "Link a site" (the settings form below).
- *Linked, no data yet:* sentence panel reads "Your first numbers arrive
  tomorrow morning"; tiles and chart render as skeletons shaped like the
  real ones.
- *Loading:* skeletons in the exact layout; nothing jumps when data lands.
- *Stale or failed sync:* if `last_synced_day` is more than two days behind,
  the stamp becomes a quiet warning line with the date; the numbers stay.
  The client never sees an error code; the failure is in the cron log.

**Contract:** tokens only, no hard-coded colours/radii/shadows; renders in
dark AND light; keyboard reachable (period switch, tooltip on focus);
`prefers-reduced-motion` respected; nothing animates on scroll; the
`/styleguide` page gains the new chart and strip.

## Linking a site — agency-only settings form

Under the account's Settings, for the agency role only: Vercel project
(picked from the list the token can see — no ids typed), production domain
(pre-filled from the project, editable), and **Test connection**, which
runs one `visits/count` for the last 7 days and shows the number Vercel
returns (or the exact refusal, e.g. "Web Analytics is not enabled for this
project"). Saving writes the `sites` row; the first pull runs that night.

## The standardized build checklist (runbook)

1. Create the Vercel project on the team from the site template.
2. `vercel project web-analytics <name>` — once.
3. Keep the analytics script tag the site template already carries
   (`<script defer src="/_vercel/insights/script.js">` with the `window.va`
   shim, per Vercel's plain-HTML quickstart).
4. In BIS → Settings → Website: link the project, test the connection.
5. Next morning: confirm the section shows real numbers.

Nothing requires the client; steps 1–3 happen where the agency already
works.

## Dogfood — definition of done

An internal BIS account (agency-only, client access off, named so it can
never be mistaken for a client) is created. Web Analytics is enabled on
`bis-website`; the tag goes into that site's layout (its own repo); the
link is made through the settings form. **Done:** the Website section
shows the BIS site's real visitors, pages and sources from the first full
night of data, in both dark and light, and the four states are visible on
the styleguide. Those screenshots are the prospect demo until piece 4.

## Security

The Vercel token lives only in the server env, scoped to the team, never
sent to the browser. The three tables carry the member read policy; only
the service role writes. The link form and the test-connection action sit
behind the existing agency role gate. Aggregates only — no IPs, no
visitor ids.

## Tests — one named mutation per test

- **db:** the three tables' grants and policies pinned the way booking's
  are (SQLSTATE, not `status >= 400`), watched red before 0029.
- **Pure functions, table-driven:** `channelOf`; the sentence builder
  (leader margin, "about the same", under-20, device clause); the period
  comparison math (same-length prior window, timezone day boundaries); the
  Vercel response parser against recorded fixtures for all five queries.
- **The pass:** due-site selection (03:00 local, once per day), backfill
  window and stop-at-first-failure, per-site isolation, stale stamp
  threshold, lazy client construction, and a sentinel-style scan that no
  row type carries a visitor-identifying field.
- **Screen:** route/page tests for the four states with projection-filtered
  mocks (the voice-route pattern); a snapshot of the sentence for the
  fixture rows.
- **e2e, per-run fixture account:** link a site with a stubbed connection
  test, open the Website section, see the "first numbers tomorrow" state.
- **Gates:** `pnpm check`, build, full e2e; CI green on the PR head; danlo
  merges.

## Open checks — the plan's first task pins these before any code

1. **Vercel Web Analytics plan allowance and retention** for the team's
   plan (did not surface in the docs search). The pull asks for daily
   aggregates, not events, so a tight allowance is a cost question, not a
   design change.
2. **Whether the API exposes a city or region dimension.** The documented
   dimensions are `country`, `requestPath`, `referrerHostname`,
   `deviceType`, `browserName`, `osName`, UTM fields. If city/region is not
   available, "Where they were" shows countries — useless for a local
   business — so the fallback is: the third panel becomes **Devices &
   browsers** and the device strip under the chart is dropped. Decide on the
   dogfood's first real response.

## Out of scope

Pieces 2–4 above; more than one site per account; live reads from Vercel;
custom events; sites not hosted on Vercel; MarBran.
