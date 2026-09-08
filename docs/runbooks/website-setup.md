# Website traffic — build checklist and setup runbook

Audience: danlo, once per BIS-built site (and once for the platform env).
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

_Parts A and B and the dogfood record are written in Task 9._
