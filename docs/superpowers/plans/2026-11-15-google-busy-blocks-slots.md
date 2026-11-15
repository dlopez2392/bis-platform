# Google calendar busy times block slots (S-22, slice 1: read-only)

Tier: **HIGH** (OAuth tokens, a server-only table with grants, a migration, what Sofía and the booking page
offer). Plan only; nothing here is built yet. Source: focus-list row 9; S-22 (`docs/crm-features.md:1422`,
§7.1 at `:2925-2945`); the study `docs/research/2026-09-25-crm-feature-research.md:441-575`.
Owner decisions, 2026-11-15: slice 1 is **read-only**: times the owner is busy on their Google calendar are
not offered, by Sofía on a call or on the public booking page. Writing bookings into Google is **slice 2**.
The Google OAuth app stays in **Testing mode** (up to 100 named test users) in a Google Cloud project danlo
creates; Google's verification comes later.
**Done when:** an event on danlo's real Google calendar removes that time from the booking page, and Sofía
will not book it on a test call (section 6).

## 0. Today (read before changing anything)

- One engine for picker and submit: `computeSlots` / `bookableRange` (`apps/web/src/lib/booking/slots.ts:314`,
  `:474`) judge `booked: Range[]` through ONE predicate with the two-sided buffer (`conflictScan`, `:291`).
- Every reader goes through `readsFor` (`lib/booking/availability.ts:27`: booked ranges and closures in
  parallel), via `computeAllSlots` (`:55`), `bookableSlot` (`:84`), `moveSlots` (`:98`), `movableSlot`
  (`:108`), called by the public page (`app/b/[publicId]/actions.ts:145`, `:271`), the move page
  (`move/[token]/actions.ts:70`, `:124`) and Sofía (`lib/voice/tools/registry.ts:342` `check_availability`;
  `:538`, `:751`). Every caller computes the WHOLE horizon, then keeps one day.
- A tool call holds the caller's audio until it answers (`lib/voice/call-events.ts:198-226`); no per-tool
  timeout or written latency budget exists. Limits: `max_advance_days` 1..365, buffer 0..240 min, slot
  5..480 min (`migrations/0016_booking.sql:15-18`).
- Precedents: server-only table `0104_calendar_feeds.sql` (RLS on, no policy, client privileges revoked)
  and its matrix test `packages/db/src/test/calendar-feeds-schema.test.ts`; sealing in
  `lib/consent/token.ts` (AES-256-GCM, HKDF, one `_PREVIOUS` slot) and `readSecret`
  (`lib/fixture-secrets.ts`); dormancy in `getMeetingProvider()` (`lib/meetings/provider.ts:18-22`).
- The calendar page (`(dashboard)/dashboard/accounts/[accountId]/calendar/page.tsx`) holds the settings card
  (`canManage`, `:293`) and the one-way feed card (`:318`), whose spec defers this to S-22
  (`2026-10-28-calendar-feed-design.md:16`, `:50`). Nothing in the repo talks to Google Calendar today.

## 1. Decisions

**D1. Scope: `https://www.googleapis.com/auth/calendar.freebusy`, plus `openid` and `email`.** The narrowest
scope `freeBusy.query` accepts (V2): intervals only, so no title, attendee or place ever reaches BIS. `email`
names the connected Google account on the card, so a wrong account is visible. Rejected:
`calendar.events.readonly`/`calendar.readonly` (read every event to compute what freeBusy computes). The
class ("sensitive" per the study) is A1, and `calendar.events.freebusy` is A2.
**D2. The primary calendar only** (`items: [{ id: "primary" }]`). Choosing others needs
`calendar.calendarlist.readonly`, a second sensitive scope; the card says only the main calendar counts. Q5.
**D3. Who connects: the agency or the account's Owner** (`canManage`, the settings card's gate), never Staff
or a Technician; one connection per account; disconnect, the same people. Q2.
**D4. Disconnect = revoke at Google (V9), then delete the row**; a failed revoke is logged and the row is
still deleted. No Undo: it would need the revoked token back, the "Change PIN" case of DESIGN.md rule 6
(amended 2026-11-09). An `emit` event records who did it.
**D5. Tokens.** The refresh token is sealed with AES-256-GCM under `GOOGLE_CALENDAR_TOKEN_KEY` (env, never the
database), HKDF-derived as in `consent/token.ts`, with additional data `account_id|id|version` so a
ciphertext copied onto another row does not open; `key_version` stored, one `_PREVIOUS` slot for rotation.
Production refuses a key under 32 characters or a fixture value (`readSecret`): the feature stays dormant.
Access tokens live in module memory only, keyed by connection and version, until `expires_in` minus 5 min
(A12). Nothing logs a token; Google's error bodies are reduced to their `error` code.
**D6. The table is server-only** (0104's pattern). "The agency and that Owner see status only" is the
server's job: `requireAccountAccess`, `canManage`, then `getGoogleConnectionStatus`, whose column list
excludes the ciphertext. One accessor reads the ciphertext, called only from `lib/google/calendar-client.ts`
(`import "server-only"`).
**D7. OAuth: authorization-code flow, server side.** `access_type=offline` and `prompt=consent` (a fresh
refresh token on every reconnect, V7); `state` sealed under the token key (account id, Clerk user id, nonce,
PKCE verifier, 10-minute expiry) plus an HttpOnly `SameSite=Lax` nonce cookie. The callback re-runs
`requireAccountAccess` and `canManage`, refuses a state minted for another user or account, exchanges the
code, and writes nothing unless the returned `scope` contains `calendar.freebusy` (the user can untick it,
V7). PKCE is defence in depth on a confidential client (A7).
**D8. Redirect URI from env** (`GOOGLE_CALENDAR_REDIRECT_URI`): Google matches it exactly, with no wildcard
(V8), and a Preview deployment's URL changes per push. Connect is offered only when the page's origin is that
URI's origin (the cookie is host-bound); elsewhere the card names the address. ONE Google project, two Web
clients: production (`https://app.bis-rgv.com/api/google-calendar/callback`) and development (localhost plus
one stable Preview alias, A10). Isolation holds: Preview and local runs carry the development client and
their own key against bis-ci, so neither side can open the other's rows.
**D9. Live `freeBusy.query` per read, for a DAY window; a 60-second memo for the picker only.** No stored busy
times, no sync job (F-196 not needed). Window: the asked day in the account zone, plus one day each side. A
candidate on day D meets only ranges within the buffer (240 min max) of D, so that covers every conflict and
every re-anchor point (`bookableRange`'s anchors) across DST and UTC+14, and never nears a range limit (A4).
The picker and `check_availability` share a per-instance memo keyed by connection, version and window, which
also bounds what a bot on the public endpoint costs in quota (A6). The SUBMIT checks (`bookableSlot`,
`movableSlot`) always read fresh: a time taken on Google since the picker loaded is refused, as in BIS.
**D10. Busy blocks join `booked`, buffer and all.** `readsFor` merges them into the same `Range[]`, so
`slots.ts` does not change: one predicate, the two-sided buffer (travel time around the owner's 9:00 too),
D-028's re-anchor and the picker/submit invariant hold as they are; Google's `[start, end)` is the `[)` of
`bookings_no_overlap` (V3). The answer is validated BEFORE the merge: an unparseable instant or an
`errors[]` entry makes the whole answer `unchecked`, never an Invalid Date in the engine (which closes every
slot). Q4.
**D11. Fail mode (recommended; Q1): when Google cannot answer, offer slots exactly as today.** Outcomes:
`checked` (merged); `unchecked` (timeout, network, 429, 5xx, malformed, `errors[]`); `disconnected`
(`invalid_grant`, or 401 after a fresh token). Both failures offer what BIS alone would and log one line
(account, outcome; never a token or a busy time). Why: failing closed switches booking OFF for the account
during any Google slowness, and in Testing mode every connection dies every 7 days (V4); before this feature
every booking was unchecked anyway. Never silent: `disconnected` sets `needs_reconnect` (D12).
**D12. `invalid_grant`.** The read marks the row `needs_reconnect` by compare-and-set on the `version` it read
(a reconnect that landed meanwhile survives), stops calling Google for it, and opens ONE To-do (no contact,
the account's language), its id kept on the row so a second failure opens none; reconnecting completes it.
Run after the answer (`after()` on the page; caught and logged on a call), never delaying the caller.
**D13. Latency budget: 1,500 ms for the whole Google leg** (refresh plus freeBusy, one `AbortSignal`), in
PARALLEL with the database reads, so a caller waits max(db, Google); a timeout is `unchecked`. A cached
access token makes most reads one round trip. PR 4 logs `google_busy_ms`; the budget is revisited on the
first week of logs (A5).
**D14. Callers read a day, not the horizon.** `computeAllSlots` becomes `computeDaySlots(db, calendar, tz,
now, dayKey)` and `moveSlots` takes the day; the whole-horizon reader is deleted, so typecheck finds every
caller. Sofía's tool still answers only "isn't available": nothing about the owner's day reaches a caller.
**D15. Dormant without env**: no client id (or a refused key) means no card, routes 404 and no Google read,
today's behaviour exactly. Production gets its env only after PR 4 merges.
**D16. Surface: one card on the EXISTING calendar page, right column under the feed card**, that page's
busy-times setting. The module contract holds (one settings section, nothing new top-level), so DESIGN.md
needs no amendment; the card moves whole into Conexiones (F-148) when that is built. The agency sees each
account's status on its card; a cross-account column waits for F-148's agency view.

## 2. Data (PR 1, one migration from `pnpm --filter @bis/db migration:new google_calendar_connections`)

`public.google_calendar_connections`: `id uuid pk`; `account_id uuid not null unique` (one per account)
`references accounts on delete cascade` (a token is not a lead); `version int not null default 1` (bumped on
every connect); `google_email text not null`; `scope text not null`; `status text not null check (status in
('connected','needs_reconnect'))`; `refresh_token_sealed text not null`; `key_version smallint not null`;
`refresh_expires_at timestamptz` (Google's time-limited grant, V7); `connected_by uuid references users on
delete set null` (not 0104's memberships FK: the agency may connect, D3); `connected_at`,
`last_checked_at` (stamped at most every 10 min), `needs_reconnect_since timestamptz`; `reconnect_task_id
uuid references tasks on delete set null`; pair checks (`needs_reconnect_since` set iff status is
`needs_reconnect`). Grants: 0104's revoke-all-then-grant-back to service_role. `account-teardown.ts` lists
the table. Accessors in `packages/db/src/google-calendar.ts`: `getGoogleConnectionStatus` (no ciphertext),
`readGoogleConnectionSealed` (the one ciphertext reader), `upsertGoogleConnection` (version + 1),
`markGoogleNeedsReconnect(id, version)` (CAS), `stampGoogleChecked`, `deleteGoogleConnection`.

## 3. UI and copy (PR 3; every string through `t()`, keys under `calendar.google.*`)

Card title "Google Calendar" in both languages. Status is dot + word (rule 3). One primary at most.
- **Loading:** a skeleton shaped like the card. **Error** (status read failed, the card's own boundary):
  "Couldn't load your Google Calendar connection. Refresh the page to try again." / "No se pudo cargar su
  conexión con Google Calendar. Actualice la página para intentarlo otra vez."
- **Empty:** "Times you're busy on your Google Calendar won't be offered to customers, on the phone or on
  your booking page. We only see when you're busy, never what the event is." / "Las horas en que usted está
  ocupado en su Google Calendar no se ofrecerán a sus clientes, ni por teléfono ni en su página de citas.
  Solo vemos cuándo está ocupado, nunca de qué se trata." Primary **Connect Google Calendar** /
  **Conectar Google Calendar**.
- **Connected:** "● Connected · {email}" / "● Conectado · {email}" (`--good`); "Only your main calendar
  counts. Events you mark as Free don't block a time. Last checked {time}." / "Solo cuenta su calendario
  principal. Los eventos que marque como Disponible no bloquean una hora. Revisado por última vez a las
  {time}." Ghost **Disconnect** / **Desconectar**; toast "Disconnected. Customers can book times you're
  busy on Google again." / "Desconectado. Sus clientes pueden volver a reservar horas en que usted está
  ocupado en Google."
- **Needs reconnecting** (`--crit`): "● Needs reconnecting" / "● Hay que volver a conectarlo"; "Google
  stopped showing us when you're busy, so customers can book any open time again. While this is in
  testing, Google asks for this every 7 days." / "Google dejó de mostrarnos cuándo está ocupado, así que sus
  clientes pueden volver a reservar cualquier hora abierta. Mientras esto está en prueba, Google lo pide
  cada 7 días." Primary **Reconnect** / **Volver a conectar**; ghost Disconnect.
- **After the callback** (`?google=` on the page, one status line): connected "Google Calendar connected.
  Busy times are no longer offered." / "Google Calendar conectado. Ya no se ofrecen las horas en que está
  ocupado."; box unticked or denied "Google didn't share your busy times, so nothing changed. Try again and
  leave the calendar box ticked." / "Google no compartió sus horas ocupadas, así que nada cambió. Inténtelo
  otra vez y deje marcada la casilla del calendario."; failed "Couldn't connect to Google. Nothing changed.
  Try again in a minute." / "No se pudo conectar con Google. Nada cambió. Inténtelo otra vez en un minuto."
- **Wrong origin** (D8): "To connect, open this page at {origin}." / "Para conectar, abra esta página en
  {origin}." **To-do:** "Reconnect your Google Calendar" / "Vuelva a conectar su Google Calendar".
- Palette: one entry, "Google Calendar" / "conectar google calendario", to the calendar page (additive).

## 4. Owner's manual checklist (danlo only; values never pasted into chat or a file)

Console labels are A9 (verify as you click). Do steps 1-8 before PR 2's Preview check; step 9's Production
half only after PR 4 merges.
1. console.cloud.google.com > project picker > **New project**, name "BIS Platform" > Create.
2. APIs & Services > **Library** > "Google Calendar API" > **Enable**.
3. **Google Auth Platform** (formerly "OAuth consent screen") > Get started: app name "BIS", your support
   email, Audience **External**, contact email > Create.
4. **Audience**: leave Publishing status at **Testing** (never press "Publish app" in slice 1). Test users >
   Add users: your own Google address for acceptance; later each pilot owner's (100 at most, ever listed).
5. **Data access** > Add or remove scopes > tick `openid`, `.../auth/userinfo.email` and
   `.../auth/calendar.freebusy` > Save. Note which section the console files `calendar.freebusy` under
   (sensitive or not) and tell the orchestrator (closes A1, A2).
6. **Branding**: authorized domain `bis-rgv.com` (home and privacy links can wait for verification).
7. **Clients** > Create client > **Web application**, "BIS web (production)", Authorized redirect URI
   `https://app.bis-rgv.com/api/google-calendar/callback` > Create.
8. Create a second Web client, "BIS web (development)", redirect URIs
   `http://localhost:3000/api/google-calendar/callback` and the stable Preview alias's
   `.../api/google-calendar/callback` (A10).
9. Vercel > Settings > Environment Variables (Remove-then-Add on an existing name, then redeploy):
   - **Production**: `GOOGLE_CALENDAR_CLIENT_ID` (production client; not sensitive),
     `GOOGLE_CALENDAR_CLIENT_SECRET` (sensitive), `GOOGLE_CALENDAR_TOKEN_KEY` (sensitive; 32 random bytes,
     base64url, piped straight into `vercel env add`), `GOOGLE_CALENDAR_REDIRECT_URI`.
   - **Preview**: the same four names with the DEVELOPMENT client and a DIFFERENT token key.
   - Your `apps/web/.env.local`: the development client, a third key, the localhost URI.
   - `GOOGLE_CALENDAR_TOKEN_KEY_PREVIOUS` stays unset until a rotation.

## 5. Build: four PRs, each shippable and dormant until the last

**PR 1 (HIGH): table, accessors, sealing.** ~600 lines. Migration (section 2);
`packages/db/src/google-calendar.ts` + barrel exports; `lib/google/token-seal.ts`. Ships inert.
Tests: schema/grants matrix modelled on `calendar-feeds-schema.test.ts` (bis-db-schema's file, see Needs);
accessor tests on bis-ci (CAS refuses a stale version; upsert bumps version; status read has no ciphertext
field); seal round trip, wrong key, previous key, tampered tag, moved-row AAD, short or fixture key refused
in production. Probes: `grant select ... to authenticated` fails the matrix; `select("*")` in the status
read fails "no ciphertext"; dropping the AAD fails "moved row does not open"; dropping the CAS predicate
fails "stale version is not marked".
**PR 2 (HIGH): OAuth and the Google client.** ~550 lines. `lib/google/calendar-client.ts` (token exchange,
refresh, freeBusy, revoke; `fetch` injected, never a real Google call in a test or script); routes
`/api/google-calendar/connect`, `/callback`, and a disconnect server action. Tests: a state minted for user
A or account A is refused for B; expired state refused; nonce cookie mismatch refused; Staff and Technician
refused at connect AND callback; a callback whose `scope` lacks freebusy writes nothing; disconnect deletes
even when revoke fails; no response, redirect or log line contains a token (assert on captured output);
routes 404 when dormant. Probes: skip the user-id compare, skip the expiry, allow `staff`, skip the scope
check, delete only on revoke success: each fails its test by name.
**PR 3 (LOW): the card, copy, palette.** ~400 lines. `google-card.tsx` + `google-card-data.ts` on the
calendar page (D16), copy in `lib/messages.ts` (both languages, pseudo-locale +35%), skeleton and error
boundary. Tests: view builder per state (empty, connected, needs reconnecting, error, wrong origin,
dormant), the serialised view carries no token-shaped field, `INTERNAL_MILESTONE`-style copy guard holds.
**PR 4 (HIGH): busy blocks slots.** ~650 lines. `lib/booking/google-busy.ts` (window, memo, validation,
outcomes, `google_busy_ms` log); `readsFor` gains the parallel read and the merge; `computeDaySlots` and the
day-taking `moveSlots` (D14); `invalid_grant` path (D12). Tests (fake Google): a 10:00-11:00 busy block
hides 10:00, and with a 15-minute buffer and 60-minute slots hides 09:00 too; every slot `computeDaySlots`
offers passes `bookableSlot` under the same Google answer; submit refuses a slot busy on Google even when
the memo said free; timeout, 429, 5xx, `errors[]`, an unparseable instant, all give today's slots and one
log line (per Q1's answer); `invalid_grant` marks once, opens one To-do, and later reads make no Google
call; a reconnect between read and mark survives; a fall-back day (America/Chicago) busy block on the
second 01:30 blocks only that instant; a spring-forward day; Pacific/Kiritimati (UTC+14) window covers the
day; an all-day block from a Google calendar in another zone blocks exactly its instants; a block ending
23:50 the day before with a 240-minute buffer blocks the early slots (window width); a hung fetch answers
`unchecked` inside 1,500 ms (fake timers). Probes: drop the merge (busy test fails), widen nothing (window
test fails with a same-day-only window), pass Google's instants unvalidated (the unparseable test fails),
read the memo at submit (the fresh-submit test fails).

Order: PR 1, then PR 2, then PR 3 and PR 4 in parallel lanes. Production env (step 9) after PR 4 merges.
Each PR: one implementer; HIGH ones get one review with the probes above; one end-of-PR review.
**Without production credentials:** tests use an injected `fetch` and bis-ci; Preview and local runs use
the development client, their own key and bis-ci, with danlo's Google as a test user, so the real consent
screen and a real freeBusy run before production holds anything. Agents never call Google.

## 6. Acceptance (danlo, on production, Bespoke's account, after PR 4 and step 9)

1. Calendar page > Connect Google Calendar > pick your Google > allow. Card: Connected, your email.
2. On Google, add a busy event tomorrow 10:00-11:00 (account zone). Booking page, tomorrow: 10:00 is gone
   (and its buffer neighbours, if a buffer is set). Mark the event Free: 10:00 returns within a minute.
3. Call `(956) 506-1545` (Bespoke's line, booking on), ask for 10 tomorrow: Sofía offers other times;
   insist on 10: she will not book it (`bookableSlot` refuses).
4. Disconnect: card empty; BIS gone from your Google account's third-party access (A11); 10:00 returns.
5. Read a week of `google_busy_ms` lines (Vercel logs) against D13's budget.

## 7. Risks, and what is out

- **Weekly reconnect in Testing mode** (V4): every pilot connection dies every 7 days. Mitigated by D11/D12
  (bookings continue, the card and a To-do say so); removed only by Google's verification. Q3.
- **Double booking remains possible** in the gaps: an event added after the submit check, any `unchecked`
  read (Q1), a non-primary calendar (D2), staff-made bookings (F-046's agenda does not read Google).
- **Quota and abuse**: the public picker triggers Google reads; the 60 s memo bounds it per instance (A6).
- **Out:** slice 2, writing bookings to Google with Meet links (`calendar.events`; it must then drop
  BIS-written events from busy, or a move sees its own event); choosing calendars; Outlook; per-staff
  calendars (S-23); contacts sync (S-26); attendee matching; an agenda "busy on Google" warning; a "not
  checked against Google" line in the booking alert; a cron token-health check; the agency's cross-account
  column (F-148); Google's verification (decision 34).

## 8. Owner questions (each with a recommendation)

- **Q1. Fail mode.** When Google is slow, down or the connection has expired: (a) offer slots as today, or
  (b) withhold all slots. **Recommend (a)**: (b) stops every booking during any Google hiccup and every 7
  days in Testing mode; (a) only returns to today's behaviour, and the card and a To-do make it visible.
- **Q2. May the agency connect on an owner's behalf?** **Recommend yes** (D3): setup is agency-led, the
  Google screen and the card name the Google account, and acceptance on Bespoke needs it.
- **Q3. Testing-mode pilot.** Who pilots, knowing they reconnect weekly? **Recommend** danlo's Bespoke and at
  most one pilot client, and submitting `calendar.freebusy` and slice 2's `calendar.events` together once
  slice 2 works (adding a scope later triggers a new 2-4 week review, study §6.1).
- **Q4. Buffer around Google events.** **Recommend yes** (D10): one rule, and the buffer is travel time.
- **Q5. Primary calendar only in slice 1.** **Recommend yes** (D2); choosing calendars costs a second scope.

## 9. Google assumptions

Verified 2026-11-15 from developers.google.com (pages fetched and read):
- **V1** `calendar.freebusy` ("View your availability in your calendars") and `calendar.events.freebusy`
  ("See the availability on Google calendars you have access to") exist (`/workspace/calendar/api/auth`).
- **V2** `freeBusy.query` (POST `/calendar/v3/freeBusy`) accepts `calendar.readonly`, `calendar`,
  `calendar.events.freebusy` or `calendar.freebusy` (`/workspace/calendar/api/v3/reference/freebusy/query`).
- **V3** `busy[].start` is inclusive, `end` exclusive; a calendar can return `errors[]` (`notFound`,
  `internalError`, more "may be added") inside a successful answer; `timeZone` defaults to UTC (same page).
- **V4** External + Testing: refresh tokens expire in 7 days unless only name, email and profile scopes are
  requested (`/identity/protocols/oauth2`, "Refresh token expiration").
- **V5** 100 refresh tokens per account per client (a new one drops the oldest). **V6** A token also stops on
  revocation, six months unused, an expired time-based grant, or an admin restriction (same).
- **V7** `refresh_token` only with `access_type=offline`; the token response carries `scope` and, for
  time-based access, `refresh_token_expires_in`; users may grant only some scopes, and the app must check
  (`/identity/protocols/oauth2/web-server`, steps 5-6).
- **V8** Redirect URIs match exactly (scheme, case, trailing slash), must be HTTPS except localhost, and allow
  no wildcard (same page, "Redirect URI validation rules"). `state` is recommended against CSRF (same).
- **V9** Revocation is a POST to `https://oauth2.googleapis.com/revoke` with `token=` (same page's sample).
Unverified (how and when):
- **A1** `calendar.freebusy` is "sensitive" (the study's 2026-09-25 reading; today's page gives no class),
  and **A2** whether `calendar.events.freebusy` is classed differently: checklist step 5.
- **A3** freeBusy counts events marked Free and declined events as free; all-day events default to Free:
  acceptance step 2.
- **A4** a maximum freeBusy range: designed around (3-day windows), never relied on.
- **A5** freeBusy plus refresh fit 1,500 ms from Vercel: PR 4's log line, first week.
- **A6** the Calendar API's quotas: console > APIs & Services > Calendar > Quotas, at step 2.
- **A7** the token endpoint accepts PKCE S256 from a web client, and **A8** a test user sees an "unverified
  app" screen and may continue: PR 2's first Preview connect (drop PKCE if refused).
- **A9** console labels (Google Auth Platform: Branding, Audience, Data access, Clients): at click time.
- **A10** Vercel offers a stable Preview alias usable as a redirect URI: Vercel dashboard, before step 8.
- **A11** revocation removes BIS from the account's third-party access page: acceptance step 4.
- **A12** an access token lives about an hour: never assumed; `expires_in` is read every time.

## Needs from other agents

- **bis-db-schema:** the migration review and the grants test file for the new table (PR 1).
- **bis-voice:** in PR 4, `registry.ts:342` calls `computeDaySlots(…, date)` instead of filtering
  `computeAllSlots`; no prompt change (the tool already says only "isn't available").
- **bis-platform / orchestrator:** the `.env.example` block for the five names (PR 2); a runbook
  `docs/runbooks/google-calendar.md` carrying section 4; Google on the agents' never-call list.
- **bis-e2e-qa (optional, LOW):** a card-states spec on the per-run fixture account with a seeded row.
