# The operational floor: heartbeats, an alert pass, a per-account call forward, a restore drill (Design)

**Date** 2026-10-01 · **Status** approved (danlo, 2026-10-01: decisions 1–4 as proposed)
**Owner agents** bis-platform (health route, CI workflow, runbook), bis-automations (heartbeat writes,
the alert pass), bis-voice (the per-account forward, the model-down fallback), bis-db-schema (one
migration)
**Implements** `docs/crm-features.md` §4.2 "The operational floor": F-119 (part) and F-120 (part),
2.5–3.5 ew. The later halves (error tracking, bilingual incident notices, a status page, the fallback
host) stay where §4.5 puts them.

## Why this, and why now

There is one live client, and this is what happens when something breaks today:

- **If the 15-minute cron stops** (a failed deploy, a revoked `CRON_SECRET`, Vercel's scheduler),
  reminders, follow-ups, held-text releases and the weekly reports all stop. Nobody is told
  (`docs/crm-features.md:731-732`).
- **If a pass throws on every tick,** the harness catches it, logs one `console.error` line to
  Vercel and moves on (`lib/automations/harness.ts:29-42`). Only someone reading Vercel's logs
  would know.
- **If Sofía's model is down,** a caller is hung up on. The SIP leg to OpenAI ends, Telnyx fetches
  the handoff `action` URL, and the handoff route dials a person only when the caller *asked* for
  one (`handoff_requested_at`); otherwise it returns `<Hangup/>`
  (`api/voice/texml/handoff/route.ts:353-365`).
- **If one client's phones need taking back,** the only lever is `VOICE_FORWARD_TO`. It is
  deployment-wide, takes a redeploy to set and another to clear, and forwards every number on
  every account (`api/voice/texml/route.ts:242-249`, `298-307`).
- **No backup has ever been restored.** No runbook covers backups, restore or the Supabase plan
  (`docs/runbooks/`), and the roadmap still lists confirming whether production is on Pro or Team as
  an open step (§4.2).

## Verified facts (checked in the tree at `6c492d1`; do not re-derive)

- **Cron.** There is one cron, `/api/cron/reminders`, every 15 minutes (`apps/web/vercel.json`).
  - The route authenticates with a bearer `CRON_SECRET`, compared in constant time
    (`route.ts:40-50`).
  - It runs `PASSES` in order: 14 passes from `registry.ts:50`. The `Pass` type is
    `{ key, run(ctx) }` (`context.ts:55-58`).
  - `cron-coupling.test.ts` ties the schedule to `vercel.json`.
- **No run records.** There is no cron-run, tick or heartbeat table. `automation_log` is per
  account, source and subject, not per run (`0046_automation_log.sql:31-54`).
- **Agency email.** One path already sends email to the agency: `operator.agency_report` with
  `accountId: null` to `agencies.report_email` (`passes/weekly-agency-report.ts:52-118`).
- **Email kinds are registered.** Every kind is listed in `lib/consent/classes.ts` (`EMAIL_KINDS`
  :79, operator kinds :93-101). The gate throws on an unlisted kind, and `scans.test.ts` fails on
  one.
- **Per-account phone numbers already on `accounts`.**
  - `alert_phone` (0035): E.164, written only by the agency.
  - `transfer_phone` (0037): E.164, "where a caller who asks for a person is connected."
  - `voice_profiles` has no forward column.
- **Texting is dormant on every account** (no A2P approval), so an operator alert by text cannot be
  delivered today.
- **No health endpoint exists.** The `api/` folders are accounts, concierge, cron, sms,
  unsubscribe, voice and webhooks.
- **CI never connects to production.** CI runs on `odnobiodsftffphuuosz` and refuses production by
  a guard in both jobs (CLAUDE.md). This design keeps that rule: nothing here gives GitHub a
  production credential.

## Section 1 — Heartbeats (F-119 part)

**One table, `ops_heartbeats`**, global and agency-level, with no `account_id`. It is written only by
the service role, with no grants to `anon` or `authenticated`, pinned in the grants suite like every
other table since #150.

| column | type | meaning |
|---|---|---|
| `key` | text pk | `cron.tick`, `cron.pass.<pass key>`, `voice.texml`, `voice.sip_webhook`, `email.resend_webhook`, `sms.inbound`, `stripe.webhook` |
| `last_ok_at` | timestamptz null | last time this thing worked |
| `last_error_at` | timestamptz null | last time it failed |
| `last_error` | text null | first 300 chars of the error; never a token, an address or a phone number |
| `consecutive_failures` | int not null default 0 | reset to 0 on the next success |
| `alerted_at` | timestamptz null | when the alert pass last emailed about this key; cleared on recovery |

**Who writes it:**
- **The harness.** It writes `cron.tick` once per run and `cron.pass.<key>` once per pass, with
  `ok` or `error`. One upsert per pass, after the pass, outside its `try` so that a heartbeat failure
  can never fail a pass.
- **Each webhook route.** Each one stamps its key's `last_ok_at` on a request it accepted
  (signature valid, parsed). The write is best effort: it never throws and never delays the
  response, because Telnyx's TeXML fetch has a hard timeout.

**`GET /api/ops/health`** (new):
- It authenticates with the same `CRON_SECRET` bearer as the cron.
- It returns `200 {"ok":true}` when the database answers and `cron.tick` is under 45 minutes
  old (three missed ticks).
- Otherwise it returns `503` with the stale keys' names only, never errors or values.
- Unauthenticated, it returns 401, so the endpoint reveals nothing to a stranger.

**The dead-man's switch** covers the one failure the alert pass cannot report, the cron itself
stopping. It is a GitHub Actions scheduled workflow, `ops-health.yml`:
- It runs hourly and curls `/api/ops/health` with `CRON_SECRET`, stored as a repository secret.
- On a non-200 the job fails, and GitHub emails the repository owner. That needs no new vendor, as
  decision 2 asks.
- The workflow holds only `CRON_SECRET` and the public app URL. No database credential goes to
  GitHub.

## Section 2 — The alert pass (F-119 part)

A new pass, `opsWatch`, registered **last** in `PASSES` so that it sees the run it is part of. It
reads `ops_heartbeats` and emails the agency when:

1. a `cron.pass.<key>` has `consecutive_failures >= 2` (30 minutes failing);
2. a webhook key has `last_error_at` newer than `last_ok_at` and newer than 30 minutes ago;
3. the handoff route's model-down fallback fired (Section 3), so that BIS knows Sofía was
   unreachable.

**Silence is not an alert.** A quiet afternoon with no calls is normal for a small client, and an
alert that cries wolf gets filtered. The only silence check is the cron's own, made from outside by
Section 1's workflow.

**One email per incident.**
- `alerted_at` is set when the email is sent.
- A still-failing key is re-sent at most every 6 hours.
- When the key next succeeds, one "recovered" email goes out and `alerted_at` is cleared.

**Delivery.**
- A new operator email kind, `operator.ops_alert`, is registered in `classes.ts`.
- It goes to `agencies.report_email`, falling back to `AGENCY_SUPPORT_EMAIL`, which is
  `hello@bis-rgv.com` and forwards to the BIS inbox since 2026-10-01.
- It is in English, plain text, and names the key, the first failure time, the failure count and
  the error's first line.

**No text alert.** Operator texts cannot be delivered until A2P clears. Adding one is a one-line
follow-up once it does.

## Section 3 — The per-account call forward and the model-down fallback (F-120 part)

**The forward**:
- A new column, `voice_profiles.forward_calls boolean not null default false`. It forwards to that
  account's existing `accounts.transfer_phone`; there is no second number to keep in step.
- Written by the agency only, like `alert_phone`.
- In `texml/route.ts`'s `respond()`, after `classify()` has resolved the called number's account:
  if `forward_calls` is on and `transfer_phone` is set, the route returns `forwardXml(transfer_phone,
  calledE164)` and logs `texml FORWARDING account <id>`.
- The deployment-wide `VOICE_FORWARD_TO` keeps its place and still wins: it is checked first,
  exactly as today.
- In Settings → Voice, an agency-only switch, "Send calls straight to a person", shows the
  transfer number it uses. It is disabled with a reason when no transfer number is set.
- It runs at once with an undo toast (DESIGN.md rule 6) and emits `voice.forward_changed`, with the
  actor, so the account's history shows who took the phones back and when.

**The model-down fallback**:
- In the handoff route, when the SIP leg to OpenAI **never connected** and no handoff was
  requested, the route dials `transfer_phone` instead of hanging up.
- The test for "never connected" is `DialCallStatus` of `failed`, `busy` or `no-answer`, or
  `DialCallDuration` of 0. The exact field values are checked against Telnyx's TeXML docs in the
  plan, not assumed.
- It stamps the call `transferred` through the existing `handoff-result` path. It also stamps
  `voice.sip_webhook`'s heartbeat as an error, so Section 2 emails BIS that Sofía was unreachable.
- With no `transfer_phone` set, the behaviour is today's: hang up.

## Section 4 — The restore drill (F-120 part)

**Option A (proposed): a quarterly manual drill.**
- **Runbook.** `docs/runbooks/restore-drill.md` says how to restore production's latest backup into
  a **new, temporary** Supabase project, using the dashboard's "Restore to a new project". This is
  available on the paid plans, so the drill starts by confirming the plan, the roadmap's open step.
- **Check script.** `packages/db/scripts/restore-check.ts`, run by hand, compares the restored
  project with production. It checks row counts per table, the latest migration version and a
  spot-check of the newest `events` row. Both sides are opened **read-only** and only counts are
  printed, never a row.
- **Teardown.** The temporary project is deleted the same hour.
- **Record.** Each drill appends its date, backup age, duration and result to the runbook's log
  table. The first drill is run when this ships.

**Option B (not proposed): a nightly automated dump-and-restore in GitHub Actions.** This needs a
production database credential in GitHub, which the repository's rule that CI never touches
production forbids today. It is recorded so the trade-off is visible.

## Section 5 — Testing (each is a mutation that must go red)

- **Harness.** A pass that throws writes `consecutive_failures + 1`. A pass that then succeeds
  resets it to 0. A heartbeat write that throws does not fail the pass.
- **Alert pass.**
  - Two failing ticks send one email.
  - A third failing tick inside 6 hours sends none.
  - Recovery sends exactly one "recovered" email and clears `alerted_at`.
  - A key that has only been quiet sends nothing.
  - The kind is registered (the scans test).
- **Health route.**
  - 401 without the bearer.
  - 503 naming `cron.tick` when the tick is 46 minutes old.
  - 200 at 44 minutes.
  - The body never contains `last_error` text.
- **Forward.**
  - With `forward_calls` on and `transfer_phone` set, the TeXML dials the transfer number.
  - With it off, it is today's SIP dial.
  - `VOICE_FORWARD_TO` still wins over both.
  - An account with `forward_calls` on but no transfer number gets Sofía, not dead air.
- **Model-down fallback.** A never-connected SIP leg with a transfer number dials it, and one
  without a transfer number hangs up. A completed leg with no handoff request hangs up as today.
- **Grants.** `ops_heartbeats` gives no grant to `anon` or `authenticated`. The grants suite pins
  it.
- **e2e.** The agency flips the switch on the per-run fixture account, the undo restores it, and a
  client session sees no switch.

## Decisions (danlo, 2026-10-01: all four approved as proposed)

1. **The dead-man's switch on GitHub Actions** (Section 1). An hourly workflow with `CRON_SECRET` as
   a repository secret; GitHub emails the owner on failure. OK?
2. **The model-down fallback** (Section 3). Ring the account's transfer number when Sofía is
   unreachable, instead of hanging up. In scope now?
3. **The restore drill.** Option A, the quarterly manual drill into a temporary project, as
   proposed?
4. **Where alerts go.** `agencies.report_email` first, then `hello@bis-rgv.com`. OK?

## Out of scope, recorded

- An error tracker, incident notices to clients in two languages and a status page (F-119, §4.5).
- A fallback host that answers when the platform itself is down (F-120, §4.5).
- Operator texts, until A2P clears.
- Alerting on silence beyond the cron.

## Amendments taken while building (2026-10-01)

- **The health check has a key of its own, `OPS_HEALTH_SECRET`, instead of `CRON_SECRET`.** The
  value stored in GitHub then opens `/api/ops/health` and nothing else. It cannot run the passes,
  and rotating it never touches the cron.
- **The webhook stamps (Section 1, "Each webhook route") move to PR-2.** Every webhook route's
  test replaces `after()` with a recorder and pins its calls, so stamping five routes is five
  test suites to change. That belongs with the routing changes PR-2 already makes to the call
  path, route by route, each with its own test updated. PR-1 ships the cron's heartbeats, the
  alert pass, the health route and the dead-man's switch, which cover the failure the roadmap
  names first: the cron stopping, or a pass failing on every tick.

## Amendments taken while building PR-2 (2026-10-01)

- **The model-down fallback needs a signed ticket, because "no call row" is exactly its case.**
  The handoff route finds a call by the token on its `calls` row, and that row is written by
  Sofía's own webhook (`startCallRow`), which never runs when OpenAI is unreachable. Section 3
  assumed a row to stamp. So the TeXML route, which has already resolved the account and passed
  every guard before it dials Sofía, writes a ticket into the `<Dial action>` URL: the account,
  the dialled number and the time, HMAC-signed with a key derived from
  `SUPABASE_SERVICE_ROLE_KEY` (no new env var), bound to the call's own handoff token, valid
  10 minutes (`apps/web/src/lib/voice/fallback-ticket.ts`). The handoff route acts only on a
  verified ticket.
- **Only a call every guard cleared carries a ticket.** The webhook declines by never accepting,
  which looks the same from the handoff route as Sofía being down. But the TeXML route runs the
  same guards first and speaks the refusal itself, so a call it dialled was cleared. When a guard
  read fails open, no ticket is signed, and the fallback hangs up as today: a caller the guards
  could not vouch for is never forwarded to a person.
- **"Never connected" is `DialCallStatus` of exactly `failed`, `busy` or `no-answer`.** Telnyx
  documents the enum (completed, busy, no-answer, canceled, failed) but not which failure gives
  which value. `canceled` is excluded (the caller hung up while it rang; dialling the business
  then rings a person for nobody). The "`DialCallDuration` of 0" clause is dropped: Telnyx
  documents the field as conditional, and a `completed` leg connected whatever it says.
- **No `transferred` stamp on a fallback call.** There is no call row to stamp. The record is the
  `voice.sip_webhook` error heartbeat, written whenever a verified ticket meets a never-connected
  leg (with or without a transfer number), which is what emails BIS. The fallback dial carries no
  machine detection and no result URL, both of which read the call row.
- **The forward replaces the bridge, and only for a fully cleared call.** An unknown or not-live
  number, a disabled profile and a known repeat-spam caller still refuse first. A forwarded call
  never reaches Sofía's webhook, so the TeXML route's fail-open is not backed by the webhook's
  re-check there: a call whose guard reads FAILED goes to Sofía (where the webhook gates it),
  never to the forward (review, Important 1).
- **The forward target is refused when it is any BIS line**, the account's own (the handoff
  guard) or another account's (two forwards, or two model-down fallbacks, would ping-pong a call
  that writes no row a cap could count). The fallback applies the same check.
- **Forward dials carry `timeLimit="3600"`**, the handoff dial's billing ceiling, including the
  deployment-wide `VOICE_FORWARD_TO`.
- **KNOWN LIMIT, recorded rather than built: a forwarded call writes no `calls` row**, so the daily
  cap and the repeat-spam reputation only ever count calls Sofía took. A robot that starts calling
  while the forward is on is not counted or marked. Accepted for now because the forward is a
  short-lived lever and each leg is bounded by `timeLimit`; the copy says only that numbers
  already marked as spam are turned away. A forward cap (or a row per forwarded call) is the
  follow-up if the lever is ever left on for long.
- **OPEN: the fallback's carrier behaviour is unmeasured.** It sends a second `<Dial>` on an
  inbound leg the bridge never answered (`answerOnBridge`), where every earlier handoff ran on an
  answered call. One real test call (OpenAI unreachable on a test number) should confirm it
  before decision 2 is relied on. 2026-10-04: no line could be cut off alone (every number is
  live and the SIP address is shared), so a drill switch was added — `VOICE_FALLBACK_DRILL_TO`
  and `_FROM`, both required, dial an address that never resolves for that one caller on that
  one line (`lib/voice/fallback-drill.ts`; runbook `voice-setup.md`, "Drilling the model-down
  fallback"). It runs quarterly beside the restore drill. It reproduces ONE way to be
  unreachable — a name that does not resolve; an OpenAI timeout or 5xx may report a different
  `DialCallStatus`, after a longer ring. Any status outside the set is now logged by the handoff
  route, so a real outage teaches us the rest.
- **Wherever `TELNYX_PUBLIC_KEY` is unset**, anyone reaching `/api/voice/texml` stamps
  `voice.texml` ok, which can close an open `voice.texml` alert early. Corrected 2026-10-04: this
  section was written believing the key unset in production; it has been set there since
  2026-09-29 (`docs/runbooks/a2p-registration.md`; `GET /api/voice/texml` answers 405). So in
  production a stranger cannot stamp `voice.texml`, and the fallback's `DialCallStatus` arrives
  in a Telnyx-signed body. The signature covers the body, not the query string, so the handoff
  token and the fallback ticket still do the binding to one call; nothing here is relaxed.
- **The webhook stamps.** One helper, `lib/ops/stamp.ts`, writes through `after()` and never
  throws. Ok on a request the route accepted and handled; an error when the route cannot work for
  anyone (a missing secret) or the work failed after acceptance, with a fixed sentence and at
  most the error's type, never its message. Never on a refused signature: a stranger must not be
  able to send BIS an alert. The keys are the five in Section 1; `watch.ts` names each in words,
  pinned by a type-level test.
