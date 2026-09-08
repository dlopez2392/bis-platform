# Website traffic — build checklist and setup runbook

Audience: danlo. Part A once per environment; Part B once per BIS-built site.
Spec: `docs/superpowers/specs/2026-09-07-website-traffic-design.md`.
Plan: `docs/superpowers/plans/2026-09-07-website-traffic.md`.

## Findings (2026-09-07, Task 1 of the plan)

- **Web Analytics enabled on `bis-website`** (`prj_TDD9bT1z3Ow0fjLFaXxfxqIeH6w0`)
  via `vercel project web-analytics bis-website --scope danlopez508-8452s-projects`
  on 2026-09-07. The CLI does not take `--yes`; it needed no confirmation.
- **Place dimension: NONE.** The Web Analytics API refuses `by=city` and
  `by=region`; its allowed groupings are exactly: `hour, day, week, month,
  year, country, deviceType, environment, requestPath, referrerHostname,
  osName, browserName, route, utmSource, utmMedium, utmCampaign, utmContent,
  utmTerm, flags` (verbatim from the 400 response). Decision, per the spec's
  Open check 2 fallback: `PLACE_DIMENSION = "country"` — places are still
  stored by country for later pieces, but the Website section's third panel
  is **Devices** and the device strip under the chart is dropped, so devices
  are shown once. "Where they were" returns if Vercel ever adds a city
  grouping; the tables need no change for that.
- **Plan allowance and retention** (vercel.com/docs/analytics/limits-and-pricing,
  last updated 2026-08-25): Pro includes **no** events; **$0.03 per 1,000
  collected events** (a pageview is one event; events are shared across
  every project on the team); reporting window **12 months** (Hobby: 50,000
  events/month included, 1-month window, collection pauses when exceeded).
  Ten client sites at ~5,000 pageviews each ≈ 50,000 events ≈ **$1.50/month**.
  BIS stores its own daily snapshots, so the reporting window never limits
  what a client sees. The page states no API rate limit; the pass makes 5
  calls per site per day (50/day for ten sites).
- **Platform env** (server only): `VERCEL_API_TOKEN` (team-scoped, one-year
  expiry — created by danlo, Part A below), `VERCEL_TEAM_ID` =
  `team_8zjV46sJxQDsVzikNQa1JaO2`.

## Part A — platform setup (once)

1. Vercel → Account → Tokens → create `bis-platform-analytics`, scope = the
   team, expiry 1 year. Copy it once.
2. Vercel → bis-platform project → Settings → Environment Variables:
   `VERCEL_API_TOKEN` = the token (mark it Sensitive), `VERCEL_TEAM_ID` =
   `team_8zjV46sJxQDsVzikNQa1JaO2` (Production + Preview).
3. **Redeploy.** Vercel applies environment variables to NEW deployments
   only (docs: "Changes to environment variables are not applied to
   previous deployments"). Deployments → the current production deployment
   → ⋯ → Redeploy, or `vercel redeploy --scope danlopez508-8452s-projects`
   with the deployment URL. The pass constructs its client lazily, which
   only means a missing token cannot crash a tick — it does not let a
   running deployment see a variable added after it was built.
4. Local: the same two lines in `apps/web/.env.local`.
5. Verify: the next `/api/cron/reminders` tick's JSON carries a `siteTraffic`
   key shaped `{ synced, daysSynced, failed, skippedNotYet, skippedUpToDate,
   skippedCap, unresolvableTimezone }`. With no sites linked every counter is
   0. A non-zero `failed` with `VERCEL_API_TOKEN/VERCEL_TEAM_ID unset` in the
   log means step 2 missed. Until Part A is done, Settings → Website lists no
   projects and says why — a new site cannot be linked (nothing to pick); an
   already-linked one keeps showing its domain.
6. First night after the token lands, read the cron log and the first
   `site_traffic_breakdown` rows for the dogfood and record in Findings:
   what a direct visit carries as `referrerHostname` (the parser reads
   null as ""), whether an `Others` row appeared (dropped by the parser),
   and that the `environment eq 'production'` filter was accepted (a 400
   on every aggregate would show as `failed: 1` every tick).

## Part B — every BIS-built site (five steps)

1. Create the Vercel project on the team from the site template.
2. `vercel project web-analytics <project> --scope danlopez508-8452s-projects`
   (no confirmation prompt; it prints the project's analytics state).
3. Keep the analytics tag the template carries. Plain HTML sites:
   `<script>window.va=window.va||function(){(window.vaq=window.vaq||[]).push(arguments)};</script>`
   `<script defer src="/_vercel/insights/script.js"></script>`
   Next.js sites: `npm i @vercel/analytics` and `<Analytics />` from
   `@vercel/analytics/next` in the root layout. Proof it is live: the
   deployed domain serves `/_vercel/insights/script.js` with a 200 (the tag
   itself is injected client-side, so it does not appear in `curl`'s HTML).
4. BIS → the client's account → Settings → Website: pick the project, confirm
   the address, **Test connection** (expect "Connected — N visitors…";
   "isn't switched on" means step 2), Save.
5. Next morning after 03:00 in the client's timezone: the Website section
   shows real numbers. Before that it says "Your first numbers arrive
   tomorrow morning" — that is correct, not a fault.

Nothing in Part B involves the client.

## The dogfood — BIS's own website

An internal account exists for it: name `BIS (internal — never invoice)`,
client access OFF, timezone America/Chicago, `clerk_org_id = org_internal_bis`
(no Clerk org; nobody signs in as it). Linked to project `bis-website`
(`prj_TDD9bT1z3Ow0fjLFaXxfxqIeH6w0`), domain `bis-rgv.com`. The site has
carried `<Analytics />` since 2026-07-08 (BIS-Website `d17625a`) and
bis-rgv.com serves the insights script. Its Website section is the prospect
demo until the prospect audit piece exists.

## When something is wrong

- Section says "We haven't been able to update these numbers since <date>":
  read the cron log for `site traffic pull failed for site …`. A 429 clears
  itself next tick; `web_analytics_not_enabled` means Part B step 2 was
  undone; anything mentioning the token means Part A step 2.
- Log says `site traffic HELD for site …: … timezone … is not a zone we can
  resolve`: the account's timezone is not an IANA zone; fix it on the
  account, the next tick picks the site up.
- A site needs unlinking: delete `site_traffic_breakdown`, then
  `site_traffic_daily`, then the `sites` row (FKs are RESTRICT on purpose).

## First-night findings (2026-09-08, first real pull)

- **Part A done by danlo 13:44Z; redeploy 13:45Z; first pull on the 14:00Z
  tick**: 30 days written in ~3 minutes, stamp `2026-09-07`, no failures.
  Token scope (All Projects on the team) and the `environment eq 'production'`
  filter were accepted.
- **Every backfilled day is zero — genuinely.** Web Analytics was enabled on
  the project at ~02:15Z on 2026-09-08 and its routes only exist on
  deployments made after that (quickstart: "will add new routes … after your
  next deployment"); bis-website was deployed at 03:18Z, so collection
  started then. Vercel's own report agrees: 0 through 2026-09-07, then
  1 visitor at 13:00Z on `/en` on 2026-09-08. The section fills after the
  first pull that covers 2026-09-08 (the 03:00 Chicago tick on the 9th).
- **Direct traffic's `referrerHostname` is `""`** (empty string, not null).
  `channelOf("")` → Direct, as designed. No `Others` row appeared (one path).
- 🔴 **Two API window behaviours the pass does not account for** (verified
  by probing with the MCP analytics tool, same endpoints):
  1. `visits/count` FLOORS `since` and `until` to UTC midnight. A local-day
     window such as Chicago `05:00Z → 05:00Z` is answered for the UTC day
     `00:00Z → 00:00Z`. Probe: since `14:00Z` returned the 13:00Z view.
  2. `visits/aggregate` honours `since` to the hour but treats `until` as
     INCLUSIVE of its bucket (echoed back +1h): `until 13:00Z` returned a
     13:00–14:00 view. So the breakdowns cover local midnight → local
     midnight **plus one hour**, while the totals cover the UTC day.
  Consequence: within one stored day, totals and breakdowns span different
  windows; shares (breakdown ÷ total) can drift or exceed 100%. Not visible
  yet (all zeros). **Decision owed:** either store UTC days honestly
  (count at UTC midnights; aggregate `until = day end − 1h`; label days as
  UTC in copy) — the smallest change — or keep local days by summing hourly
  buckets (`by=hour`), which overcounts unique visitors. Tracked in the
  ledger; no code changed on the first night.
- Local `.env.local` carries `VERCEL_TEAM_ID` only; the token line was left
  for danlo to add at the machine (a pasted token would live in the chat).
