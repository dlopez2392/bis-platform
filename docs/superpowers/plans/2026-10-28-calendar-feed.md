# The owner's calendar feed (F-048 part 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every person on a client's team gets one private, revocable `webcal`/`https` link that their iPhone, Google or Outlook calendar subscribes to, showing each BIS booking with its time, its kind and the customer's first name only, in that person's language.

**Architecture:** `calendar_feeds` (migration 0104) holds one row per link. The row stores only `sha256(token)`, and the token is derived from the row id under `CALENDAR_FEED_SECRET`, so the card can show the link again. A public route `GET /cal/<token>.ics` re-proves the link on every fetch with one locked, service-only function, `claim_calendar_feed_fetch`, which checks the token, the membership, client access, an archived account and the hourly limit, and returns the role. The route then reads the account's bookings in a bounded window, fenced to a Technician's assigned customers, and renders one VEVENT per reschedule chain through the existing `ics.ts` folding and escaping. A card on the Calendar page makes, copies, replaces and turns off the link, with Undo.

**Tech Stack:** Next.js App Router route handler and server actions, Supabase (PostgREST and plpgsql), vitest, Playwright (bis-e2e-qa only), `node:crypto` HMAC-SHA256.

**Spec:** `docs/superpowers/specs/2026-10-28-calendar-feed-design.md` (owner decisions D1–D3, §8).

## Global Constraints

- Migration number **0104**. It reaches bis-ci only AFTER 0103 (`feat/contacts-archive`). **No agent applies 0104 anywhere**: the orchestrator does that (checklist at the end).
- 0104 is proven on a local **PostgreSQL 17.6** replica, never PG18 (PG18's skip scan hides PG17 plans). Binaries: `C:\Users\danlo\AppData\Local\Temp\claude\C--Users-danlo-bis-platform\88d51cd6-6c5b-4497-af8a-63647f233ba6\scratchpad\ca-t1\pg17\pgsql\bin\` (`postgres.exe --version` → `postgres (PostgreSQL) 17.6`). The replica applies 0001–0102 from this worktree, THEN 0103 from `feat/contacts-archive`, THEN 0104.
- No `@bis/db` vitest that needs a live database (`withTestAccount`, `withRollback`) runs locally. CI `verify` proves those. Fake-client `@bis/db` tests DO run locally: this worktree has no `packages/db/.env`, so `global-setup.ts:31-33` skips the sweep. If `packages/db/.env` exists, stop and ask.
- Commands, from `C:\Users\danlo\bis-platform\.claude\worktrees\calendar-feed`: web `pnpm --filter web exec vitest run <paths>`; db `pnpm --filter @bis/db exec vitest run <paths>`. Judge a db run by vitest's summary block, never the exit code (its trailing `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL` lies). Never run `pnpm check`, the build or Playwright.
- Owner decisions (spec §8): **D1** every member (owner, staff, technician) gets a link; a Technician's carries only bookings of customers assigned to them; the agency gets none. **D2** a separate `CALENDAR_FEED_SECRET`, at least 32 characters, with no fallback. **D3** no meeting URL in any event.
- Window: `starts_at` in [now − 30 days, now + 180 days); at most 1,500 upcoming and 300 past rows.
- Per link: at most 120 fetches per fixed hourly window (`p_max = 120`, `p_window_seconds = 3600`).
- Undo window: 30 seconds (`CALENDAR_FEED_UNDO_SECONDS = 30`).
- Every refused fetch (bad shape, unknown, turned off, removed member, access off, archived account) answers the SAME 404: body `Not found`, `Cache-Control: no-store`, `X-Robots-Tag: noindex`. Never log a token.
- Event content: SUMMARY `<kind>: <first name>` (no-show: `No-show · …` / `No se presentó · …`); DESCRIPTION one dashboard link; never a last name, phone, email, note, meeting URL, address, ORGANIZER or ATTENDEE. Calendar name from `brandDisplayName`, never `accounts.name`.
- Copy passes the 7 AM read, EN and ES, no milestone codes, no `{{`, no arrows. Owner copy lives in `apps/web/src/lib/messages.ts` under `calendar.feed.*` (Spanish twin = key + `.es`, `lib/i18n/t.ts:42`).
- Commits: `git add <explicit paths>` only, message `type(scope): what and why`, scope `db` (T1) or `booking` (T2–T5) or `e2e` (T6). Never stash, checkout, amend or push.

## Deviations from the spec (the source wins)

1. **Four database functions, not five.** Making a link is one INSERT (the partial unique index refuses a second live row with 23505), so it goes through PostgREST. Replace, restore and claim need atomicity. Turn-off (`revoke_calendar_feed`) is a function so that `revoked_at` is the DATABASE's `now()`, the same clock restore compares against, never the app server's `new Date()` (review M4).
2. **`schema-grants-guard.test.ts` is NOT edited.** Its `EXPECTED_WRITES` (`:65-112`) lists only what `authenticated` may write; a table with every client privilege revoked needs no entry, and the guard already fails by name if the revoke is forgotten. The new `calendar-feeds-schema.test.ts` pins SELECT, EXECUTE and service_role, which the guard does not check (`jobs-schema.test.ts:21-23`'s reason).
3. **`lib/http/retry-after.ts` is not used.** It PARSES an incoming `Retry-After` (`:24-30`); the route WRITES its own, in whole seconds, from the claim's `retry_after_seconds`.
4. **Fixed window, stamped on every fetch.** The claim already writes the row for the counter, so a once-a-minute throttle on `last_fetched_at` would save nothing.
5. **`accounts.status = 'archived'` answers 404** (`0001_tenancy.sql:26`'s status column, which the spec missed). `paused` keeps serving, as a billing pause does.
6. **No `TRANSP` line.** RFC 5545 §3.8.2.7 makes OPAQUE the VEVENT default, and adding it to the shared builder would change `bookingIcs`'s pinned output.
7. **No events emitted.** A person's own calendar link is not news on any record's timeline, and nothing reads such an event (YAGNI).
9. **No loading skeleton for the card** (spec 5.1's Loading row; review M7). The card's view is read inside the Calendar page's own server render (`page.tsx`, beside the other reads) and arrives with the page, so the card itself never has a loading moment. The page has no `loading.tsx` of its own today; the card adds none.
10. **Turn off, Make a new link and Undo are allowed during a billing pause; Make my link is not** (coordinator decision on review I3). The three are protective: a leaked link must be closable while the account is read-only. Each passes `{ duringPause: "allow" }` to its own awaited `requireAccountAccess` in the action body, sits on `READ_ONLY_ALLOWED` with a reason, and does not revalidate (`lib/billing/read-only.test.ts:276-310`); the card's handlers already call `router.refresh()`.
11. **"Last checked" is stamped by the claim, BEFORE the bookings are read** (review M3). A fetch that then fails (500) still counts as a check, so the card says when the calendar last ASKED, not when it last received a good copy.
8. **Archived contacts' bookings stay in the feed.** A booking is a real appointment, and 0103 brings a contact back on a booking anyway. Nothing here may name `contacts.archived_at`: the column does not exist on this branch until 0103 merges.

## File map

| File | Task | Responsibility |
|---|---|---|
| `packages/db/supabase/migrations/0104_calendar_feeds.sql` (new) | T1 | Table, two indexes, composite FK to memberships, RLS, grants, four functions, rollback |
| `packages/db/src/test/calendar-feeds-schema.test.ts` (new) | T1 | Live (CI only): grants, EXECUTE, cascade, claim, replace, restore, second account |
| `packages/db/src/account-teardown.ts` | T1 | `"calendar_feeds"` on `ACCOUNT_OWNED_TABLES` |
| scratchpad `cf-t1/pg17-cf.sh`, `cf-t1/probe-0104.sql` (new, outside the repo) | T1 | PG17 replica build and the 0104 probes |
| `apps/web/src/lib/booking/ics.ts` | T2 | `FeedEvent`, `calendarFeedIcs`; `bookingIcs` byte-identical |
| `apps/web/src/lib/booking/ics.test.ts` | T2 | New `describe` blocks only |
| `apps/web/src/lib/booking/feed-strings.ts` (+`.test.ts`) (new) | T2 | EN/ES words inside the feed |
| `apps/web/src/lib/booking/feed-content.ts` (+`.test.ts`) (new) | T2 | Rows → events (first name, dedupe, kind), → the VCALENDAR |
| `apps/web/src/lib/booking/feed-token.ts` (+`.test.ts`) (new) | T2 | Derive, hash, shape, URL helpers |
| `packages/db/src/calendar-feeds.ts` (new) | T3 | Typed wrappers for the table and the four functions |
| `packages/db/src/booking.ts` | T3 | `rescheduleRoots`, `listFeedBookings` |
| `packages/db/src/index.ts` | T3 | Additive exports |
| `packages/db/src/test/feed-bookings-reads.test.ts` (new) | T3 | Fake client, runs locally |
| `packages/db/src/test/calendar-feeds.test.ts` (new) | T3 | Live (CI only): wrappers end to end |
| `apps/web/src/lib/booking/calendar-feed.ts` (+`.test.ts`) (new) | T4 | Loader: claim → language → bookings → ICS |
| `apps/web/src/app/cal/[file]/route.ts` (+`.test.ts`) (new) | T4 | GET/HEAD, ETag/304, 404/429/500 |
| `apps/web/src/proxy.test.ts` | T4 | One `it.each` row |
| `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calendar/feed-card-data.ts` (+`.test.ts`) (new) | T5 | The card's view, server side |
| `…/calendar/feed-actions.ts` (+`.test.ts`) (new) | T5 | Make, replace, turn off, undo |
| `…/calendar/feed-card-handlers.ts` (+`.test.ts`) (new) | T5 | Toasts with Undo, testable without hooks |
| `…/calendar/feed-card.tsx` (+`.test.ts`) (new) | T5 | The card, every state |
| `…/calendar/page.tsx`, `…/calendar/page.test.ts` | T5 | Render the card; mock its modules |
| `…/[accountId]/in-account-service-reads.test.ts` | T5 | Two `ALLOWED` entries |
| `apps/web/src/lib/messages.ts` | T5 | `calendar.feed.*` keys, EN + `.es` |
| `apps/web/src/lib/palette/registry.ts` | T5 | Keywords on the existing `"/calendar"` line (`:74`) |
| `apps/web/e2e/calendar-feed.spec.ts` (new), `apps/web/playwright.config.ts` | T6 | e2e on the per-run fixture account |

## Waves

| Wave | Tasks (files disjoint) | Needs |
|---|---|---|
| 1 | T1 (high, bis-db-schema), T2 (medium, bis-booking) | — |
| 2 | T3 (high, bis-booking) | T1's function names and columns |
| 3 | T4 (high, bis-booking), T5 (medium, bis-frontend) | T2, T3. One worktree: T4 runs `pnpm --filter web typecheck` and `in-account-service-reads.test.ts` only AFTER T5 has committed (review M6), and neither task stages the other's files. |
| 4 | T6 (medium, bis-e2e-qa) | T4, T5; 0104 on bis-ci |

---

### Task 1: Migration 0104, its schema test and the PG17 proof

**Tier:** high · **Owner:** bis-db-schema · **Wave:** 1

**Files:**
- Create: `packages/db/supabase/migrations/0104_calendar_feeds.sql`
- Create: `packages/db/src/test/calendar-feeds-schema.test.ts`
- Modify: `packages/db/src/account-teardown.ts:23-24` (after `"jobs",`)
- Create (scratchpad, not committed): `C:\Users\danlo\AppData\Local\Temp\claude\C--Users-danlo-bis-platform\88d51cd6-6c5b-4497-af8a-63647f233ba6\scratchpad\cf-t1\pg17-cf.sh`, `…\cf-t1\probe-0104.sql`

**Interfaces:**
- Produces (T3 relies on these exact names):
  - table `public.calendar_feeds(id uuid pk, account_id uuid, user_id uuid, token_hash text unique, created_by text, created_at timestamptz, revoked_at timestamptz null, last_fetched_at timestamptz null, fetch_window_started_at timestamptz null, fetch_count int)`
  - `public.claim_calendar_feed_fetch(p_token_hash text, p_max integer, p_window_seconds integer) returns jsonb`. It answers `{"status":"not_found"}`, `{"status":"rate_limited","retry_after_seconds":int}` or `{"status":"ok","feed_id","account_id","user_id","role","user_language"}`.
  - `public.replace_calendar_feed(p_account_id uuid, p_user_id uuid, p_new_id uuid, p_new_hash text, p_created_by text) returns jsonb`. It answers `{"status":"none"}` or `{"status":"ok","previous_id","revoked_at"}`.
  - `public.restore_calendar_feed(p_account_id uuid, p_user_id uuid, p_feed_id uuid, p_revoked_at timestamptz, p_replacement_id uuid, p_max_age_seconds integer) returns text`, which is `'restored'` or `'changed'`.
  - `public.revoke_calendar_feed(p_account_id uuid, p_user_id uuid) returns jsonb`. It answers `{"status":"none"}` or `{"status":"ok","feed_id","revoked_at"}`, with `revoked_at` the database's `now()`.

- [ ] **Step 1: Build the PG17 replica (pre = 0001–0102 + 0103).** Write `cf-t1/pg17-cf.sh`. It uses port **55741** and its own data dir, so it never touches contacts-archive's replica on 55731:

```sh
#!/bin/sh
# pg17-cf.sh init : PG17.6 on 55741; pre = this worktree's 0001-0102 + feat/contacts-archive's 0103
# pg17-cf.sh post : post = pre + this worktree's 0104
# pg17-cf.sh probe DB : run probe-0104.sql against DB (pre must FAIL, post must PASS)
set -u
S=/c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/88d51cd6-6c5b-4497-af8a-63647f233ba6/scratchpad
B="$S/ca-t1/pg17/pgsql/bin"
D="$S/cf-t1"
P="-h localhost -p 55741 -U postgres -v ON_ERROR_STOP=1 -q"
W=/c/Users/danlo/bis-platform/.claude/worktrees/calendar-feed
M=$W/packages/db/supabase/migrations
case "$1" in
init)
  "$B/initdb" -D "$D/pgdata17" -U postgres -A trust -E UTF8 --locale=C --locale-provider=icu --icu-locale=en-US > "$D/initdb.log" 2>&1 || { echo initdb failed; exit 1; }
  "$B/pg_ctl" -D "$D/pgdata17" -o "-p 55741" -l "$D/pg.log" start </dev/null >/dev/null 2>&1; sleep 4
  "$B/psql" $P -d postgres -tAc "select version()" || exit 1
  "$B/psql" $P -d postgres -c "create role anon nologin noinherit" -c "create role authenticated nologin noinherit" \
    -c "create role service_role nologin noinherit bypassrls" -c "grant anon, authenticated, service_role to postgres" \
    -c "create database pre" -c "alter database pre set timezone to 'UTC'" || exit 1
  "$B/psql" $P -d pre <<'SQL' || exit 1
create schema if not exists app;
create schema if not exists extensions;
create schema if not exists storage;
create table storage.buckets (id text primary key, name text not null, public boolean, file_size_limit bigint, allowed_mime_types text[]);
alter default privileges for role postgres in schema public grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema app grant all on functions to anon, authenticated, service_role;
SQL
  for f in $(ls $M/*.sql | sort); do
    case "$(basename $f)" in 0104_*) continue;; esac
    "$B/psql" $P -d pre -1 -f "$f" > /dev/null 2> "$D/mig.err" || { echo "FAILED $f"; cat "$D/mig.err"; exit 1; }
  done
  git -C "$W" show feat/contacts-archive:packages/db/supabase/migrations/0103_contact_archive.sql > "$D/0103_contact_archive.sql" || exit 1
  "$B/psql" $P -d pre -1 -f "$D/0103_contact_archive.sql" > /dev/null 2> "$D/mig.err" || { echo "FAILED 0103"; cat "$D/mig.err"; exit 1; }
  echo "pre = 0001-0102 + 0103 on $("$B/psql" $P -d pre -tAc 'show server_version')" ;;
post)
  "$B/psql" $P -d postgres -c "drop database if exists post with (force)" -c "create database post template pre" || exit 1
  "$B/psql" $P -d post -1 -f "$M/0104_calendar_feeds.sql" > "$D/0104.apply.txt" 2>&1 || { echo "0104 FAILED"; cat "$D/0104.apply.txt"; exit 1; }
  echo "post = pre + 0104" ;;
probe)
  "$B/psql" -h localhost -p 55741 -U postgres -v ON_ERROR_STOP=1 -d "$2" -f "$D/probe-0104.sql" > "$D/probe-$2.txt" 2>&1
  echo $? > "$D/probe-$2.exit" ;;
esac
```

Run: `sh …/cf-t1/pg17-cf.sh init`. Expected last line: `pre = 0001-0102 + 0103 on 17.6`.

- [ ] **Step 2: Write the probes, `cf-t1/probe-0104.sql`.** Every probe raises `PROBE Pn FAILED` on a wrong answer, and the whole file runs in one rolled-back transaction:

```sql
begin;
-- Fixtures: two accounts, three people. Literal ids so a failure names them.
insert into agencies (id, name) values ('00000000-0000-4000-8000-0000000000a0', 'CF probe agency');
insert into accounts (id, agency_id, clerk_org_id, name, client_access_enabled) values
  ('aaaaaaaa-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a0', 'org_cf_a', 'CF A', true),
  ('aaaaaaaa-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000a0', 'org_cf_b', 'CF B', true);
insert into users (id, clerk_user_id, email, language) values
  ('bbbbbbbb-0000-4000-8000-000000000001', 'user_cf_owner', 'o@example.com', 'es'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'user_cf_tech',  't@example.com', null),
  ('bbbbbbbb-0000-4000-8000-000000000003', 'user_cf_b',     'b@example.com', null),
  ('bbbbbbbb-0000-4000-8000-000000000004', 'user_cf_staff', 's@example.com', null);
insert into memberships (user_id, scope, account_id, role) values
  ('bbbbbbbb-0000-4000-8000-000000000001', 'account', 'aaaaaaaa-0000-4000-8000-000000000001', 'owner'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'account', 'aaaaaaaa-0000-4000-8000-000000000001', 'technician'),
  ('bbbbbbbb-0000-4000-8000-000000000003', 'account', 'aaaaaaaa-0000-4000-8000-000000000002', 'owner'),
  ('bbbbbbbb-0000-4000-8000-000000000004', 'account', 'aaaaaaaa-0000-4000-8000-000000000001', 'staff');  -- A's member with no link (review I1)
insert into calendar_feeds (id, account_id, user_id, token_hash, created_by) values
  ('cccccccc-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001', repeat('a', 64), 'user_cf_owner'),
  ('cccccccc-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002', repeat('b', 64), 'user_cf_tech'),
  ('cccccccc-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000003', repeat('c', 64), 'user_cf_b');

do $$ begin  -- P1 grants: no client privilege of any kind; service_role holds what it needs
  if has_table_privilege('anon', 'public.calendar_feeds', 'SELECT') or has_table_privilege('authenticated', 'public.calendar_feeds', 'SELECT')
     or has_table_privilege('authenticated', 'public.calendar_feeds', 'INSERT') or has_table_privilege('authenticated', 'public.calendar_feeds', 'UPDATE')
     or not has_table_privilege('service_role', 'public.calendar_feeds', 'SELECT')
     or has_function_privilege('authenticated', 'public.claim_calendar_feed_fetch(text, integer, integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.replace_calendar_feed(uuid, uuid, uuid, text, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.restore_calendar_feed(uuid, uuid, uuid, timestamptz, uuid, integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.revoke_calendar_feed(uuid, uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.revoke_calendar_feed(uuid, uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.claim_calendar_feed_fetch(text, integer, integer)', 'EXECUTE')
  then raise exception 'PROBE P1 FAILED: grants'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.calendar_feeds'::regclass) then raise exception 'PROBE P1 FAILED: rls off'; end if;
  raise notice 'PROBE P1 ok';
end $$;

do $$ declare r jsonb; begin  -- P2 claim: ok with role and language, the account the ROW names
  r := public.claim_calendar_feed_fetch(repeat('a', 64), 120, 3600);
  if r->>'status' <> 'ok' or r->>'role' <> 'owner' or r->>'user_language' <> 'es'
     or r->>'account_id' <> 'aaaaaaaa-0000-4000-8000-000000000001' then raise exception 'PROBE P2 FAILED: %', r; end if;
  r := public.claim_calendar_feed_fetch(repeat('c', 64), 120, 3600);  -- second account: its own id, never A's
  if r->>'account_id' <> 'aaaaaaaa-0000-4000-8000-000000000002' then raise exception 'PROBE P2 FAILED second account: %', r; end if;
  if public.claim_calendar_feed_fetch(repeat('d', 64), 120, 3600)->>'status' <> 'not_found' then raise exception 'PROBE P2 FAILED unknown'; end if;
  if (select last_fetched_at from calendar_feeds where id = 'cccccccc-0000-4000-8000-000000000001') is null then raise exception 'PROBE P2 FAILED stamp'; end if;
  raise notice 'PROBE P2 ok';
end $$;

do $$ begin  -- P3 every closed state is the same not_found
  update calendar_feeds set revoked_at = now() where id = 'cccccccc-0000-4000-8000-000000000001';
  if public.claim_calendar_feed_fetch(repeat('a', 64), 120, 3600)->>'status' <> 'not_found' then raise exception 'PROBE P3 FAILED revoked'; end if;
  update calendar_feeds set revoked_at = null where id = 'cccccccc-0000-4000-8000-000000000001';
  update accounts set client_access_enabled = false where id = 'aaaaaaaa-0000-4000-8000-000000000001';
  if public.claim_calendar_feed_fetch(repeat('a', 64), 120, 3600)->>'status' <> 'not_found' then raise exception 'PROBE P3 FAILED access off'; end if;
  update accounts set client_access_enabled = true, status = 'archived' where id = 'aaaaaaaa-0000-4000-8000-000000000001';
  if public.claim_calendar_feed_fetch(repeat('a', 64), 120, 3600)->>'status' <> 'not_found' then raise exception 'PROBE P3 FAILED archived'; end if;
  update accounts set status = 'paused' where id = 'aaaaaaaa-0000-4000-8000-000000000001';
  if public.claim_calendar_feed_fetch(repeat('a', 64), 120, 3600)->>'status' <> 'ok' then raise exception 'PROBE P3 FAILED paused must serve'; end if;
  update accounts set status = 'active' where id = 'aaaaaaaa-0000-4000-8000-000000000001';
  raise notice 'PROBE P3 ok';
end $$;

do $$ declare r jsonb; begin  -- P4 hourly limit and its argument guard
  update calendar_feeds set fetch_window_started_at = now(), fetch_count = 119 where id = 'cccccccc-0000-4000-8000-000000000002';
  if public.claim_calendar_feed_fetch(repeat('b', 64), 120, 3600)->>'status' <> 'ok' then raise exception 'PROBE P4 FAILED 120th'; end if;
  r := public.claim_calendar_feed_fetch(repeat('b', 64), 120, 3600);
  if r->>'status' <> 'rate_limited' or (r->>'retry_after_seconds')::int < 1 then raise exception 'PROBE P4 FAILED 121st: %', r; end if;
  update calendar_feeds set fetch_window_started_at = now() - interval '2 hours' where id = 'cccccccc-0000-4000-8000-000000000002';
  if public.claim_calendar_feed_fetch(repeat('b', 64), 120, 3600)->>'status' <> 'ok' then raise exception 'PROBE P4 FAILED new window'; end if;
  begin perform public.claim_calendar_feed_fetch(repeat('b', 64), 0, 3600); raise exception 'PROBE P4 FAILED p_max 0 ran';
  exception when sqlstate '22023' then null; end;
  raise notice 'PROBE P4 ok';
end $$;

do $$ begin  -- P5 one live link per person; the composite FK refuses a non-member and another account's member
  begin insert into calendar_feeds (id, account_id, user_id, token_hash, created_by) values
    (gen_random_uuid(), 'aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001', repeat('e', 64), 'x');
    raise exception 'PROBE P5 FAILED second live row';
  exception when unique_violation then null; end;
  begin insert into calendar_feeds (id, account_id, user_id, token_hash, created_by) values
    (gen_random_uuid(), 'aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000003', repeat('f', 64), 'x');
    raise exception 'PROBE P5 FAILED cross-account member';
  exception when foreign_key_violation then null; end;
  raise notice 'PROBE P5 ok';
end $$;

do $$ declare r jsonb; v text; begin  -- P6 replace, then Undo; a late or forged Undo changes nothing
  r := public.replace_calendar_feed('aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001',
    'cccccccc-0000-4000-8000-0000000000a1', repeat('1', 64), 'user_cf_owner');
  if r->>'status' <> 'ok' or r->>'previous_id' <> 'cccccccc-0000-4000-8000-000000000001' then raise exception 'PROBE P6 FAILED replace: %', r; end if;
  if public.claim_calendar_feed_fetch(repeat('a', 64), 120, 3600)->>'status' <> 'not_found' then raise exception 'PROBE P6 FAILED old still open'; end if;
  -- forged: account B's person cannot restore A's row
  v := public.restore_calendar_feed('aaaaaaaa-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000003',
    'cccccccc-0000-4000-8000-000000000001', (r->>'revoked_at')::timestamptz, 'cccccccc-0000-4000-8000-0000000000a1', 30);
  if v <> 'changed' then raise exception 'PROBE P6 FAILED forged restore: %', v; end if;
  v := public.restore_calendar_feed('aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001',
    'cccccccc-0000-4000-8000-000000000001', (r->>'revoked_at')::timestamptz, 'cccccccc-0000-4000-8000-0000000000a1', 30);
  if v <> 'restored' or public.claim_calendar_feed_fetch(repeat('a', 64), 120, 3600)->>'status' <> 'ok'
     or exists (select 1 from calendar_feeds where id = 'cccccccc-0000-4000-8000-0000000000a1') then raise exception 'PROBE P6 FAILED restore: %', v; end if;
  update calendar_feeds set revoked_at = now() - interval '1 minute' where id = 'cccccccc-0000-4000-8000-000000000001';
  v := public.restore_calendar_feed('aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001',
    'cccccccc-0000-4000-8000-000000000001', (select revoked_at from calendar_feeds where id = 'cccccccc-0000-4000-8000-000000000001'), null, 30);
  if v <> 'changed' then raise exception 'PROBE P6 FAILED late undo: %', v; end if;
  if public.replace_calendar_feed('aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001',
       gen_random_uuid(), repeat('2', 64), 'x')->>'status' <> 'none' then raise exception 'PROBE P6 FAILED replace with nothing live'; end if;
  raise notice 'PROBE P6 ok';
end $$;

do $$ declare r jsonb; v text; begin  -- P6b turn off on the database clock; a SAME-ACCOUNT member cannot restore someone else's link (review I1)
  insert into calendar_feeds (id, account_id, user_id, token_hash, created_by) values
    ('cccccccc-0000-4000-8000-0000000000b1', 'aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001', repeat('3', 64), 'user_cf_owner');
  r := public.revoke_calendar_feed('aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001');
  if r->>'status' <> 'ok' or r->>'feed_id' <> 'cccccccc-0000-4000-8000-0000000000b1'
     or (r->>'revoked_at')::timestamptz <> now() then raise exception 'PROBE P6b FAILED revoke: %', r; end if;
  v := public.restore_calendar_feed('aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000004',
    'cccccccc-0000-4000-8000-0000000000b1', (r->>'revoked_at')::timestamptz, null, 30);
  if v <> 'changed' or (select revoked_at from calendar_feeds where id = 'cccccccc-0000-4000-8000-0000000000b1') is null
  then raise exception 'PROBE P6b FAILED same-account forged restore: %', v; end if;
  v := public.restore_calendar_feed('aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001',
    'cccccccc-0000-4000-8000-0000000000b1', (r->>'revoked_at')::timestamptz, null, 30);
  if v <> 'restored' then raise exception 'PROBE P6b FAILED owner restore: %', v; end if;
  if public.revoke_calendar_feed('aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000004')->>'status' <> 'none'
  then raise exception 'PROBE P6b FAILED revoke with nothing live'; end if;
  raise notice 'PROBE P6b ok';
end $$;

do $$ begin  -- P7 leaving the team takes every link with it
  delete from memberships where account_id = 'aaaaaaaa-0000-4000-8000-000000000001' and user_id = 'bbbbbbbb-0000-4000-8000-000000000002';
  if exists (select 1 from calendar_feeds where user_id = 'bbbbbbbb-0000-4000-8000-000000000002') then raise exception 'PROBE P7 FAILED cascade'; end if;
  raise notice 'PROBE P7 ok';
end $$;

-- P8 PG17 plans (read by eye; expected index names in the report). Every value is a LITERAL: a volatile
-- call such as gen_random_uuid() is never an index condition, and PG17.6 then shows a seq scan whatever the
-- indexes (review I2, measured at 200k rows). enable_seqscan off makes the probe answer "CAN this index serve
-- the query", which is the question on a fixture this small; a seq scan in the output is a FAILED probe.
set local enable_seqscan = off;
explain (costs off) select * from calendar_feeds where token_hash = repeat('a', 64) and revoked_at is null;
explain (costs off) delete from calendar_feeds where account_id = 'aaaaaaaa-0000-4000-8000-000000000001' and user_id = 'bbbbbbbb-0000-4000-8000-000000000001';
-- the window, Owner/Staff shape
explain (costs off) select b.id from bookings b join contacts c on c.account_id = b.account_id and c.id = b.contact_id
  where b.account_id = 'aaaaaaaa-0000-4000-8000-000000000001' and b.calendar_id = 'dddddddd-0000-4000-8000-000000000001'
    and b.status in ('booked', 'completed', 'no_show')
    and b.starts_at >= '2026-11-01T00:00:00Z' and b.starts_at < '2027-05-01T00:00:00Z'
  order by b.starts_at limit 1501;
-- the window, Technician shape (PostgREST's contacts!inner filter on assigned_to)
explain (costs off) select b.id from bookings b join contacts c on c.account_id = b.account_id and c.id = b.contact_id
  where b.account_id = 'aaaaaaaa-0000-4000-8000-000000000001' and b.calendar_id = 'dddddddd-0000-4000-8000-000000000001'
    and b.status in ('booked', 'completed', 'no_show')
    and b.starts_at >= '2026-11-01T00:00:00Z' and b.starts_at < '2027-05-01T00:00:00Z'
    and c.assigned_to = 'bbbbbbbb-0000-4000-8000-000000000002'
  order by b.starts_at limit 1501;
rollback;
```

- [ ] **Step 3: Red on `pre`.** Run `sh …/pg17-cf.sh probe pre`, then `cat …/cf-t1/probe-pre.exit …/cf-t1/probe-pre.txt`. Expected: exit `3` (psql's ON_ERROR_STOP code) and `ERROR:  relation "calendar_feeds" does not exist`. Paste both lines into the report.

- [ ] **Step 4: Write `0104_calendar_feeds.sql`.**

```sql
-- 0104_calendar_feeds.sql - the owner's calendar feed (F-048 part 2)
-- (docs/superpowers/specs/2026-10-28-calendar-feed-design.md sections 2 and 3;
--  docs/superpowers/plans/2026-10-28-calendar-feed.md, Task 1)
--
-- WHAT. public.calendar_feeds: one row per private calendar link a person made for one account. The app
-- mints the id, derives the token from it under CALENDAR_FEED_SECRET (HMAC-SHA256, base64url, 43 chars),
-- and stores only sha256(token) (token_hash). One LIVE row per person per account (calendar_feeds_one_live).
-- The composite FK to memberships (account_id, user_id) (0066's memberships_account_user_key) cascades:
-- a person removed from the team, a deleted user and a deleted account take every link with them.
-- Four functions, EXECUTE service_role only, security definer, search_path '':
--   claim_calendar_feed_fetch: under a row lock, re-proves the link on every fetch (not revoked; a CURRENT
--     account membership, whose role it returns; client access on; the account not archived), counts the
--     fetch in a fixed window (p_max per p_window_seconds) and stamps last_fetched_at. Every refusal but the
--     limit is the same not_found.
--   replace_calendar_feed: revokes the live link and inserts its successor in one transaction.
--   restore_calendar_feed: the Undo of a turn-off or a replace, inside p_max_age_seconds, only for the row's
--     own person and only while nothing newer is live.
--   revoke_calendar_feed: turns the person's live link off and answers the DATABASE's now() as its version,
--     the clock restore compares against.
-- WHO READS AND WRITES. Server code only (0053's pattern): RLS on with no policy, every client privilege
-- revoked. The card reads its own person's row through serviceDb() after requireAccountAccess.
--
-- APPLY ORDER: after 0103. CI project (ci-project-setup.yml: push-dry-run, then push), then production
-- (MCP apply_migration, once), then the parity check, then merge. Additive: nothing reads it before the
-- deploy, so the migration goes BEFORE the code.
--
-- Rollback (by hand, in this order; revert the app first):
--   drop function public.revoke_calendar_feed(uuid, uuid);
--   drop function public.restore_calendar_feed(uuid, uuid, uuid, timestamptz, uuid, integer);
--   drop function public.replace_calendar_feed(uuid, uuid, uuid, text, text);
--   drop function public.claim_calendar_feed_fetch(text, integer, integer);
--   drop table public.calendar_feeds;
--
-- ASCII only, no backslash anywhere.

set local lock_timeout = '5s';

create table public.calendar_feeds (
  id uuid primary key,
  account_id uuid not null,
  user_id uuid not null,
  token_hash text not null constraint calendar_feeds_token_hash_key unique
    constraint calendar_feeds_token_hash_check check (char_length(token_hash) = 64 and token_hash !~ '[^0-9a-f]'),
  created_by text not null constraint calendar_feeds_created_by_check check (btrim(created_by) <> ''),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_fetched_at timestamptz,
  fetch_window_started_at timestamptz,
  fetch_count integer not null default 0 constraint calendar_feeds_fetch_count_check check (fetch_count >= 0),
  constraint calendar_feeds_member_fkey foreign key (account_id, user_id)
    references public.memberships (account_id, user_id) on delete cascade
);
create unique index calendar_feeds_one_live on public.calendar_feeds (account_id, user_id) where revoked_at is null;
-- The cascade from memberships looks rows up by (account_id, user_id), revoked ones too; the partial index
-- above cannot serve it, and production (PG17) has no skip scan.
create index calendar_feeds_by_member on public.calendar_feeds (account_id, user_id);
comment on table public.calendar_feeds is
  'A person''s private calendar link for one account (0104). Reached by /cal/<token>.ics; only sha256(token) '
  'is stored. Server-written and server-read only.';

alter table public.calendar_feeds enable row level security;
revoke all on public.calendar_feeds from anon, authenticated;
grant select, insert, update, delete on public.calendar_feeds to service_role;

create function public.claim_calendar_feed_fetch(p_token_hash text, p_max integer, p_window_seconds integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_feed public.calendar_feeds%rowtype; v_role text; v_open boolean; v_language text; v_fresh boolean;
begin
  if p_token_hash is null or p_max is null or p_window_seconds is null then
    raise exception 'claim_calendar_feed_fetch: a required argument is null' using errcode = '22004';
  end if;
  if p_max < 1 or p_window_seconds < 1 then
    raise exception 'claim_calendar_feed_fetch: every limit must be at least 1' using errcode = '22023';
  end if;
  select * into v_feed from public.calendar_feeds
   where token_hash = p_token_hash and revoked_at is null
     for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  select m.role into v_role from public.memberships m
   where m.scope = 'account' and m.account_id = v_feed.account_id and m.user_id = v_feed.user_id;
  -- coalesce: a NULL role (no membership) must refuse, never fall through (the plpgsql NULL-guard lesson).
  if not coalesce(v_role in ('owner', 'staff', 'technician'), false) then
    return jsonb_build_object('status', 'not_found');
  end if;
  select coalesce(a.client_access_enabled, false) and a.status <> 'archived' into v_open
    from public.accounts a where a.id = v_feed.account_id;
  if not coalesce(v_open, false) then return jsonb_build_object('status', 'not_found'); end if;
  v_fresh := v_feed.fetch_window_started_at is null
    or v_feed.fetch_window_started_at <= now() - make_interval(secs => p_window_seconds);
  if not v_fresh and v_feed.fetch_count >= p_max then
    return jsonb_build_object('status', 'rate_limited', 'retry_after_seconds',
      greatest(1, ceil(extract(epoch from
        (v_feed.fetch_window_started_at + make_interval(secs => p_window_seconds) - now())))::integer));
  end if;
  update public.calendar_feeds
     set last_fetched_at = now(),
         fetch_window_started_at = case when v_fresh then now() else fetch_window_started_at end,
         fetch_count = case when v_fresh then 1 else fetch_count + 1 end
   where id = v_feed.id;
  select u.language into v_language from public.users u where u.id = v_feed.user_id;
  return jsonb_build_object('status', 'ok', 'feed_id', v_feed.id, 'account_id', v_feed.account_id,
    'user_id', v_feed.user_id, 'role', v_role, 'user_language', v_language);
end $$;

create function public.replace_calendar_feed(
  p_account_id uuid, p_user_id uuid, p_new_id uuid, p_new_hash text, p_created_by text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_old uuid; v_revoked timestamptz;
begin
  if p_account_id is null or p_user_id is null or p_new_id is null or p_new_hash is null or p_created_by is null then
    raise exception 'replace_calendar_feed: a required argument is null' using errcode = '22004';
  end if;
  update public.calendar_feeds set revoked_at = now()
   where account_id = p_account_id and user_id = p_user_id and revoked_at is null
   returning id, revoked_at into v_old, v_revoked;
  if not found then return jsonb_build_object('status', 'none'); end if;
  insert into public.calendar_feeds (id, account_id, user_id, token_hash, created_by)
  values (p_new_id, p_account_id, p_user_id, p_new_hash, p_created_by);
  return jsonb_build_object('status', 'ok', 'previous_id', v_old, 'revoked_at', v_revoked);
end $$;

create function public.restore_calendar_feed(
  p_account_id uuid, p_user_id uuid, p_feed_id uuid, p_revoked_at timestamptz, p_replacement_id uuid,
  p_max_age_seconds integer)
returns text language plpgsql security definer set search_path = '' as $$
declare v_hit uuid;
begin
  if p_account_id is null or p_user_id is null or p_feed_id is null or p_revoked_at is null or p_max_age_seconds is null then
    raise exception 'restore_calendar_feed: a required argument is null' using errcode = '22004';
  end if;
  if p_max_age_seconds < 1 then
    raise exception 'restore_calendar_feed: the window must be at least 1 second' using errcode = '22023';
  end if;
  -- The old row first, so a refusal below has written nothing.
  select id into v_hit from public.calendar_feeds
   where account_id = p_account_id and user_id = p_user_id and id = p_feed_id
     and revoked_at = p_revoked_at and revoked_at > now() - make_interval(secs => p_max_age_seconds)
     for update;
  if v_hit is null then return 'changed'; end if;
  if p_replacement_id is null then
    perform 1 from public.calendar_feeds where account_id = p_account_id and user_id = p_user_id and revoked_at is null;
    if found then return 'changed'; end if;
  else
    delete from public.calendar_feeds
     where account_id = p_account_id and user_id = p_user_id and id = p_replacement_id and revoked_at is null;
    if not found then return 'changed'; end if;
  end if;
  update public.calendar_feeds set revoked_at = null where id = p_feed_id;
  return 'restored';
end $$;

create function public.revoke_calendar_feed(p_account_id uuid, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_revoked timestamptz;
begin
  if p_account_id is null or p_user_id is null then
    raise exception 'revoke_calendar_feed: a required argument is null' using errcode = '22004';
  end if;
  update public.calendar_feeds set revoked_at = now()
   where account_id = p_account_id and user_id = p_user_id and revoked_at is null
   returning id, revoked_at into v_id, v_revoked;
  if not found then return jsonb_build_object('status', 'none'); end if;
  return jsonb_build_object('status', 'ok', 'feed_id', v_id, 'revoked_at', v_revoked);
end $$;

revoke all on function public.revoke_calendar_feed(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.claim_calendar_feed_fetch(text, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.replace_calendar_feed(uuid, uuid, uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.restore_calendar_feed(uuid, uuid, uuid, timestamptz, uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.claim_calendar_feed_fetch(text, integer, integer) to service_role;
grant execute on function public.replace_calendar_feed(uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.restore_calendar_feed(uuid, uuid, uuid, timestamptz, uuid, integer) to service_role;
grant execute on function public.revoke_calendar_feed(uuid, uuid) to service_role;
```

- [ ] **Step 5: Green on `post`.** Run `sh …/pg17-cf.sh post` and then `sh …/pg17-cf.sh probe post`. Expected: `probe-post.exit` is `0`, `probe-post.txt` holds `PROBE P1 ok` through `PROBE P7 ok` (with `PROBE P6b ok`), and P8 names `calendar_feeds_token_hash_key` for the lookup and `calendar_feeds_by_member` for the delete, and shows an index plan with no `Seq Scan` for both window shapes. On the tiny fixture with `enable_seqscan` off both shapes read `bookings_by_calendar`; on SEEDED data (200,000 bookings, planner left free) the Technician shape correctly prefers `contacts_account_assigned` (0068) + `bookings_account_contact` instead; paste whichever each shows. A `Seq Scan` on any of the five is a failure: report it rather than adding an index.

- [ ] **Step 6: Add `"calendar_feeds"` to `ACCOUNT_OWNED_TABLES`** (`account-teardown.ts`, directly after `"jobs",` at :24, with the comment `// F-048 part 2 (0104): calendar links (cascade with their membership too).`). It must come before `"calls", "bookings"` and must not displace the first two entries, which `jobs-schema.test.ts:434` pins.

- [ ] **Step 7: Write `calendar-feeds-schema.test.ts`** (live, CI only). Use `withRollback` and `actAs` from `./db` (`db.ts:4`, `:22`) and seed the way `jobs-schema.test.ts:46-51` does. The cases mirror P1–P7 and P6b, each in a separate `it`, plus `case 8: calendar_feeds is on ACCOUNT_OWNED_TABLES (probe: remove "calendar_feeds" -> FAILS)`. Also add one positive control: as `authenticated` with a member's claims (`actAsMember`, `db.ts:33`), `select * from calendar_feeds` raises 42501. Do NOT run this file locally.

- [ ] **Step 8: Commit.** `git add packages/db/supabase/migrations/0104_calendar_feeds.sql packages/db/src/test/calendar-feeds-schema.test.ts packages/db/src/account-teardown.ts && git commit -m "feat(db): calendar_feeds and its four functions, one private calendar link per person (F-048 part 2, migration 0104)"`

**Local tests to run:** only the replica (`pg17-cf.sh probe pre` must FAIL; `probe post` must PASS). There is NO local vitest for T1.

**Mutation probes (reviewer, on the replica: edit a COPY of 0104 in `cf-t1/`, rebuild `post` from it with a modified `post` line, run `probe post`, restore):**

| # | Change | Turns red | Why it can fail |
|---|---|---|---|
| M1 | Drop `and revoked_at is null` from the claim's `select … into v_feed` | `PROBE P3 FAILED revoked` | The revoked row is then found and the claim answers ok. |
| M2 | Drop `on delete cascade` from `calendar_feeds_member_fkey` in the copy | P7: psql stops at P7's `delete from memberships` with `violates foreign key constraint "calendar_feeds_member_fkey"` (exit 3) | The FK then refuses the delete. The obvious mutation (`coalesce(v_role in (…), false)` → `true`) CANNOT fail: while the FK cascades, no row can exist without its membership, so no claim ever sees a NULL role. That check is defence in depth, and the cascade is the control this probe tests. |
| M3 | `fetch_count >= p_max` → `fetch_count > p_max` | `PROBE P4 FAILED 121st` | At count 120 the `>` lets the 121st through. |
| M4 | Remove `and a.status <> 'archived'` | `PROBE P3 FAILED archived` | The archived account then serves. |
| M5 | Remove `and user_id = p_user_id` from restore's first select | `PROBE P6b FAILED same-account forged restore` | A's staff member (no link of their own) then finds the owner's row by account and id, nothing of theirs is live, and the row is restored. P6's account-B case cannot show this: `account_id = p_account_id` already excludes B (review I1). |
| M7 | `revoke_calendar_feed`: `set revoked_at = now()` → `set revoked_at = clock_timestamp()` | `PROBE P6b FAILED revoke` | The answer then differs from the transaction's `now()`. This pins that turn-off writes the database's transaction clock, the value restore compares. |
| M6 | Change the grant to `… to service_role, authenticated` on the claim | `PROBE P1 FAILED: grants` | `has_function_privilege('authenticated', …)` turns true. |

---

### Task 2: The pure builders: ICS feed, feed strings, feed content, feed token

**Tier:** medium · **Owner:** bis-booking · **Wave:** 1

**Files:**
- Modify: `apps/web/src/lib/booking/ics.ts:25-125`
- Modify: `apps/web/src/lib/booking/ics.test.ts` (append `describe` blocks after `:162`)
- Create: `apps/web/src/lib/booking/feed-strings.ts`, `apps/web/src/lib/booking/feed-strings.test.ts`
- Create: `apps/web/src/lib/booking/feed-content.ts`, `apps/web/src/lib/booking/feed-content.test.ts`
- Create: `apps/web/src/lib/booking/feed-token.ts`, `apps/web/src/lib/booking/feed-token.test.ts`

**Interfaces:**
- Consumes: `isTokenShape`, `tokenHash` (`lib/document-requests/token.ts:23-24`); `isPlaceholderName(value: string): boolean` (`lib/voice/tools/placeholders.ts:53`, pure and import-free per its `:11-12`); `Locale` (`lib/i18n/locale.ts:6`).
- Produces:
  - `ics.ts`: `export type FeedEvent = { uid: string; sequence: number; startsAt: Date; endsAt: Date; stampedAt: Date; summary: string; description?: string }`; `export function calendarFeedIcs(input: { name: string; events: readonly FeedEvent[] }): string`
  - `feed-strings.ts`: `export function feedStrings(locale: Locale): FeedStrings`
  - `feed-content.ts`: `export type FeedContentRow = { id: string; status: "booked" | "completed" | "no_show"; starts_at: string; ends_at: string; updated_at: string; created_at: string; first_name: string | null; rootId: string; depth: number }`; `export type MeetingKind = "in_person" | "phone" | "video"`; `export function feedFirstName(raw: string | null, locale: Locale): string`; `export function feedEvents(rows: readonly FeedContentRow[], o: FeedOptions): FeedEvent[]`; `export function feedIcsFor(o: FeedOptions & { brandName: string; rows: readonly FeedContentRow[] }): string`, with `FeedOptions = { locale: Locale; meetingType: MeetingKind; origin: string | null; accountId: string }`
  - `feed-token.ts`: `feedSecretConfigured(): boolean`, `feedToken(feedId: string): string` (throws without the secret), `feedTokenHash(token: string): string`, `feedTokenFromFile(file: string): string | null`, `feedUrl(origin: string, token: string): string`, `webcalUrl(url: string): string`

- [ ] **Step 1: Failing tests for the builder.** Append to `ics.test.ts`. It already has `unfold` (`:23`):

```ts
import { calendarFeedIcs, type FeedEvent } from "./ics";

const ev = (over: Partial<FeedEvent> = {}): FeedEvent => ({
  uid: "root-1@bookings.bis-rgv.com", sequence: 0,
  startsAt: new Date("2026-11-03T15:00:00Z"), endsAt: new Date("2026-11-03T16:00:00Z"),
  stampedAt: new Date("2026-11-01T12:00:00.123Z"), summary: "Appointment: Maria", ...over,
});

describe("calendarFeedIcs — the subscribed feed (F-048 part 2)", () => {
  it("is one VCALENDAR with a NAME and one VEVENT per event, CRLF throughout (mutation: join with \\n → FAILS)", () => {
    const ics = calendarFeedIcs({ name: "Rio Roofing bookings", events: [ev(), ev({ uid: "root-2@bookings.bis-rgv.com" })] });
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    expect(ics.split("BEGIN:VEVENT").length - 1).toBe(2);
    expect(ics.split("END:VEVENT").length - 1).toBe(2);
    expect(unfold(ics)).toEqual(expect.arrayContaining(["NAME:Rio Roofing bookings", "X-WR-CALNAME:Rio Roofing bookings",
      "REFRESH-INTERVAL;VALUE=DURATION:PT15M", "X-PUBLISHED-TTL:PT15M", "METHOD:PUBLISH"]));
  });

  it("drops an event with an inverted or NaN time and keeps the rest (mutation: return null for the whole feed → FAILS)", () => {
    const ics = calendarFeedIcs({ name: "x", events: [ev({ endsAt: new Date("2026-11-03T14:00:00Z") }), ev({ startsAt: new Date(NaN) }), ev({ uid: "ok@bookings.bis-rgv.com" })] });
    expect(ics.split("BEGIN:VEVENT").length - 1).toBe(1);
    expect(ics).toContain("UID:ok@bookings.bis-rgv.com");
  });

  it("escapes a hostile first name and calendar name so neither can add a property (mutation: drop the LF escape → FAILS)", () => {
    const ics = calendarFeedIcs({ name: "A;B,C\\D\r\nORGANIZER:x", events: [ev({ summary: "Cita: Ñ;o,ñ\\\nATTENDEE:mailto:a@b.co" })] });
    const lines = unfold(ics);
    expect(lines.some((l) => l.startsWith("ORGANIZER") || l.startsWith("ATTENDEE"))).toBe(false);
    expect(lines).toContain("NAME:A\\;B\\,C\\\\D\\nORGANIZER:x");
  });

  it("keeps every physical line of a 1,800-event feed at or under 75 octets and the whole under 1 MB (mutation: skip fold on the feed path → FAILS)", () => {
    const name = "Ñ".repeat(40);
    const events = Array.from({ length: 1800 }, (_, i) => ev({ uid: `${String(i).padStart(36, "0")}@bookings.bis-rgv.com`, summary: `Videollamada: ${name}`, description: `Ver en BIS: https://app.bis-rgv.com/dashboard/accounts/${"a".repeat(36)}/calendar` }));
    const ics = calendarFeedIcs({ name: `Citas de ${name}`, events });
    for (const line of ics.split("\r\n")) expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
    expect(Buffer.byteLength(ics, "utf8")).toBeLessThan(1_000_000);
  });
});
```

- [ ] **Step 2: Run it red.** `pnpm --filter web exec vitest run src/lib/booking/ics.test.ts`. Expected: the four new tests fail with `calendarFeedIcs is not a function` (or the import's SyntaxError), and the existing `bookingIcs` tests pass. Paste the failing line.

- [ ] **Step 3: Split the builder.** In `ics.ts`, add after `BookingIcsInput` (`:36`):

```ts
/** F-048 part 2: one event in the owner's subscribed feed. Same time and text rules as the file above. */
export type FeedEvent = {
  uid: string;
  sequence: number;
  startsAt: Date;
  endsAt: Date;
  /** DTSTAMP: the booking row's updated_at, so the same data gives the same bytes (the route's ETag). */
  stampedAt: Date;
  summary: string;
  description?: string;
};

const FEED_PRODID = "-//BIS//Booking feed//EN";
```

Replace `bookingIcs` (`:98-125`) with a shared event writer and the two callers. The property order of `bookingIcs` is UNCHANGED:

```ts
/** One VEVENT's lines, or null when the event is invalid (fails CLOSED). */
function eventLines(e: FeedEvent & { url?: string }): string[] | null {
  if (!valid(e.startsAt) || !valid(e.endsAt) || !valid(e.stampedAt)) return null;
  if (e.endsAt.getTime() <= e.startsAt.getTime()) return null;
  if (!Number.isInteger(e.sequence) || e.sequence < 0) return null;
  if (!e.uid || /[\r\n]/.test(e.uid)) return null;
  const url = e.url ? uri(e.url) : null;
  return [
    "BEGIN:VEVENT",
    `UID:${e.uid}`,
    `SEQUENCE:${e.sequence}`,
    `DTSTAMP:${utcStamp(e.stampedAt)}`,
    `DTSTART:${utcStamp(e.startsAt)}`,
    `DTEND:${utcStamp(e.endsAt)}`,
    `SUMMARY:${text(e.summary)}`,
    ...(e.description ? [`DESCRIPTION:${text(e.description)}`] : []),
    ...(url ? [`URL:${url}`] : []),
    "STATUS:CONFIRMED",
    "END:VEVENT",
  ];
}

export function bookingIcs(input: BookingIcsInput): string | null {
  const event = eventLines(input);
  if (!event) return null;
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:${PRODID}`, "CALSCALE:GREGORIAN", "METHOD:PUBLISH", ...event, "END:VCALENDAR"];
  return lines.map(fold).join("\r\n") + "\r\n";
}

/**
 * F-048 part 2: the subscribed feed. NAME (RFC 7986) and X-WR-CALNAME name it in the person's language;
 * REFRESH-INTERVAL and X-PUBLISHED-TTL are hints (ASSUMPTION: honoured by some apps, binding on none).
 * An invalid event is left out; it never sinks the feed. No VTIMEZONE: every time is UTC (header above).
 */
export function calendarFeedIcs(input: { name: string; events: readonly FeedEvent[] }): string {
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:${FEED_PRODID}`, "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    `NAME:${text(input.name)}`, `X-WR-CALNAME:${text(input.name)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT15M", "X-PUBLISHED-TTL:PT15M",
  ];
  for (const e of input.events) {
    const v = eventLines(e);
    if (v) lines.push(...v);
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
```

`BookingIcsInput` is structurally `FeedEvent & { url?: string }`, so `eventLines(input)` type-checks.

- [ ] **Step 4: Run green.** The same command. Expected: every test in `ics.test.ts` passes, the old `bookingIcs` blocks included and unedited. Paste the summary line.

- [ ] **Step 5: Failing tests for strings, content and token.** `feed-strings.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { feedStrings } from "./feed-strings";

const INTERNAL_MILESTONE = /\bM\d[a-z]?\b/;
describe("feedStrings", () => {
  it("carries the same keys in both languages, none empty, no milestone code, template syntax or arrow (mutation: add 'F-048' → FAILS)", () => {
    const en = feedStrings("en"), es = feedStrings("es");
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
    for (const s of [en, es]) for (const [k, v] of Object.entries(s)) {
      expect(v.trim(), k).not.toBe("");
      expect(v, k).not.toMatch(INTERNAL_MILESTONE);
      expect(v, k).not.toMatch(/F-\d{3}|\{\{|→|←|↑|↓/);
    }
  });
  it("is Spanish for es and English for en", () => {
    expect(feedStrings("es").kind_in_person).toBe("Cita");
    expect(feedStrings("en").kind_in_person).toBe("Appointment");
  });
});
```

`feed-content.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { feedFirstName, feedEvents, feedIcsFor, type FeedContentRow } from "./feed-content";
import { bookingUid } from "./ics";

const row = (over: Partial<FeedContentRow> = {}): FeedContentRow => ({
  id: "b-1", status: "booked", starts_at: "2026-11-03T15:00:00Z", ends_at: "2026-11-03T16:00:00Z",
  updated_at: "2026-11-01T12:00:00Z", created_at: "2026-11-01T12:00:00Z", first_name: "Maria Lopez",
  rootId: "root-1", depth: 0, ...over,
});
const O = { locale: "en" as const, meetingType: "in_person" as const, origin: "https://app.bis-rgv.com", accountId: "acc-1" };
beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });

describe("feedFirstName — first name only", () => {
  it.each([
    ["Maria Lopez", "Maria"], ["  José  Ángel ", "José"], ["956-555-0100", "Customer"], ["a@b.co", "Customer"],
    ["", "Customer"], [null, "Customer"], ["Unknown", "Customer"], ["Desconocido", "Customer"],
  ])("%s → %s (mutation: return raw.trim() → FAILS)", (raw, want) => {
    expect(feedFirstName(raw as string | null, "en")).toBe(want);
  });
  it("is Cliente in Spanish and never longer than 40 characters", () => {
    expect(feedFirstName(null, "es")).toBe("Cliente");
    expect(Array.from(feedFirstName("Ñ".repeat(60), "en"))).toHaveLength(40);
  });
});

describe("feedEvents", () => {
  it("one event per appointment: UID from the chain's root, SEQUENCE its depth, DTSTAMP the row's updated_at (mutation: uid from row.id → FAILS)", () => {
    const [e] = feedEvents([row({ id: "b-3", rootId: "root-1", depth: 2 })], O);
    expect(e!.uid).toBe(bookingUid("root-1"));
    expect(e!.sequence).toBe(2);
    expect(e!.stampedAt.toISOString()).toBe("2026-11-01T12:00:00.000Z");
  });
  it("two live rows of one chain become ONE event, the deeper row (mutation: drop the dedupe → FAILS)", () => {
    const events = feedEvents([row({ id: "b-1", depth: 0, starts_at: "2026-11-03T15:00:00Z" }), row({ id: "b-2", depth: 1, starts_at: "2026-11-04T15:00:00Z", ends_at: "2026-11-04T16:00:00Z" })], O);
    expect(events).toHaveLength(1);
    expect(events[0]!.startsAt.toISOString()).toBe("2026-11-04T15:00:00.000Z");
  });
  it("names the kind from the meeting type and marks a no-show", () => {
    expect(feedEvents([row()], { ...O, meetingType: "phone" })[0]!.summary).toBe("Phone call: Maria");
    expect(feedEvents([row({ status: "no_show" })], { ...O, locale: "es" })[0]!.summary).toBe("No se presentó · Cita: Maria");
  });
  it("a name holding $& is printed as typed, never expanded by String.replace (mutation: replace with a string, not a function → FAILS)", () => {
    expect(feedEvents([row({ first_name: "$&x" })], O)[0]!.summary).toBe("Appointment: $&x");
  });
});

describe("feedIcsFor — data minimisation and language", () => {
  it("carries nothing but the time, the kind, the first name and the dashboard link (mutation: put the last name in SUMMARY → FAILS)", () => {
    const ics = feedIcsFor({ ...O, brandName: "Rio Roofing", rows: [row({ first_name: "Maria Lopez" })] });
    expect(ics).not.toMatch(/Lopez|ORGANIZER|ATTENDEE|LOCATION|URL:/);
    expect(ics).toContain("SUMMARY:Appointment: Maria");
    expect(ics).toContain("DESCRIPTION:Open in BIS: https://app.bis-rgv.com/dashboard/accounts/acc-1/calendar");
    expect(ics).toContain("NAME:Rio Roofing bookings");
  });
  it("is Spanish end to end for es, and names the calendar Citas with no brand", () => {
    const ics = feedIcsFor({ ...O, locale: "es", brandName: "", rows: [row()] });
    expect(ics).toContain("NAME:Citas\r\n");
    expect(ics).toContain("SUMMARY:Cita: Maria");
    expect(ics).toContain("DESCRIPTION:Ver en BIS:");
    expect(ics).not.toMatch(/Appointment|Open in BIS|bookings/);
  });
});
```

`feed-token.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from "vitest";
import { createHash } from "node:crypto";
import { feedToken, feedTokenHash, feedTokenFromFile, feedUrl, webcalUrl, feedSecretConfigured } from "./feed-token";

const ID = "cccccccc-0000-4000-8000-000000000001";
afterEach(() => vi.unstubAllEnvs());

describe("feed-token", () => {
  it("derives a 43-character base64url token from the row id under the secret, stable and id-specific (mutation: drop the id from the HMAC input → FAILS)", () => {
    vi.stubEnv("CALENDAR_FEED_SECRET", "s".repeat(32));
    const a = feedToken(ID);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(feedToken(ID)).toBe(a);
    expect(feedToken(ID.toUpperCase())).toBe(a);
    expect(feedToken("cccccccc-0000-4000-8000-000000000002")).not.toBe(a);
  });
  it("a different secret gives a different token (mutation: ignore the secret → FAILS)", () => {
    vi.stubEnv("CALENDAR_FEED_SECRET", "s".repeat(32)); const a = feedToken(ID);
    vi.stubEnv("CALENDAR_FEED_SECRET", "t".repeat(32)); expect(feedToken(ID)).not.toBe(a);
  });
  it("refuses a missing or short secret, and says so without the value (mutation: fall back to a constant → FAILS)", () => {
    vi.stubEnv("CALENDAR_FEED_SECRET", "short");
    expect(feedSecretConfigured()).toBe(false);
    expect(() => feedToken(ID)).toThrow("CALENDAR_FEED_SECRET is required (at least 32 characters)");
  });
  it("hashes to sha256 hex, and the hash of a token one character off differs", () => {
    const t = "A".repeat(43);
    expect(feedTokenHash(t)).toBe(createHash("sha256").update(t).digest("hex"));
    expect(feedTokenHash("B" + t.slice(1))).not.toBe(feedTokenHash(t));
  });
  it.each([["A".repeat(43) + ".ics", "A".repeat(43)], ["A".repeat(43), null], ["A".repeat(42) + ".ics", null], ["A".repeat(43) + ".ICS", null], ["../" + "A".repeat(40) + ".ics", null]])(
    "feedTokenFromFile(%s) → %s (mutation: drop the suffix check → FAILS)", (file, want) => { expect(feedTokenFromFile(file)).toBe(want); });
  it("builds the https and webcal links", () => {
    const u = feedUrl("https://app.bis-rgv.com/", "T".repeat(43));
    expect(u).toBe(`https://app.bis-rgv.com/cal/${"T".repeat(43)}.ics`);
    expect(webcalUrl(u)).toBe(`webcal://app.bis-rgv.com/cal/${"T".repeat(43)}.ics`);
  });
});
```

- [ ] **Step 6: Run red.** `pnpm --filter web exec vitest run src/lib/booking/feed-strings.test.ts src/lib/booking/feed-content.test.ts src/lib/booking/feed-token.test.ts`. Expected: all three files fail to import (`Failed to resolve import "./feed-strings"` and the like). Paste one line per file.

- [ ] **Step 7: Implement.** `feed-strings.ts`:

```ts
import type { Locale } from "@/lib/i18n/locale";

/** F-048 part 2: every word inside the owner's subscribed feed. One feed is in one language, end to end. */
const EN = {
  calendarName: "{business} bookings",
  calendarNameNoBrand: "Bookings",
  kind_in_person: "Appointment",
  kind_phone: "Phone call",
  kind_video: "Video call",
  summary: "{kind}: {name}",
  noShow: "No-show",
  customer: "Customer",
  openIn: "Open in BIS: {url}",
};
export type FeedStrings = typeof EN;
const ES: FeedStrings = {
  calendarName: "Citas de {business}",
  calendarNameNoBrand: "Citas",
  kind_in_person: "Cita",
  kind_phone: "Llamada",
  kind_video: "Videollamada",
  summary: "{kind}: {name}",
  noShow: "No se presentó",
  customer: "Cliente",
  openIn: "Ver en BIS: {url}",
};
export function feedStrings(locale: Locale): FeedStrings {
  return locale === "es" ? ES : EN;
}
```

`feed-content.ts`:

```ts
import type { Locale } from "@/lib/i18n/locale";
import { isPlaceholderName } from "@/lib/voice/tools/placeholders";
import { bookingUid, calendarFeedIcs, type FeedEvent } from "./ics";
import { feedStrings } from "./feed-strings";

/**
 * F-048 part 2: bookings → the owner's feed. Pure; `calendar-feed.ts` does every read. A customer is a
 * FIRST NAME only (spec 4.3): never a last name, phone, email, note, meeting link (D3) or address.
 */
export type FeedContentRow = {
  id: string; status: "booked" | "completed" | "no_show";
  starts_at: string; ends_at: string; updated_at: string; created_at: string;
  first_name: string | null;
  /** `rescheduleRoots`' answer for this row. */
  rootId: string; depth: number;
};
export type MeetingKind = "in_person" | "phone" | "video";
export type FeedOptions = { locale: Locale; meetingType: MeetingKind; origin: string | null; accountId: string };

const NAME_MAX = 40;

export function feedFirstName(raw: string | null, locale: Locale): string {
  const whole = (raw ?? "").trim();
  const word = whole.split(/\s+/)[0] ?? "";
  if (!word || /[0-9@]/.test(word) || isPlaceholderName(whole) || isPlaceholderName(word)) return feedStrings(locale).customer;
  return Array.from(word).slice(0, NAME_MAX).join("");
}

const deeper = (a: FeedContentRow, b: FeedContentRow) => (a.depth !== b.depth ? a.depth > b.depth : a.created_at > b.created_at);

export function feedEvents(rows: readonly FeedContentRow[], o: FeedOptions): FeedEvent[] {
  const s = feedStrings(o.locale);
  const kind = s[`kind_${o.meetingType}`];
  const description = o.origin
    ? s.openIn.replace("{url}", () => `${o.origin}/dashboard/accounts/${o.accountId}/calendar`)
    : undefined;
  const byUid = new Map<string, { row: FeedContentRow; event: FeedEvent }>();
  for (const row of rows) {
    const name = feedFirstName(row.first_name, o.locale);
    const base = s.summary.replace("{kind}", () => kind).replace("{name}", () => name);
    const event: FeedEvent = {
      uid: bookingUid(row.rootId), sequence: row.depth,
      startsAt: new Date(row.starts_at), endsAt: new Date(row.ends_at), stampedAt: new Date(row.updated_at),
      summary: row.status === "no_show" ? `${s.noShow} · ${base}` : base,
      ...(description ? { description } : {}),
    };
    const prior = byUid.get(event.uid);
    if (prior) {
      const keep = deeper(row, prior.row) ? row : prior.row;
      console.error(`calendar feed: two live rows for one appointment (${prior.row.id}, ${row.id}); kept ${keep.id}`);
      if (keep === prior.row) continue;
    }
    byUid.set(event.uid, { row, event });
  }
  return [...byUid.values()].map((v) => v.event).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

export function feedIcsFor(o: FeedOptions & { brandName: string; rows: readonly FeedContentRow[] }): string {
  const s = feedStrings(o.locale);
  const name = o.brandName ? s.calendarName.replace("{business}", () => o.brandName) : s.calendarNameNoBrand;
  return calendarFeedIcs({ name, events: feedEvents(o.rows, o) });
}
```

`feed-token.ts`:

```ts
import { createHash, createHmac } from "node:crypto";
import { isTokenShape, tokenHash } from "@/lib/document-requests/token";

/**
 * F-048 part 2: a person's calendar link. 32 bytes, base64url, 43 characters (requestToken's shape, so
 * isTokenShape and tokenHash serve both), DERIVED from the calendar_feeds row id under
 * CALENDAR_FEED_SECRET (owner decision D2: its own secret, at least 32 characters, no fallback). The
 * database keeps only sha256(token). Rotating the secret ends no link (the route looks up by hash); it
 * only stops the card showing a link again. Server only (node:crypto). Never logged.
 */
const SUFFIX = ".ics";
const MIN = 32;

function feedKey(): Buffer {
  const secret = process.env.CALENDAR_FEED_SECRET;
  if (!secret || secret.length < MIN) throw new Error("CALENDAR_FEED_SECRET is required (at least 32 characters)");
  return createHash("sha256").update(`bis-calendar-feed:${secret}`).digest();
}
export function feedSecretConfigured(): boolean {
  const s = process.env.CALENDAR_FEED_SECRET;
  return typeof s === "string" && s.length >= MIN;
}
export function feedToken(feedId: string): string {
  return createHmac("sha256", feedKey()).update(`calendar-feed:v1:${feedId.toLowerCase()}`).digest("base64url");
}
export const feedTokenHash = (token: string): string => tokenHash(token);
export function feedTokenFromFile(file: string): string | null {
  if (!file.endsWith(SUFFIX)) return null;
  const token = file.replace(/\.ics$/, "");
  return isTokenShape(token) ? token : null;
}
export const feedUrl = (origin: string, token: string): string => `${origin.replace(/\/+$/, "")}/cal/${token}${SUFFIX}`;
export const webcalUrl = (url: string): string => url.replace(/^https?:\/\//, "webcal://");
```

- [ ] **Step 8: Run green.** Run the Step 6 command again, plus `ics.test.ts`. Expected: all pass. Paste the summary line. Then `pnpm --filter web typecheck`.

- [ ] **Step 9: Commit.** `git add apps/web/src/lib/booking/ics.ts apps/web/src/lib/booking/ics.test.ts apps/web/src/lib/booking/feed-strings.ts apps/web/src/lib/booking/feed-strings.test.ts apps/web/src/lib/booking/feed-content.ts apps/web/src/lib/booking/feed-content.test.ts apps/web/src/lib/booking/feed-token.ts apps/web/src/lib/booking/feed-token.test.ts && git commit -m "feat(booking): the calendar feed's builder, words, content and token, first name only (F-048 part 2)"`

**Local tests to run:** `pnpm --filter web exec vitest run src/lib/booking/ics.test.ts src/lib/booking/feed-strings.test.ts src/lib/booking/feed-content.test.ts src/lib/booking/feed-token.test.ts src/lib/booking/calendar-file.test.ts`. `calendar-file.test.ts` exists and is the customer file's consumer of `bookingIcs`, so it proves the split changed nothing for customers.

**Mutation probes (each must turn the NAMED test red):**

| # | Change (line) | Turns red | Why it can fail |
|---|---|---|---|
| M1 | `calendarFeedIcs`: `lines.map(fold)` → `lines` | `keeps every physical line of a 1,800-event feed at or under 75 octets…` | `X-WR-CALNAME:Citas de ` plus 40 two-byte `Ñ` is 101 octets. `bookingIcs` keeps its own `fold`, so only this test fails. |
| M2 | `eventLines`: remove the `.replace(/\r\n\|\r\|\n/g, "\\n")` from `text()` | `escapes a hostile first name and calendar name…` | The CRLF in the name then starts an `ORGANIZER:` line. The old `bookingIcs` escape test (`:108`) also fails, which is expected; the new test must fail BY NAME too. |
| M3 | `feedEvents`: `uid: bookingUid(row.rootId)` → `bookingUid(row.id)` | `one event per appointment: UID from the chain's root…` | Expects `root-1`; gets `b-3`. |
| M4 | `feedEvents`: replace the `byUid` Map with an array (`out.push({ row, event })`, no `prior` lookup) | `two live rows of one chain become ONE event…` | Length 2. Deleting only the `if (prior)` block CANNOT fail: the Map's `set` still keeps one event per UID (the later row, which here is also the deeper one). |
| M5 | `feedFirstName`: `return Array.from(word)…` → `return whole` | `Maria Lopez → Maria …` | Returns `Maria Lopez`. |
| M6 | `.replace("{name}", () => name)` → `.replace("{name}", name)` | `a name holding $& is printed as typed…` | `$&` expands to `{name}`, giving `Appointment: {name}x`. |
| M7 | `feedToken`: `` `calendar-feed:v1:${feedId.toLowerCase()}` `` → `"calendar-feed:v1:"` | `derives a 43-character base64url token from the row id…` | Two ids then give the same token. |
| M8 | `feedTokenFromFile`: delete `if (!file.endsWith(SUFFIX)) return null;` | `feedTokenFromFile(AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA) → null` | The strip is `file.replace(/\.ics$/, "")`, a no-op on a bare token, so the bare 43 characters then pass the shape check and come back as a token. (With a `slice(0, -4)` strip this probe could not fail, and `SUFFIX = ""` turns a different row red, because `slice(0, -0)` is `""`: review M1.) |

---

### Task 3: The database reads and the wrappers

**Tier:** high · **Owner:** bis-booking · **Wave:** 2

**Files:**
- Create: `packages/db/src/calendar-feeds.ts`
- Modify: `packages/db/src/booking.ts` (append after `rescheduleChain`, `:733`)
- Modify: `packages/db/src/index.ts` (one new `export … from "./calendar-feeds"` block, plus the new names added to a new line after `:113`)
- Create: `packages/db/src/test/feed-bookings-reads.test.ts` (fake client, LOCAL)
- Create: `packages/db/src/test/calendar-feeds.test.ts` (live, CI only)

**Interfaces:**
- Consumes: T1's table and functions (names in Task 1). `RESCHEDULE_CHAIN_MAX` (`booking.ts:708`, module-private, used in place).
- Produces:
  - `calendar-feeds.ts`: `CALENDAR_FEED_FETCH_MAX = 120`, `CALENDAR_FEED_FETCH_WINDOW_SECONDS = 3600`, `CALENDAR_FEED_UNDO_SECONDS = 30`; `type CalendarFeedRow = { id: string; account_id: string; user_id: string; token_hash: string; created_at: string; revoked_at: string | null; last_fetched_at: string | null }`; `readLiveCalendarFeed(db, accountId: string, userId: string): Promise<CalendarFeedRow | null>`; `createCalendarFeed(db, a: { accountId: string; userId: string; id: string; tokenHash: string; createdBy: string }): Promise<"ok" | "exists">`; `revokeCalendarFeed(db, accountId: string, userId: string): Promise<{ feedId: string; revokedAt: string } | null>`; `replaceCalendarFeed(db, a: { accountId: string; userId: string; newId: string; newHash: string; createdBy: string }): Promise<{ status: "ok"; previousId: string; revokedAt: string } | { status: "none" }>`; `restoreCalendarFeed(db, a: { accountId: string; userId: string; feedId: string; revokedAt: string; replacementId: string | null }): Promise<"restored" | "changed">`; `type FeedClaim = { status: "ok"; feedId: string; accountId: string; userId: string; role: AccountRole; userLanguage: "en" | "es" | null } | { status: "not_found" } | { status: "rate_limited"; retryAfterSeconds: number }`; `claimCalendarFeedFetch(db, tokenHash: string): Promise<FeedClaim>`
  - `booking.ts`: `FEED_PAST_DAYS = 30`, `FEED_FUTURE_DAYS = 180`, `FEED_FUTURE_CAP = 1500`, `FEED_PAST_CAP = 300`; `rescheduleRoots(db, accountId: string, rows: readonly { id: string; rescheduled_from_id: string | null }[]): Promise<Map<string, { rootId: string; depth: number }>>`; `type FeedBookingRow` (structurally `FeedContentRow` from T2); `listFeedBookings(db, accountId: string, o: { now: Date; technicianUserId: string | null }): Promise<{ meetingType: "in_person" | "phone" | "video"; rows: FeedBookingRow[]; truncated: boolean }>`

- [ ] **Step 1: Failing fake-client test**, `packages/db/src/test/feed-bookings-reads.test.ts`. Model it on `assignee-reads.test.ts:16-30`, a fake that records every call:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { rescheduleRoots, listFeedBookings, FEED_FUTURE_CAP } from "../booking";

type Call = { table: string; filters: [string, string, unknown][]; cols: string };
/** Answers bookings by id from `byId` (for the chain walk) and the window from `window`. */
function fake(o: { byId?: Record<string, { id: string; rescheduled_from_id: string | null; account_id: string }>; window?: unknown[]; calendar?: unknown }) {
  const calls: Call[] = [];
  const db = {
    from(table: string) {
      const call: Call = { table, filters: [], cols: "" };
      calls.push(call);
      const b: Record<string, unknown> = {};
      const add = (op: string) => (col: string, v: unknown) => { call.filters.push([op, col, v]); return b; };
      Object.assign(b, {
        select: (cols: string) => { call.cols = cols; return b; },
        eq: add("eq"), in: add("in"), gte: add("gte"), lt: add("lt"), order: () => b, limit: () => b,
        maybeSingle: async () => ({ data: o.calendar ?? null, error: null }),
        then: (res: (v: unknown) => unknown) => {
          const ids = call.filters.find((f) => f[0] === "in" && f[1] === "id")?.[2] as string[] | undefined;
          const acct = call.filters.find((f) => f[0] === "eq" && f[1] === "account_id")?.[2];
          const data = ids
            ? ids.map((id) => o.byId?.[id]).filter((r) => r && r.account_id === acct)
            : (o.window ?? []);
          return Promise.resolve({ data, error: null }).then(res);
        },
      });
      return b;
    },
  };
  return { db: db as unknown as SupabaseClient, calls };
}
beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });

describe("rescheduleRoots — one appointment's identity, in batches", () => {
  it("walks a 2-deep chain to its root in 2 queries, not one per row (mutation: query per row → FAILS)", async () => {
    const { db, calls } = fake({ byId: {
      b2: { id: "b2", rescheduled_from_id: "b1", account_id: "A" },
      b1: { id: "b1", rescheduled_from_id: null, account_id: "A" },
    } });
    const roots = await rescheduleRoots(db, "A", [{ id: "b3", rescheduled_from_id: "b2" }, { id: "x", rescheduled_from_id: null }]);
    expect(roots.get("b3")).toEqual({ rootId: "b1", depth: 2 });
    expect(roots.get("x")).toEqual({ rootId: "x", depth: 0 });
    expect(calls.filter((c) => c.table === "bookings")).toHaveLength(2);
  });
  it("never follows a parent outside the account: that row is left out (mutation: drop .eq(account_id) on the hop → FAILS)", async () => {
    const { db, calls } = fake({ byId: { other: { id: "other", rescheduled_from_id: null, account_id: "B" } } });
    const roots = await rescheduleRoots(db, "A", [{ id: "b9", rescheduled_from_id: "other" }]);
    expect(roots.has("b9")).toBe(false);
    expect(calls.every((c) => c.filters.some((f) => f[0] === "eq" && f[1] === "account_id" && f[2] === "A"))).toBe(true);
  });
});

describe("listFeedBookings — the bounded window", () => {
  const CAL = { id: "cal-A", meeting_type: "phone" };
  const raw = (id: string) => ({ id, status: "booked", starts_at: "2026-11-03T15:00:00Z", ends_at: "2026-11-03T16:00:00Z",
    updated_at: "2026-11-01T00:00:00Z", created_at: "2026-11-01T00:00:00Z", rescheduled_from_id: null,
    contacts: { first_name: "Maria", assigned_to: null } });
  it("reads the account's own calendar, the three statuses only, with no cancelled rows (mutation: add 'cancelled' → FAILS)", async () => {
    const { db, calls } = fake({ calendar: CAL, window: [raw("b1")] });
    const r = await listFeedBookings(db, "A", { now: new Date("2026-11-01T00:00:00Z"), technicianUserId: null });
    expect(r.meetingType).toBe("phone");
    expect(r.rows.map((x) => x.id)).toEqual(["b1", "b1"]);   // the fake answers both window queries with the same row
    const windows = calls.filter((c) => c.table === "bookings" && c.cols.includes("contacts!inner"));
    expect(windows).toHaveLength(2);
    for (const w of windows) {
      expect(w.filters).toContainEqual(["eq", "account_id", "A"]);
      expect(w.filters).toContainEqual(["eq", "calendar_id", "cal-A"]);
      expect(w.filters).toContainEqual(["in", "status", ["booked", "completed", "no_show"]]);
      expect(w.filters.some((f) => f[1] === "contacts.assigned_to")).toBe(false);
    }
  });
  it("a Technician's window is fenced to their assigned customers (mutation: ignore technicianUserId → FAILS)", async () => {
    const { db, calls } = fake({ calendar: CAL, window: [] });
    await listFeedBookings(db, "A", { now: new Date(), technicianUserId: "tech-1" });
    const windows = calls.filter((c) => c.table === "bookings" && c.cols.includes("contacts!inner"));
    for (const w of windows) expect(w.filters).toContainEqual(["eq", "contacts.assigned_to", "tech-1"]);
  });
  it("no calendar yet is an empty feed, not an error", async () => {
    const { db } = fake({ calendar: null });
    expect(await listFeedBookings(db, "A", { now: new Date(), technicianUserId: null })).toEqual({ meetingType: "in_person", rows: [], truncated: false });
  });
  it("says truncated past the cap (mutation: drop the +1 probe row → FAILS)", async () => {
    const many = Array.from({ length: FEED_FUTURE_CAP + 1 }, (_, i) => raw(`b${i}`));
    const { db } = fake({ calendar: CAL, window: many });
    expect((await listFeedBookings(db, "A", { now: new Date(), technicianUserId: null })).truncated).toBe(true);
  });
});
```

The `toEqual(["b1","b1"])` line depends on the fake answering both queries. Keep it: it proves the past and upcoming results are concatenated, not that one query's answer replaced the other.

- [ ] **Step 2: Run red.** `pnpm --filter @bis/db exec vitest run src/test/feed-bookings-reads.test.ts`. Expected in vitest's summary block: the file fails with `rescheduleRoots is not a function` or an import error. Paste it, ignoring the trailing pnpm line.

- [ ] **Step 3: Implement in `booking.ts`** (after `:733`):

```ts
/** F-048 part 2 (spec 3.2): the owner's feed window and its caps. */
export const FEED_PAST_DAYS = 30;
export const FEED_FUTURE_DAYS = 180;
export const FEED_FUTURE_CAP = 1500;
export const FEED_PAST_CAP = 300;
const FEED_STATUSES = ["booked", "completed", "no_show"] as const;
const DAY_MS = 86_400_000;
/** ids per `in()` on a chain hop: keeps a GET's URL well under PostgREST's limits. */
const ROOT_BATCH = 200;

/**
 * F-048 part 2: `rescheduleChain`'s answer for many rows at once, one account-scoped query per hop (per
 * ROOT_BATCH ids), never one query per row. A row whose chain leaves the account, cannot be read, or is
 * deeper than RESCHEDULE_CHAIN_MAX is LEFT OUT and logged (fail closed: no event, never a wrong UID).
 */
export async function rescheduleRoots(
  db: SupabaseClient, accountId: string, rows: readonly { id: string; rescheduled_from_id: string | null }[],
): Promise<Map<string, { rootId: string; depth: number }>> {
  const parent = new Map<string, string | null>();
  const missingForever = new Set<string>();
  for (const r of rows) parent.set(r.id, r.rescheduled_from_id);
  for (let hop = 0; hop < RESCHEDULE_CHAIN_MAX; hop++) {
    const want = [...new Set([...parent.values()])]
      .filter((p): p is string => p !== null && !parent.has(p) && !missingForever.has(p));
    if (want.length === 0) break;
    for (let i = 0; i < want.length; i += ROOT_BATCH) {
      const ids = want.slice(i, i + ROOT_BATCH);
      const { data, error } = await db.from("bookings").select("id, rescheduled_from_id")
        .eq("account_id", accountId).in("id", ids).limit(ids.length);
      if (error) throw new Error(`rescheduleRoots failed: ${error.message}`);
      const got = new Set<string>();
      for (const r of (data ?? []) as { id: string; rescheduled_from_id: string | null }[]) {
        parent.set(r.id, r.rescheduled_from_id);
        got.add(r.id);
      }
      for (const id of ids) if (!got.has(id)) missingForever.add(id);
    }
  }
  const out = new Map<string, { rootId: string; depth: number }>();
  for (const r of rows) {
    let id = r.id;
    let depth = 0;
    let ok = true;
    for (;;) {
      const p = parent.get(id);
      if (p === null) break;
      if (p === undefined || missingForever.has(p) || !parent.has(p) || depth >= RESCHEDULE_CHAIN_MAX) { ok = false; break; }
      id = p;
      depth++;
    }
    if (ok) out.set(r.id, { rootId: id, depth });
    else console.error(`rescheduleRoots: booking ${r.id} has no root in account ${accountId}; left out of the feed`);
  }
  return out;
}

export type FeedBookingRow = {
  id: string; status: "booked" | "completed" | "no_show";
  starts_at: string; ends_at: string; updated_at: string; created_at: string;
  first_name: string | null; rootId: string; depth: number;
};

type FeedRaw = {
  id: string; status: FeedBookingRow["status"]; starts_at: string; ends_at: string;
  updated_at: string; created_at: string; rescheduled_from_id: string | null;
  contacts: { first_name: string | null; assigned_to: string | null } | null;
};

/**
 * F-048 part 2: the bookings one person's feed shows. The ACCOUNT's one calendar (0016's
 * calendars_one_per_account), live and past statuses only (a cancelled row is a cancel or a superseded
 * move, never an event), starts_at in [now - 30 d, now + 180 d), at most FEED_FUTURE_CAP upcoming and
 * FEED_PAST_CAP past. A Technician (technicianUserId) sees only customers assigned to them: 0068's
 * bookings_technician_scope restated, because the route reads with the service role. `truncated` says a
 * cap cut rows. THROWS on a read error.
 */
export async function listFeedBookings(
  db: SupabaseClient, accountId: string, o: { now: Date; technicianUserId: string | null },
): Promise<{ meetingType: "in_person" | "phone" | "video"; rows: FeedBookingRow[]; truncated: boolean }> {
  const { data: cal, error: calErr } = await db.from("calendars").select("id, meeting_type")
    .eq("account_id", accountId).maybeSingle();
  if (calErr) throw new Error(`listFeedBookings: calendar read failed: ${calErr.message}`);
  if (!cal) return { meetingType: "in_person", rows: [], truncated: false };
  const c = cal as { id: string; meeting_type: "in_person" | "phone" | "video" };
  const nowIso = o.now.toISOString();
  const fromIso = new Date(o.now.getTime() - FEED_PAST_DAYS * DAY_MS).toISOString();
  const toIso = new Date(o.now.getTime() + FEED_FUTURE_DAYS * DAY_MS).toISOString();
  const cols = "id, status, starts_at, ends_at, updated_at, created_at, rescheduled_from_id, contacts!inner(first_name, assigned_to)";
  const base = () => {
    let q = db.from("bookings").select(cols)
      .eq("account_id", accountId).eq("calendar_id", c.id).in("status", [...FEED_STATUSES]);
    if (o.technicianUserId !== null) q = q.eq("contacts.assigned_to", o.technicianUserId);
    return q;
  };
  const [up, past] = await Promise.all([
    base().gte("starts_at", nowIso).lt("starts_at", toIso).order("starts_at", { ascending: true }).limit(FEED_FUTURE_CAP + 1),
    base().gte("starts_at", fromIso).lt("starts_at", nowIso).order("starts_at", { ascending: false }).limit(FEED_PAST_CAP + 1),
  ]);
  if (up.error) throw new Error(`listFeedBookings: upcoming read failed: ${up.error.message}`);
  if (past.error) throw new Error(`listFeedBookings: past read failed: ${past.error.message}`);
  const upRows = (up.data ?? []) as unknown as FeedRaw[];
  const pastRows = (past.data ?? []) as unknown as FeedRaw[];
  const truncated = upRows.length > FEED_FUTURE_CAP || pastRows.length > FEED_PAST_CAP;
  const raw = [...pastRows.slice(0, FEED_PAST_CAP), ...upRows.slice(0, FEED_FUTURE_CAP)];
  const roots = await rescheduleRoots(db, accountId, raw);
  const rows = raw.flatMap((r): FeedBookingRow[] => {
    const chain = roots.get(r.id);
    if (!chain) return [];
    return [{ id: r.id, status: r.status, starts_at: r.starts_at, ends_at: r.ends_at, updated_at: r.updated_at,
      created_at: r.created_at, first_name: r.contacts?.first_name ?? null, rootId: chain.rootId, depth: chain.depth }];
  });
  return { meetingType: c.meeting_type, rows, truncated };
}
```

- [ ] **Step 4: Run green.** Run the Step 2 command. Expected: every case passes; paste the summary line.

- [ ] **Step 5: `calendar-feeds.ts`.**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountRole } from "./team";

/** F-048 part 2 (0104): a person's calendar link. Server code only; never returns or logs a token. THROWS on a read or write error. */
export const CALENDAR_FEED_FETCH_MAX = 120;
export const CALENDAR_FEED_FETCH_WINDOW_SECONDS = 3600;
export const CALENDAR_FEED_UNDO_SECONDS = 30;

export type CalendarFeedRow = {
  id: string; account_id: string; user_id: string; token_hash: string;
  created_at: string; revoked_at: string | null; last_fetched_at: string | null;
};
const COLS = "id, account_id, user_id, token_hash, created_at, revoked_at, last_fetched_at";

export async function readLiveCalendarFeed(db: SupabaseClient, accountId: string, userId: string): Promise<CalendarFeedRow | null> {
  const { data, error } = await db.from("calendar_feeds").select(COLS)
    .eq("account_id", accountId).eq("user_id", userId).is("revoked_at", null).maybeSingle();
  if (error) throw new Error(`readLiveCalendarFeed failed: ${error.message}`);
  return (data as CalendarFeedRow | null) ?? null;
}

export async function createCalendarFeed(db: SupabaseClient, a: {
  accountId: string; userId: string; id: string; tokenHash: string; createdBy: string;
}): Promise<"ok" | "exists"> {
  const { error } = await db.from("calendar_feeds").insert({
    id: a.id, account_id: a.accountId, user_id: a.userId, token_hash: a.tokenHash, created_by: a.createdBy,
  });
  if (!error) return "ok";
  if (error.code === "23505") return "exists";
  throw new Error(`createCalendarFeed failed: ${error.message}`);
}

/** Turn off: the database stamps revoked_at with its own now(), the clock restore compares (review M4). */
export async function revokeCalendarFeed(db: SupabaseClient, accountId: string, userId: string): Promise<{ feedId: string; revokedAt: string } | null> {
  const { data, error } = await db.rpc("revoke_calendar_feed", { p_account_id: accountId, p_user_id: userId });
  if (error) throw new Error(`revokeCalendarFeed failed: ${error.message}`);
  const r = data as { status?: string; feed_id?: string; revoked_at?: string } | null;
  if (r?.status === "none") return null;
  if (r?.status === "ok" && r.feed_id && r.revoked_at) return { feedId: r.feed_id, revokedAt: r.revoked_at };
  throw new Error(`revokeCalendarFeed: unexpected answer ${JSON.stringify(r)}`);
}

export async function replaceCalendarFeed(db: SupabaseClient, a: {
  accountId: string; userId: string; newId: string; newHash: string; createdBy: string;
}): Promise<{ status: "ok"; previousId: string; revokedAt: string } | { status: "none" }> {
  const { data, error } = await db.rpc("replace_calendar_feed", {
    p_account_id: a.accountId, p_user_id: a.userId, p_new_id: a.newId, p_new_hash: a.newHash, p_created_by: a.createdBy,
  });
  if (error) throw new Error(`replaceCalendarFeed failed: ${error.message}`);
  const r = data as { status?: string; previous_id?: string; revoked_at?: string } | null;
  if (r?.status === "none") return { status: "none" };
  if (r?.status === "ok" && r.previous_id && r.revoked_at) return { status: "ok", previousId: r.previous_id, revokedAt: r.revoked_at };
  throw new Error(`replaceCalendarFeed: unexpected answer ${JSON.stringify(r)}`);
}

export async function restoreCalendarFeed(db: SupabaseClient, a: {
  accountId: string; userId: string; feedId: string; revokedAt: string; replacementId: string | null;
}): Promise<"restored" | "changed"> {
  const { data, error } = await db.rpc("restore_calendar_feed", {
    p_account_id: a.accountId, p_user_id: a.userId, p_feed_id: a.feedId, p_revoked_at: a.revokedAt,
    p_replacement_id: a.replacementId, p_max_age_seconds: CALENDAR_FEED_UNDO_SECONDS,
  });
  if (error) throw new Error(`restoreCalendarFeed failed: ${error.message}`);
  if (data === "restored" || data === "changed") return data;
  throw new Error(`restoreCalendarFeed: unexpected answer ${JSON.stringify(data)}`);
}

export type FeedClaim =
  | { status: "ok"; feedId: string; accountId: string; userId: string; role: AccountRole; userLanguage: "en" | "es" | null }
  | { status: "not_found" }
  | { status: "rate_limited"; retryAfterSeconds: number };

const ROLES: readonly string[] = ["owner", "staff", "technician"];

export async function claimCalendarFeedFetch(db: SupabaseClient, tokenHash: string): Promise<FeedClaim> {
  const { data, error } = await db.rpc("claim_calendar_feed_fetch", {
    p_token_hash: tokenHash, p_max: CALENDAR_FEED_FETCH_MAX, p_window_seconds: CALENDAR_FEED_FETCH_WINDOW_SECONDS,
  });
  if (error) throw new Error(`claimCalendarFeedFetch failed: ${error.message}`);
  const r = data as Record<string, unknown> | null;
  if (r?.status === "not_found") return { status: "not_found" };
  if (r?.status === "rate_limited" && typeof r.retry_after_seconds === "number") {
    return { status: "rate_limited", retryAfterSeconds: r.retry_after_seconds };
  }
  if (r?.status === "ok" && typeof r.feed_id === "string" && typeof r.account_id === "string"
      && typeof r.user_id === "string" && typeof r.role === "string" && ROLES.includes(r.role)) {
    const lang = r.user_language === "en" || r.user_language === "es" ? r.user_language : null;
    return { status: "ok", feedId: r.feed_id, accountId: r.account_id, userId: r.user_id, role: r.role as AccountRole, userLanguage: lang };
  }
  throw new Error("claimCalendarFeedFetch: unexpected answer");
}
```

The unexpected-answer error deliberately omits the payload: it would carry ids, never the token, but nothing needs them.

Append to `feed-bookings-reads.test.ts` two cases for `claimCalendarFeedFetch`, using a fake `rpc`: (a) `{status:"ok", role:"admin", …}` throws, because an unknown role fails closed, never becoming "sees all"; (b) `{status:"ok", user_language:"fr", …}` gives `userLanguage: null`. Run red, implement, run green as in Steps 2–4.

- [ ] **Step 6: Exports.** In `index.ts`, add after `:113`:

```ts
export { rescheduleRoots, listFeedBookings, FEED_PAST_DAYS, FEED_FUTURE_DAYS, FEED_FUTURE_CAP, FEED_PAST_CAP, type FeedBookingRow } from "./booking";
export {
  CALENDAR_FEED_FETCH_MAX, CALENDAR_FEED_FETCH_WINDOW_SECONDS, CALENDAR_FEED_UNDO_SECONDS,
  readLiveCalendarFeed, createCalendarFeed, revokeCalendarFeed, replaceCalendarFeed, restoreCalendarFeed,
  claimCalendarFeedFetch, type CalendarFeedRow, type FeedClaim,
} from "./calendar-feeds";
```

- [ ] **Step 7: Live test, `calendar-feeds.test.ts`** (CI only; do NOT run locally). Use `withTestAccount` (`fixtures.ts:140`, signature `(fn: (db, accountId) => Promise<void>)`), called TWICE and nested, for a second account. Seed users and memberships with `db.from("users").insert(...)` and `db.from("memberships").insert({ user_id, scope: "account", account_id, role })`, and bookings with `getOrCreateCalendar` (`booking.ts:155`), `createContact` and `createBooking` (`booking.ts:278`, `(db, accountId, input, actorId, actorType?)`). Cases, each its own `it`:
  1. create → `readLiveCalendarFeed` returns the row; a second create is `"exists"`.
  2. **Second account:** account B's claim (by B's hash) returns `accountId` B. `listFeedBookings(db, B, …)` holds only B's booking, never A's, with both accounts carrying a booking at the same instant.
  3. **Revoked:** `revokeCalendarFeed` → claim `not_found`; `restoreCalendarFeed` with the returned `revokedAt` → `ok`.
  4. **Unknown hash** → `not_found`.
  5. **Removed member:** delete the membership → `readLiveCalendarFeed` null, claim `not_found`.
  6. **Technician scope:** a Technician T and customers C1 (assigned to T), C2 (assigned to staff S) and C3 (unassigned). `listFeedBookings(db, A, { technicianUserId: T })` → C1's booking only. After `assignContacts(db, A, [C2], T, "user_test")` (`assignment.ts:144`) moves C2 to T, it holds C1 and C2.
  7. **A reschedule keeps the UID:** book, then `moveBooking` twice (`booking.ts:800`; read its signature from the file). `listFeedBookings` returns ONE row for the chain, `rootId` = the first booking, `depth` 2.
  8. `rescheduleRoots` agrees with `rescheduleChain` (`booking.ts:719`) for every row of that chain.
  9. **One person, two accounts (review I4):** a single user is a member of BOTH A and B, with a link in each. `readLiveCalendarFeed(db, A, u)` returns A's row and `(B, u)` B's. `revokeCalendarFeed(db, A, u)` leaves B's row live (`readLiveCalendarFeed(db, B, u)` unchanged, B's claim `ok`). `replaceCalendarFeed` on A leaves B's row and hash untouched.

- [ ] **Step 8: Typecheck, then commit.** `pnpm --filter web typecheck` (the barrel is consumed by web). Then `git add packages/db/src/calendar-feeds.ts packages/db/src/booking.ts packages/db/src/index.ts packages/db/src/test/feed-bookings-reads.test.ts packages/db/src/test/calendar-feeds.test.ts && git commit -m "feat(booking): the feed's bounded, Technician-fenced booking window and the calendar link wrappers (F-048 part 2)"`

**Bare `vi.mock("@bis/db", () => ({` factories:** T3 adds exports and changes no existing importer. Run `grep -rln 'vi.mock("@bis/db", () => ({' apps/web/src | xargs grep -l "lib/booking/calendar-feed\|feed-card-data\|feed-actions"`. It must print nothing; if it prints a file, add the new names to that factory in the task that introduces the import.

**Second-account case that runs locally (review I4).** Append to `feed-bookings-reads.test.ts`:

```ts
import { readLiveCalendarFeed, revokeCalendarFeed, replaceCalendarFeed, restoreCalendarFeed } from "../calendar-feeds";

/** Records every filter and every rpc argument; answers nothing. */
function feedsFake() {
  const filters: [string, string, unknown][] = [];
  const rpcs: [string, Record<string, unknown>][] = [];
  const b: Record<string, unknown> = {};
  const add = (op: string) => (col: string, v: unknown) => { filters.push([op, col, v]); return b; };
  Object.assign(b, { select: () => b, eq: add("eq"), is: add("is"), maybeSingle: async () => ({ data: null, error: null }) });
  const db = {
    from: () => b,
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcs.push([fn, args]);
      return { data: fn === "restore_calendar_feed" ? "changed" : { status: "none" }, error: null };
    },
  } as unknown as SupabaseClient;
  return { db, filters, rpcs };
}

describe("calendar link wrappers are scoped to the account they are given (second account, review I4)", () => {
  it("readLiveCalendarFeed filters by THIS account and person, live rows only (mutation: drop .eq(account_id) → FAILS)", async () => {
    const { db, filters } = feedsFake();
    await readLiveCalendarFeed(db, "acc-B", "u1");
    expect(filters).toEqual(expect.arrayContaining([["eq", "account_id", "acc-B"], ["eq", "user_id", "u1"], ["is", "revoked_at", null]]));
  });
  it("revoke, replace and restore pass THIS account to the database (mutation: send a fixed account → FAILS)", async () => {
    const { db, rpcs } = feedsFake();
    await revokeCalendarFeed(db, "acc-B", "u1");
    await replaceCalendarFeed(db, { accountId: "acc-B", userId: "u1", newId: "n1", newHash: "h".repeat(64), createdBy: "c" });
    await restoreCalendarFeed(db, { accountId: "acc-B", userId: "u1", feedId: "f1", revokedAt: "2026-11-01T00:00:00+00:00", replacementId: null });
    expect(rpcs.map(([fn, a]) => [fn, a.p_account_id, a.p_user_id])).toEqual([
      ["revoke_calendar_feed", "acc-B", "u1"], ["replace_calendar_feed", "acc-B", "u1"], ["restore_calendar_feed", "acc-B", "u1"],
    ]);
  });
});
```

Add one probe row to the table below: **M7** `readLiveCalendarFeed`: delete `.eq("account_id", accountId)` → `readLiveCalendarFeed filters by THIS account and person…` turns red, because the recorded filters lose `["eq","account_id","acc-B"]`.

**Local tests to run:** `pnpm --filter @bis/db exec vitest run src/test/feed-bookings-reads.test.ts` (judge by the summary block). `calendar-feeds.test.ts` and `booking.test.ts` are CI-only.

**Mutation probes:**

| # | Change (line) | Turns red | Why it can fail |
|---|---|---|---|
| M1 | `listFeedBookings`: `["booked", "completed", "no_show"]` → add `"cancelled"` | `reads the account's own calendar, the three statuses only…` | `toContainEqual` on the exact `in` filter fails. |
| M2 | `listFeedBookings`: delete the `if (o.technicianUserId !== null) …` line | `a Technician's window is fenced to their assigned customers` | No `contacts.assigned_to` filter is recorded. |
| M3 | `rescheduleRoots`: drop `.eq("account_id", accountId)` from the hop | `never follows a parent outside the account…`, at its `calls.every(…)` assertion | Without the filter the fake answers nothing (its `acct` is undefined), so `roots.has("b9")` is still false. The recorded-filter assertion is what fails, and the reviewer pastes that line. The live CI case 2 covers the real row. |
| M4 | `rescheduleRoots`: replace the batched loop with `for (const r of rows) await rescheduleChain(db, accountId, r.id)` | `walks a 2-deep chain to its root in 2 queries…` | That would be 3 + 1 = 4 queries; the count assertion fails. |
| M5 | `const truncated = …` → `const truncated = false` | `says truncated past the cap` | The flag is then never set. The obvious mutation (`.limit(FEED_FUTURE_CAP + 1)` → `.limit(FEED_FUTURE_CAP)`) CANNOT fail here, because the fake ignores `limit`; the live CI window covers it. |
| M6 | `claimCalendarFeedFetch`: drop `&& ROLES.includes(r.role)` | the fake-rpc case `unknown role fails closed` | `role: "admin"` then returns ok instead of throwing. |

---

### Task 4: The loader and the public route

**Tier:** high · **Owner:** bis-booking · **Wave:** 3

**Files:**
- Create: `apps/web/src/lib/booking/calendar-feed.ts`, `apps/web/src/lib/booking/calendar-feed.test.ts`
- Create: `apps/web/src/app/cal/[file]/route.ts`, `apps/web/src/app/cal/[file]/route.test.ts`
- Modify: `apps/web/src/proxy.test.ts:22-36` (one path in each `it.each`)

**Interfaces:**
- Consumes: T2 `feedTokenHash`, `feedTokenFromFile`, `feedIcsFor`; T3 `claimCalendarFeedFetch`, `listFeedBookings`; existing `getBranding` (`branding.ts:345`), `brandDisplayName` (`:415`), `serviceDb`, `type SupabaseClient` (as `public-share.ts:1-5` imports them), `resolveLocale` (`locale.ts:12`), `originFrom(h: Headers): string | null` (`lib/email/origin.ts:33`).
- Produces: `loadCalendarFeed(db: SupabaseClient, token: string, now: Date, origin: string | null): Promise<FeedAnswer>`, where `FeedAnswer = { kind: "ok"; body: string; feedId: string } | { kind: "not_found" } | { kind: "rate_limited"; retryAfterSeconds: number }`; and the route `GET`/`HEAD /cal/[file]`.

- [ ] **Step 1: Failing loader test**, `calendar-feed.test.ts`. It mocks `@bis/db` WITH `importOriginal`, never a bare factory:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
const m = vi.hoisted(() => ({ claim: vi.fn(), list: vi.fn(), branding: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  claimCalendarFeedFetch: (...a: unknown[]) => m.claim(...a),
  listFeedBookings: (...a: unknown[]) => m.list(...a),
  getBranding: (...a: unknown[]) => m.branding(...a),
}));
import { loadCalendarFeed } from "./calendar-feed";
import { feedTokenHash } from "./feed-token";

const TOKEN = "T".repeat(43);
const OK = { status: "ok", feedId: "f1", accountId: "acc-B", userId: "u1", role: "owner", userLanguage: null };
const accountsDb = (language: string | null) => ({
  from: (t: string) => { if (t !== "accounts") throw new Error(t);
    return { select: () => ({ eq: (_c: string, id: string) => ({ maybeSingle: async () => ({ data: id === "acc-B" ? { language } : null, error: null }) }) }) }; },
}) as never;
const ROW = { id: "b1", status: "booked", starts_at: "2026-11-03T15:00:00Z", ends_at: "2026-11-03T16:00:00Z",
  updated_at: "2026-11-01T00:00:00Z", created_at: "2026-11-01T00:00:00Z", first_name: "Maria", rootId: "b1", depth: 0 };
beforeEach(() => {
  m.claim.mockReset(); m.list.mockReset().mockResolvedValue({ meetingType: "in_person", rows: [ROW], truncated: false });
  m.branding.mockReset().mockResolvedValue({ brandName: "Rio Roofing" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("loadCalendarFeed", () => {
  it("claims by the token's HASH, never the token (mutation: pass the token → FAILS)", async () => {
    m.claim.mockResolvedValue({ status: "not_found" });
    expect(await loadCalendarFeed(accountsDb(null), TOKEN, new Date(), null)).toEqual({ kind: "not_found" });
    expect(m.claim).toHaveBeenCalledWith(expect.anything(), feedTokenHash(TOKEN));
    expect(m.list).not.toHaveBeenCalled();
  });
  it("reads ONLY the account the claim names (second account: acc-B, never anything else) (mutation: read a fixed id → FAILS)", async () => {
    m.claim.mockResolvedValue(OK);
    const r = await loadCalendarFeed(accountsDb(null), TOKEN, new Date("2026-11-01T00:00:00Z"), "https://app.bis-rgv.com");
    expect(r.kind).toBe("ok");
    expect(m.list).toHaveBeenCalledWith(expect.anything(), "acc-B", { now: new Date("2026-11-01T00:00:00Z"), technicianUserId: null });
    expect(m.branding).toHaveBeenCalledWith(expect.anything(), "acc-B");
  });
  it("a Technician's feed is fenced to their own id; an Owner's and Staff's are not (mutation: always null → FAILS)", async () => {
    m.claim.mockResolvedValue({ ...OK, role: "technician", userId: "tech-1" });
    await loadCalendarFeed(accountsDb(null), TOKEN, new Date(), null);
    expect(m.list.mock.calls[0]![2]).toMatchObject({ technicianUserId: "tech-1" });
    m.claim.mockResolvedValue({ ...OK, role: "staff", userId: "s-1" });
    await loadCalendarFeed(accountsDb(null), TOKEN, new Date(), null);
    expect(m.list.mock.calls[1]![2]).toMatchObject({ technicianUserId: null });
  });
  it("speaks the person's language over the account's (mutation: account first → FAILS)", async () => {
    m.claim.mockResolvedValue({ ...OK, userLanguage: "es" });
    const r = await loadCalendarFeed(accountsDb("en"), TOKEN, new Date(), null);
    expect(r.kind === "ok" && r.body).toContain("SUMMARY:Cita: Maria");
    m.claim.mockResolvedValue({ ...OK, userLanguage: null });
    const r2 = await loadCalendarFeed(accountsDb("es"), TOKEN, new Date(), null);
    expect(r2.kind === "ok" && r2.body).toContain("SUMMARY:Cita: Maria");
  });
  it("passes the limit through", async () => {
    m.claim.mockResolvedValue({ status: "rate_limited", retryAfterSeconds: 42 });
    expect(await loadCalendarFeed(accountsDb(null), TOKEN, new Date(), null)).toEqual({ kind: "rate_limited", retryAfterSeconds: 42 });
  });
});
```

`getBranding`'s mock returns a partial `Branding`. `brandDisplayName` reads only `branding.brandName` (`branding.ts:415-417`), so that is the one field the mock needs.

- [ ] **Step 2: Failing route test**, `route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
const m = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/lib/booking/calendar-feed", () => ({ loadCalendarFeed: (...a: unknown[]) => m.load(...a) }));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), serviceDb: () => ({}) }));
import { GET, HEAD } from "./route";

const TOKEN = "T".repeat(43);
const call = (file: string, init: RequestInit = {}, fn = GET) =>
  fn(new Request(`https://app.bis-rgv.com/cal/${file}`, { headers: { host: "app.bis-rgv.com" }, ...init }), { params: Promise.resolve({ file }) });
const snapshot = async (r: Response) => ({ status: r.status, body: await r.text(), headers: [...r.headers.entries()].sort() });
beforeEach(() => { m.load.mockReset(); vi.spyOn(console, "error").mockImplementation(() => {}); });

describe("GET /cal/[file] — the owner's calendar feed", () => {
  it("serves text/calendar, private, revalidated, with a weak ETag", async () => {
    m.load.mockResolvedValue({ kind: "ok", body: "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n", feedId: "f1" });
    const r = await call(`${TOKEN}.ics`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(r.headers.get("content-disposition")).toBe('inline; filename="bookings.ics"');
    expect(r.headers.get("cache-control")).toBe("private, no-cache");
    expect(r.headers.get("x-robots-tag")).toBe("noindex");
    expect(r.headers.get("referrer-policy")).toBe("no-referrer");
    expect(r.headers.get("etag")).toMatch(/^W\/"[0-9a-f]{32}"$/);
    expect(await r.text()).toBe("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n");
  });
  it("answers 304 with no body to a matching If-None-Match, and 200 to a stale one (mutation: ignore If-None-Match → FAILS)", async () => {
    m.load.mockResolvedValue({ kind: "ok", body: "X", feedId: "f1" });
    const etag = (await call(`${TOKEN}.ics`)).headers.get("etag")!;
    const r = await call(`${TOKEN}.ics`, { headers: { host: "app.bis-rgv.com", "if-none-match": etag } });
    expect(r.status).toBe(304);
    expect(await r.text()).toBe("");
    expect((await call(`${TOKEN}.ics`, { headers: { host: "app.bis-rgv.com", "if-none-match": 'W/"0"' } })).status).toBe(200);
  });
  it("unknown, revoked and wrong-account tokens, and a bad shape, are ONE identical 404 (mutation: 410 for a revoked link → FAILS)", async () => {
    m.load.mockResolvedValue({ kind: "not_found" });
    const unknown = await snapshot(await call(`${TOKEN}.ics`));
    const revoked = await snapshot(await call(`${"R".repeat(43)}.ics`));
    const otherAccount = await snapshot(await call(`${"B".repeat(43)}.ics`));
    const badShape = await snapshot(await call("nope.ics"));
    const noSuffix = await snapshot(await call(TOKEN));
    expect(unknown).toEqual({ status: 404, body: "Not found", headers: expect.any(Array) });
    for (const s of [revoked, otherAccount, badShape, noSuffix]) expect(s).toEqual(unknown);
    expect(m.load).toHaveBeenCalledTimes(3);   // bad shapes never reach the database
  });
  it("a limited link is 429 with Retry-After in seconds", async () => {
    m.load.mockResolvedValue({ kind: "rate_limited", retryAfterSeconds: 90 });
    const r = await call(`${TOKEN}.ics`);
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("90");
  });
  it("a read failure is a 500 that never logs the token (mutation: log the file name → FAILS)", async () => {
    m.load.mockRejectedValue(new Error("db down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await call(`${TOKEN}.ics`);
    expect(r.status).toBe(500);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(JSON.stringify(err.mock.calls)).not.toContain(TOKEN);
  });
  it("HEAD answers GET's status and headers with no body", async () => {
    m.load.mockResolvedValue({ kind: "ok", body: "X", feedId: "f1" });
    const r = await call(`${TOKEN}.ics`, {}, HEAD);
    expect(r.status).toBe(200);
    expect(r.headers.get("etag")).toMatch(/^W\//);
    expect(await r.text()).toBe("");
  });
});
```

The three "wrong token" cases are the route-level half. The database half (an unknown hash and a revoked row each claim `not_found`; account B's token reads B only) is T1's P2/P3 and T3's live cases 2–4.

- [ ] **Step 3: Failing proxy row.** In `proxy.test.ts`, add `"/cal/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.ics"` to the first `it.each` array (`:22-27`), and add `"/cal"` and `"/cal/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"` to the second (`:31-36`; no dot, so the proxy runs, which is harmless, since only `/dashboard` is protected, `proxy.ts:3`). Expected on this step: GREEN at once, because the `.*\\..*` clause already excludes it (`proxy.ts:39`). This row is a regression pin, not new behaviour. Its red is shown by the mutation probe (M5 below), not here; state that in the report.

- [ ] **Step 4: Run red.** `pnpm --filter web exec vitest run src/lib/booking/calendar-feed.test.ts "src/app/cal/[file]/route.test.ts" src/proxy.test.ts`. Expected: the first two fail to resolve `./calendar-feed` and `./route`. Paste the lines.

- [ ] **Step 5: Implement the loader**, `calendar-feed.ts`:

```ts
import { claimCalendarFeedFetch, listFeedBookings, getBranding, brandDisplayName, type SupabaseClient } from "@bis/db";
import { resolveLocale, type Locale } from "@/lib/i18n/locale";
import { feedTokenHash } from "./feed-token";
import { feedIcsFor } from "./feed-content";

/**
 * F-048 part 2: one fetch of a person's calendar feed. The token is proven FIRST, by its hash, in one locked
 * claim (0104) that also re-proves the membership, client access and the account, and returns the role;
 * every later read carries the CLAIM's account, never anything else. A Technician's window is fenced to
 * their assigned customers. Takes the caller's client (the route's serviceDb), so this file names none.
 * THROWS on a read error. Never logs the token.
 */
export type FeedAnswer =
  | { kind: "ok"; body: string; feedId: string }
  | { kind: "not_found" }
  | { kind: "rate_limited"; retryAfterSeconds: number };

export async function loadCalendarFeed(db: SupabaseClient, token: string, now: Date, origin: string | null): Promise<FeedAnswer> {
  const claim = await claimCalendarFeedFetch(db, feedTokenHash(token));
  if (claim.status === "not_found") return { kind: "not_found" };
  if (claim.status === "rate_limited") return { kind: "rate_limited", retryAfterSeconds: claim.retryAfterSeconds };

  const { data, error } = await db.from("accounts").select("language").eq("id", claim.accountId).maybeSingle();
  if (error) throw new Error(`calendar feed ${claim.feedId}: account read failed: ${error.message}`);
  const raw = (data as { language: string | null } | null)?.language ?? null;
  const locale: Locale = resolveLocale(claim.userLanguage, raw === "en" || raw === "es" ? raw : null);

  const [feed, branding] = await Promise.all([
    listFeedBookings(db, claim.accountId, { now, technicianUserId: claim.role === "technician" ? claim.userId : null }),
    getBranding(db, claim.accountId),
  ]);
  if (feed.truncated) console.error(`calendar feed ${claim.feedId}: the window hit its cap; the furthest rows were left out`);
  return {
    kind: "ok", feedId: claim.feedId,
    body: feedIcsFor({ brandName: brandDisplayName(branding), locale, meetingType: feed.meetingType, origin,
      accountId: claim.accountId, rows: feed.rows }),
  };
}
```

- [ ] **Step 6: Implement the route**, `app/cal/[file]/route.ts`:

```ts
import { createHash } from "node:crypto";
import { serviceDb } from "@bis/db";
import { originFrom } from "@/lib/email/origin";
import { feedTokenFromFile } from "@/lib/booking/feed-token";
import { loadCalendarFeed } from "@/lib/booking/calendar-feed";

/**
 * `/cal/<token>.ics`: a person's calendar feed (F-048 part 2), subscribed to by iPhone, Google and Outlook.
 * Public and unauthenticated: the path holds a dot, so proxy.ts never runs Clerk on it (proxy.ts:39), and
 * the token is the capability. Every refusal (bad shape, unknown, turned off, removed, access off,
 * archived) is the SAME 404, so nobody learns whether a token ever existed. `private, no-cache` + a weak
 * ETag over the body: no shared cache stores a person's bookings, and a refresh with nothing new is a 304.
 * Never logs the token.
 */
export const dynamic = "force-dynamic";

const NOT_FOUND = () => new Response("Not found", {
  status: 404, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
});

type Ctx = { params: Promise<{ file: string }> };

async function answer(req: Request, { params }: Ctx, withBody: boolean): Promise<Response> {
  const { file } = await params;
  const token = feedTokenFromFile(file);
  if (!token) return NOT_FOUND();
  try {
    const r = await loadCalendarFeed(serviceDb(), token, new Date(), originFrom(req.headers));
    if (r.kind === "not_found") return NOT_FOUND();
    if (r.kind === "rate_limited") {
      return new Response("Too many requests", {
        status: 429, headers: { "Retry-After": String(r.retryAfterSeconds), "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
      });
    }
    const etag = `W/"${createHash("sha256").update(r.body).digest("hex").slice(0, 32)}"`;
    const headers = {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="bookings.ics"',
      "Cache-Control": "private, no-cache",
      ETag: etag,
      "X-Robots-Tag": "noindex",
      "Referrer-Policy": "no-referrer",
    };
    const inm = req.headers.get("if-none-match");
    if (inm && inm.split(",").map((s) => s.trim()).some((v) => v === etag || v === "*")) {
      return new Response(null, { status: 304, headers });
    }
    return new Response(withBody ? r.body : null, { status: 200, headers });
  } catch (e) {
    console.error(`calendar feed: read failed: ${e instanceof Error ? e.message : String(e)}`);
    return new Response("Something went wrong", { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export function GET(req: Request, ctx: Ctx): Promise<Response> { return answer(req, ctx, true); }
export function HEAD(req: Request, ctx: Ctx): Promise<Response> { return answer(req, ctx, false); }
```

The error log prints `e.message`. The loader's own messages name the feed id, and `claimCalendarFeedFetch` never puts the token in a message (T3), so the token-free assertion holds.

- [ ] **Step 7: Run green.** Run the Step 4 command. Expected: all pass; paste the summary. Then `pnpm --filter web typecheck`.

- [ ] **Step 8: `in-account-service-reads.test.ts` check.** `app/cal/` is outside its `ROOTS` (`:34`), and `lib/booking/calendar-feed.ts` names no service getter (it takes a client), so NO entry is needed. Prove it: `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts"` must pass unchanged. Paste the summary.

- [ ] **Step 9: Commit.** `git add apps/web/src/lib/booking/calendar-feed.ts apps/web/src/lib/booking/calendar-feed.test.ts "apps/web/src/app/cal/[file]/route.ts" "apps/web/src/app/cal/[file]/route.test.ts" apps/web/src/proxy.test.ts && git commit -m "feat(booking): /cal/<token>.ics, the owner's calendar feed, re-proved on every fetch and one 404 for every refusal (F-048 part 2)"`

**Bare `vi.mock("@bis/db", () => ({` factories:** `calendar-feed.ts` is imported only by the route and its own test, and both tests above use `importOriginal`. Run `grep -rln "lib/booking/calendar-feed" apps/web/src`; it must list only the route, its test and the loader's test.

**Local tests to run:** `pnpm --filter web exec vitest run src/lib/booking/calendar-feed.test.ts "src/app/cal/[file]/route.test.ts" src/proxy.test.ts "src/app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts"`.

**Mutation probes:**

| # | Change (line) | Turns red | Why it can fail |
|---|---|---|---|
| M1 | Loader: `feedTokenHash(token)` → `token` | `claims by the token's HASH, never the token` | `toHaveBeenCalledWith(…, hash)` fails. |
| M2 | Loader: `claim.role === "technician" ? claim.userId : null` → `null` | `a Technician's feed is fenced to their own id…` | `technicianUserId` is null for the Technician. |
| M3 | Loader: `resolveLocale(claim.userLanguage, …)` → `resolveLocale(raw === "en" \|\| raw === "es" ? raw : null, claim.userLanguage)` | `speaks the person's language over the account's` | The account's `en` wins, so the summary reads English. |
| M4 | Route: in the `rate_limited`-free path, make `not_found` return `new Response("Gone", { status: 410, … })` | `unknown, revoked and wrong-account tokens… are ONE identical 404` | Every not_found case then reads 410, while `badShape` still reads 404, so they differ. |
| M5 | `proxy.ts:39`: remove `\|.*\\..*` from the matcher | `/cal/AAA….ics skips the proxy…` (the `it.each` row's title includes the path) | Without the dot clause the matcher runs on `/cal/…`. `/embed.js`'s row fails too, which is expected. |
| M6 | Route: delete the `if (inm && …)` block | `answers 304 with no body to a matching If-None-Match…` | A 200 comes back instead of a 304. |

---

### Task 5: The card on the Calendar page

**Tier:** medium · **Owner:** bis-frontend · **Wave:** 3

**Files:**
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calendar/feed-card-data.ts`, `…/calendar/feed-card-data.test.ts`
- Create: `…/calendar/feed-actions.ts`, `…/calendar/feed-actions.test.ts`
- Create: `…/calendar/feed-card-handlers.ts`, `…/calendar/feed-card-handlers.test.ts`
- Create: `…/calendar/feed-card.tsx`, `…/calendar/feed-card.test.ts`
- Modify: `…/calendar/page.tsx:1-25` (imports), `:88-89` (feed view read, after `origin`), `:220` (render)
- Modify: `…/calendar/page.test.ts` (three `vi.mock`s and one `describe`)
- Modify: `…/[accountId]/in-account-service-reads.test.ts:75-81` (two `ALLOWED` lines, kept in path order)
- Modify: `apps/web/src/lib/messages.ts` (the `calendar.feed.*` keys, right after the existing `calendar.*` block that starts at `:1746`)
- Modify: `apps/web/src/lib/palette/registry.ts:74`
- Modify: `apps/web/src/lib/palette/registry.test.ts` (one `it` beside the Closed days one at `:178-184`; review M5)
- Modify: `apps/web/src/lib/billing/read-only.test.ts` (three `READ_ONLY_ALLOWED` entries, `:148`; review I3)

**Interfaces:**
- Consumes: T2 `feedSecretConfigured`, `feedToken`, `feedTokenHash`, `feedUrl`, `webcalUrl`; T3 `readLiveCalendarFeed`, `createCalendarFeed`, `replaceCalendarFeed`, `revokeCalendarFeed`, `restoreCalendarFeed`, `CALENDAR_FEED_UNDO_SECONDS`; existing `readPersonId(db, accountId, clerkUserId): Promise<string | null>` (`assignment.ts:51`), `requireAccountAccess(accountId)` → `{ userId, isAgency, role, canManage }` (`auth.ts:55-81`), `formatRelativeTime(iso, locale)` (`lib/format.ts:109`), `makeTr(locale, pseudo)` (`lib/record/copy.ts:15`), `toast` from `sonner`, `Card*` (`components/ui/card`), `Button` (`components/ui/button`, which renders `data-variant`).
- Produces:
  - `type FeedCardView = { kind: "agency" } | { kind: "unavailable" } | { kind: "none" } | { kind: "stale" } | { kind: "error" } | { kind: "live"; url: string; webcal: string; lastFetchedAt: string | null; technician: boolean }`
  - `loadFeedCardView(a: { accountId: string; clerkUserId: string; isAgency: boolean; role: AccountRole | null; origin: string }): Promise<FeedCardView>`, which never throws
  - `type FeedUndo = { feedId: string; revokedAt: string; replacementId: string | null }`; `type FeedActionResult = { ok: true; undo: FeedUndo | null } | { ok: false; error: FeedErrorKey }`; `FeedErrorKey = "calendar.feed.error.failed" | "calendar.feed.error.notMember" | "calendar.feed.error.unavailable" | "calendar.feed.error.undoLate"`
  - actions: `makeFeedLinkAction(accountId)`, `replaceFeedLinkAction(accountId)`, `turnOffFeedLinkAction(accountId)`, `undoFeedLinkAction(accountId, undo: FeedUndo)`, each `Promise<FeedActionResult>`
  - `<FeedCard view locale pseudo make replace turnOff undo />`

- [ ] **Step 1: Messages.** Add these keys to `messages.ts`, each followed by its `.es` twin, under the comment `// F-048 part 2: the Calendar page's "Bookings on your phone" card (owner decisions D1–D3).`:

| key | EN | ES |
|---|---|---|
| `calendar.feed.title` | Bookings on your phone | Tus citas en el teléfono |
| `calendar.feed.empty` | Put every booking on your phone's calendar: iPhone, Google or Outlook. You get your own private link. | Pon cada cita en el calendario de tu teléfono: iPhone, Google u Outlook. Tienes tu propio enlace privado. |
| `calendar.feed.make` | Make my link | Crear mi enlace |
| `calendar.feed.linkLabel` | Your private link | Tu enlace privado |
| `calendar.feed.copy` | Copy link | Copiar enlace |
| `calendar.feed.copied` | Link copied. | Enlace copiado. |
| `calendar.feed.addIphone` | Add to iPhone | Agregar al iPhone |
| `calendar.feed.replace` | Make a new link | Crear un enlace nuevo |
| `calendar.feed.turnOff` | Turn off | Desactivar |
| `calendar.feed.private` | Anyone with this link can see your booking times and your customers' first names. Don't share it. | Quien tenga este enlace puede ver las horas de tus citas y el nombre de tus clientes. No lo compartas. |
| `calendar.feed.window` | Shows the last 30 days and the next six months. | Muestra los últimos 30 días y los próximos seis meses. |
| `calendar.feed.technician` | Your link shows bookings for the customers assigned to you. | Tu enlace muestra las citas de los clientes asignados a ti. |
| `calendar.feed.lastChecked` | Your calendar last asked for your bookings {when}. | Tu calendario pidió tus citas por última vez {when}. |
| `calendar.feed.neverChecked` | No calendar has used this link yet. Google can take up to a day. | Ningún calendario ha usado este enlace todavía. Google puede tardar hasta un día. |
| `calendar.feed.stale` | Your link needs to be made again. The old one keeps working until you do. | Tu enlace se tiene que crear de nuevo. El anterior sigue funcionando hasta que lo hagas. |
| `calendar.feed.agency` | Each person on the business's team makes their own link here. | Cada persona del equipo del negocio crea aquí su propio enlace. |
| `calendar.feed.unavailable` | Phone calendars aren't available yet. | Los calendarios del teléfono aún no están disponibles. |
| `calendar.feed.loadError` | We couldn't load your link. Try again. | No pudimos cargar tu enlace. Inténtalo de nuevo. |
| `calendar.feed.howTo` | How to add it | Cómo agregarlo |
| `calendar.feed.iphone.title` | iPhone | iPhone |
| `calendar.feed.iphone.steps` | 1. On your iPhone, open this page and tap Add to iPhone. 2. Tap Subscribe, then Done. To see new bookings sooner, open Settings › Apps › Calendar › Calendar Accounts › Fetch New Data and choose Every 15 Minutes. | 1. En tu iPhone, abre esta página y toca Agregar al iPhone. 2. Toca Suscribirse y luego OK. Para ver antes las citas nuevas, abre Ajustes › Apps › Calendario › Cuentas de calendario › Obtener datos y elige Cada 15 minutos. |
| `calendar.feed.google.title` | Google Calendar | Google Calendar |
| `calendar.feed.google.steps` | 1. On a computer, go to calendar.google.com. The phone app can't add it. 2. Next to Other calendars, click +, then From URL. 3. Paste your link and click Add calendar. It shows up on your phone by itself. | 1. En una computadora, entra a calendar.google.com. La app del teléfono no puede agregarlo. 2. Junto a Otros calendarios, haz clic en + y luego en Desde URL. 3. Pega tu enlace y haz clic en Agregar calendario. Aparece solo en tu teléfono. |
| `calendar.feed.outlook.title` | Outlook | Outlook |
| `calendar.feed.outlook.steps` | 1. Go to outlook.com and open Calendar. 2. Click Add calendar, then Subscribe from web. 3. Paste your link, give it a name and click Import. | 1. Entra a outlook.com y abre Calendario. 2. Haz clic en Agregar calendario y luego en Suscribirse desde la web. 3. Pega tu enlace, ponle un nombre y haz clic en Importar. |
| `calendar.feed.slow` | New bookings can take a few hours to show up on Google and Outlook, sometimes a day. The email for each booking still comes right away. | Las citas nuevas pueden tardar unas horas en aparecer en Google y Outlook, a veces un día. El correo de cada cita sigue llegando al momento. |
| `calendar.feed.toast.replaced` | New link made. Your old link stopped working. | Enlace nuevo creado. El anterior dejó de funcionar. |
| `calendar.feed.toast.turnedOff` | Link turned off. | Enlace desactivado. |
| `calendar.feed.toast.restored` | Your link is back. | Tu enlace volvió. |
| `calendar.feed.undo` | Undo | Deshacer |
| `calendar.feed.error.failed` | That didn't save. Try again. | No se guardó. Inténtalo de nuevo. |
| `calendar.feed.error.notMember` | Only people on the business's team can have a link. | Solo las personas del equipo del negocio pueden tener un enlace. |
| `calendar.feed.error.unavailable` | Phone calendars aren't available yet. | Los calendarios del teléfono aún no están disponibles. |
| `calendar.feed.error.undoLate` | Too late to undo. Make a new link instead. | Ya no se puede deshacer. Crea un enlace nuevo. |

The menu paths in the three `steps` rows are ASSUMPTIONS (spec §5.2). Check each against the vendor's page on the day you build, and record in the report what you checked and when.

Palette (pinned in `registry.test.ts` by a new `it("finds Calendar by phone calendar, subscribe, iPhone, Google calendar and Outlook, in English and Spanish (mutation: drop one → FAILS)")` that asserts every word below is in the `nav:${BASE}/calendar` entry's keywords, the shape of `:178-184`): append `"phone calendar", "subscribe", "ical", "ics", "iphone", "google calendar", "outlook", "calendario del teléfono", "suscribirse"` to the `"/calendar"` array at `registry.ts:74`, keeping its comment line above.

- [ ] **Step 2: Failing tests.**

`feed-card-data.test.ts` mocks `@bis/db` with `importOriginal`, plus `readPersonId`, `readLiveCalendarFeed` and `serviceDb`. Cases:
1. agency → `{kind:"agency"}`, no reads (`readPersonId` not called).
2. no secret (`vi.stubEnv("CALENDAR_FEED_SECRET", "")`) → `unavailable`.
3. **Second account:** `readPersonId` is called with the ROUTE's accountId. A caller who is not a member of it (`readPersonId` → null) gets `error` and never reaches `readLiveCalendarFeed` (mutation: skip the member check → FAILS).
4. no row → `none`.
5. a row whose `token_hash` matches `feedTokenHash(feedToken(id))` → `live` with `url = https://app.bis-rgv.com/cal/<token>.ics`, the webcal twin, and `technician` true only for role technician.
6. a row whose hash does not match (the secret changed) → `stale`.
7. `readLiveCalendarFeed` throws → `error`, logged without the token.

`feed-actions.test.ts` mocks `@/lib/auth` (`requireAccountAccess`), `next/cache` (`revalidatePath`) and `@bis/db` (`importOriginal`, with the five wrappers, `readPersonId` and `serviceDb`). Cases:
1. make: `createCalendarFeed` receives `id` (a uuid), `tokenHash === feedTokenHash(feedToken(id))`, `createdBy` = the Clerk id and `userId` = `readPersonId`'s answer (mutation: hash the id instead of the token → FAILS).
2. agency → `notMember`, with no write.
3. replace → `undo = { feedId: previousId, revokedAt, replacementId: newId }`.
4. turn off → `undo = { feedId, revokedAt, replacementId: null }`.
5. undo → `restoreCalendarFeed` is called with the CALLER's `userId` from `readPersonId`, never a value from the undo payload; `"changed"` → `error: "calendar.feed.error.undoLate"` (mutation: take the user id from the payload → FAILS. The payload type has no user id, so the mutation is "pass `undo.feedId` as `userId`").
6. `unavailable` when the secret is unset, with no write.

`feed-card-handlers.test.ts` mocks `sonner` as `assign.test.ts` does (`vi.mock("sonner", () => ({ toast: toasts }))`). Cases: `runReplace` toasts `calendar.feed.toast.replaced` with an Undo action whose `onClick` calls `undo(accountId, result.undo)` and then toasts `restored`; a refused result toasts its error key's sentence; a thrown action toasts `calendar.feed.error.failed`.

`feed-card.test.ts` renders with `renderToStaticMarkup(createElement(FeedCard, props))` for every `kind` in both locales. It asserts:
- the right sentence appears;
- exactly ONE `data-variant="default"` button where the state has an action, and none for `agency`, `unavailable` and `error`;
- the live link's `<input readonly>` holds the URL, and `href="webcal://…"` is present;
- the technician line appears only with `technician: true`;
- the Spanish render contains no English key text (`Make my link` is absent under `es`);
- **(review M9)** `feed-card.tsx` and `feed-card-handlers.ts` import `FeedCardView`, `FeedActionResult` and `FeedUndo` TYPE-ONLY. Read each source with `readFileSync` and assert that it matches `/import type \{[^}]*FeedCardView[^}]*\} from "\.\/feed-card-data"/`, that it does NOT match `/^import (?!type)[^;]*from "\.\/feed-card-data"/m`, and that it does NOT match `/feed-token|node:crypto/`. A value import would pull `node:crypto` and the secret reader into the client bundle (mutation: change `import type` to `import` → FAILS).

- [ ] **Step 3: Run red.** `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/calendar/feed-card-data.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/calendar/feed-actions.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/calendar/feed-card-handlers.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/calendar/feed-card.test.ts"`. Expected: four import failures. Paste them.

- [ ] **Step 4: `feed-card-data.ts`.**

```ts
import { serviceDb, readPersonId, readLiveCalendarFeed, type AccountRole } from "@bis/db";
import { feedSecretConfigured, feedToken, feedTokenHash, feedUrl, webcalUrl } from "@/lib/booking/feed-token";
import { loggableError } from "@/lib/loggable-error";

/**
 * F-048 part 2: the Calendar page's "Bookings on your phone" card, read for the SIGNED-IN person only:
 * every read is keyed by readPersonId(route account, the caller's own Clerk id), so a person sees their own
 * link and nobody else's (in-account-service-reads: proven-target). Never throws: a failed read is the
 * card's own error state (DESIGN.md rule 5). Never logs a token.
 */
export type FeedCardView =
  | { kind: "agency" } | { kind: "unavailable" } | { kind: "none" } | { kind: "stale" } | { kind: "error" }
  | { kind: "live"; url: string; webcal: string; lastFetchedAt: string | null; technician: boolean };

export async function loadFeedCardView(a: {
  accountId: string; clerkUserId: string; isAgency: boolean; role: AccountRole | null; origin: string;
}): Promise<FeedCardView> {
  if (a.isAgency) return { kind: "agency" };
  if (!feedSecretConfigured()) return { kind: "unavailable" };
  try {
    const db = serviceDb();
    const userId = await readPersonId(db, a.accountId, a.clerkUserId);
    if (!userId) return { kind: "error" };
    const feed = await readLiveCalendarFeed(db, a.accountId, userId);
    if (!feed) return { kind: "none" };
    const token = feedToken(feed.id);
    if (feedTokenHash(token) !== feed.token_hash) return { kind: "stale" };
    const url = feedUrl(a.origin, token);
    return { kind: "live", url, webcal: webcalUrl(url), lastFetchedAt: feed.last_fetched_at, technician: a.role === "technician" };
  } catch (e) {
    console.error(`calendar feed card: read failed: ${loggableError(e)}`);
    return { kind: "error" };
  }
}
```

`AccountRole` is exported from `@bis/db` (`auth.ts:3` imports it from there).

- [ ] **Step 5: `feed-actions.ts`.**

```ts
"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import {
  serviceDb, readPersonId, createCalendarFeed, replaceCalendarFeed, revokeCalendarFeed, restoreCalendarFeed,
} from "@bis/db";
import { requireAccountAccess } from "@/lib/auth";
import { feedSecretConfigured, feedToken, feedTokenHash } from "@/lib/booking/feed-token";
import { loggableError } from "@/lib/loggable-error";

/**
 * F-048 part 2: make, replace, turn off and undo the SIGNED-IN person's own calendar link. Every write is
 * keyed by readPersonId(route account, the caller's Clerk id); the Undo payload carries no person, so a
 * forged one can only name a row restore_calendar_feed then refuses (it scopes by account AND user).
 * Every member may act (owner decision D1); the agency has no link. Paused accounts refuse it, as every
 * client write is refused (auth.ts:44-53).
 */
export type FeedUndo = { feedId: string; revokedAt: string; replacementId: string | null };
export type FeedErrorKey =
  | "calendar.feed.error.failed" | "calendar.feed.error.notMember"
  | "calendar.feed.error.unavailable" | "calendar.feed.error.undoLate";
export type FeedActionResult = { ok: true; undo: FeedUndo | null } | { ok: false; error: FeedErrorKey };

type Me = { db: ReturnType<typeof serviceDb>; personId: string; clerkUserId: string };

/** The signed-in person's users.id in THIS account, or null for the agency or a non-member. No guard of its own:
 *  each action calls requireAccountAccess itself, so the pause option is visible in the action's body. */
async function person(accountId: string, clerkUserId: string, isAgency: boolean): Promise<Me | null> {
  if (isAgency) return null;
  const db = serviceDb();
  const personId = await readPersonId(db, accountId, clerkUserId);
  return personId ? { db, personId, clerkUserId } : null;
}

/** Make my link: an ordinary write, refused during a pause (the default guard). */
async function me(accountId: string): Promise<Me | null> {
  const { userId, isAgency } = await requireAccountAccess(accountId);
  return person(accountId, userId, isAgency);
}

const done = (accountId: string, undo: FeedUndo | null): FeedActionResult => {
  revalidatePath(`/dashboard/accounts/${accountId}/calendar`);
  return { ok: true, undo };
};
const fail = (what: string, e: unknown): FeedActionResult => {
  console.error(`calendar feed: ${what} failed: ${loggableError(e)}`);
  return { ok: false, error: "calendar.feed.error.failed" };
};

export async function makeFeedLinkAction(accountId: string): Promise<FeedActionResult> {
  if (!feedSecretConfigured()) return { ok: false, error: "calendar.feed.error.unavailable" };
  try {
    const who = await me(accountId);
    if (!who) return { ok: false, error: "calendar.feed.error.notMember" };
    const id = randomUUID();
    await createCalendarFeed(who.db, { accountId, userId: who.personId, id, tokenHash: feedTokenHash(feedToken(id)), createdBy: who.clerkUserId });
    return done(accountId, null);
  } catch (e) { return fail("make", e); }
}

// The three PROTECTIVE actions below stay open during a billing pause (coordinator decision on review I3): a
// leaked link must be closable while the account is read-only. Each passes the option to its OWN awaited
// guard in its body, and none revalidates (lib/billing/read-only.test.ts:276-310 pins both); the card's
// handlers refresh the page instead.

export async function replaceFeedLinkAction(accountId: string): Promise<FeedActionResult> {
  if (!feedSecretConfigured()) return { ok: false, error: "calendar.feed.error.unavailable" };
  try {
    const { userId, isAgency } = await requireAccountAccess(accountId, { duringPause: "allow" });
    const who = await person(accountId, userId, isAgency);
    if (!who) return { ok: false, error: "calendar.feed.error.notMember" };
    const newId = randomUUID();
    const newHash = feedTokenHash(feedToken(newId));
    const r = await replaceCalendarFeed(who.db, { accountId, userId: who.personId, newId, newHash, createdBy: who.clerkUserId });
    if (r.status === "none") {
      await createCalendarFeed(who.db, { accountId, userId: who.personId, id: newId, tokenHash: newHash, createdBy: who.clerkUserId });
      return { ok: true, undo: null };
    }
    return { ok: true, undo: { feedId: r.previousId, revokedAt: r.revokedAt, replacementId: newId } };
  } catch (e) { return fail("replace", e); }
}

export async function turnOffFeedLinkAction(accountId: string): Promise<FeedActionResult> {
  try {
    const { userId, isAgency } = await requireAccountAccess(accountId, { duringPause: "allow" });
    const who = await person(accountId, userId, isAgency);
    if (!who) return { ok: false, error: "calendar.feed.error.notMember" };
    const r = await revokeCalendarFeed(who.db, accountId, who.personId);
    return { ok: true, undo: r ? { feedId: r.feedId, revokedAt: r.revokedAt, replacementId: null } : null };
  } catch (e) { return fail("turn off", e); }
}

export async function undoFeedLinkAction(accountId: string, undo: FeedUndo): Promise<FeedActionResult> {
  try {
    const { userId, isAgency } = await requireAccountAccess(accountId, { duringPause: "allow" });
    const who = await person(accountId, userId, isAgency);
    if (!who) return { ok: false, error: "calendar.feed.error.notMember" };
    const r = await restoreCalendarFeed(who.db, {
      accountId, userId: who.personId, feedId: undo.feedId, revokedAt: undo.revokedAt, replacementId: undo.replacementId,
    });
    if (r === "changed") return { ok: false, error: "calendar.feed.error.undoLate" };
    return { ok: true, undo: null };
  } catch (e) { return fail("undo", e); }
}
```

- [ ] **Step 6: `feed-card-handlers.ts`.** These are pure toasts, the shape of `assign-handlers.ts:86-117`:

```ts
import { toast } from "sonner";
import type { Tr } from "@/lib/record/copy";
import type { FeedActionResult, FeedUndo } from "./feed-actions";

export const FEED_TOAST_MS = 30_000;   // = CALENDAR_FEED_UNDO_SECONDS: the Undo is offered only while the database would honour it
type Run = () => Promise<FeedActionResult>;
type UndoRun = (undo: FeedUndo) => Promise<FeedActionResult>;

async function settle(run: Run, tr: Tr): Promise<FeedActionResult | null> {
  try {
    const r = await run();
    if (!r.ok) { toast.error(tr.text(r.error)); return null; }
    return r;
  } catch {
    toast.error(tr.text("calendar.feed.error.failed"));
    return null;
  }
}

/** Make: no toast (the card itself changes). */
export async function runMake(run: Run, tr: Tr, refresh: () => void): Promise<void> {
  if (await settle(run, tr)) refresh();
}

/** Replace and Turn off: run at once, then a toast with Undo (DESIGN.md rule 6). */
export async function runWithUndo(run: Run, undo: UndoRun, tr: Tr, message: "calendar.feed.toast.replaced" | "calendar.feed.toast.turnedOff", refresh: () => void): Promise<void> {
  const r = await settle(run, tr);
  if (!r || !r.ok) return;
  refresh();
  const u = r.undo;
  if (!u) return;
  toast.success(tr.text(message), {
    duration: FEED_TOAST_MS,
    action: {
      label: tr.text("calendar.feed.undo"),
      onClick: () => {
        void settle(() => undo(u), tr).then((back) => { if (back) { toast.success(tr.text("calendar.feed.toast.restored")); refresh(); } });
      },
    },
  });
}
```

- [ ] **Step 7: `feed-card.tsx`.** It renders the states of spec §5.1 with `makeTr(locale, pseudo)`, `Card`/`CardHeader`/`CardTitle`/`CardContent` and `Button` (`variant="default"` exactly once per actionable state, every other button `variant="ghost"`). The rules:
- **Copy** writes `navigator.clipboard.writeText(view.url)`, then toasts `calendar.feed.copied`.
- **Add to iPhone** is `<Button asChild variant="ghost"><a href={view.webcal}>…</a></Button>` (`Button` takes `asChild`, `components/ui/button.tsx:45-49`).
- **Last checked** is `tr.text("calendar.feed.lastChecked", { when: formatRelativeTime(view.lastFetchedAt, locale) })`, or `neverChecked` when the value is null.
- **The instructions** go in a `<details><summary>{howTo}</summary>…</details>` with the three titles and steps, then `slow`. A `<details>` is closed until tapped and keyboard-operable with no script.
- The read-only link field is `<input readOnly value={view.url} aria-label={linkLabel} />`, using the `Input` component.
- The root is `<Card id="phone-calendar" data-feed-card>`.
- Action props are bound server actions (`make: () => Promise<FeedActionResult>`, and so on). `useRouter().refresh` is the `refresh` callback, and `useTransition` disables buttons while a run is in flight.
- Tokens only. No new colours, radii or shadows.

- [ ] **Step 8: Wire `page.tsx`.** Imports:

```ts
import { FeedCard } from "./feed-card";
import { loadFeedCardView } from "./feed-card-data";
import { makeFeedLinkAction, replaceFeedLinkAction, turnOffFeedLinkAction, undoFeedLinkAction } from "./feed-actions";
```

After `origin` is computed (`:88`):

```ts
  // F-048 part 2: the person's own calendar link. Never throws (its own error state).
  const feedView = await loadFeedCardView({ accountId, clerkUserId: userId, isAgency, role: access.role, origin });
```

Replace the right column's lone `<EmbedSnippet … />` (`:220`) with:

```tsx
        <div className="space-y-6">
          <EmbedSnippet origin={origin} publicId={calendar.public_id} enabled={calendar.enabled} />
          <FeedCard
            view={feedView}
            locale={locale}
            pseudo={requestPseudoMode({ locale: localeParam })}
            make={makeFeedLinkAction.bind(null, accountId)}
            replace={replaceFeedLinkAction.bind(null, accountId)}
            turnOff={turnOffFeedLinkAction.bind(null, accountId)}
            undo={undoFeedLinkAction.bind(null, accountId)}
          />
        </div>
```

- [ ] **Step 9: `page.test.ts`.** Add, beside the other stubs (`:12-31`):

```ts
const feedCardMock = vi.fn((_props: unknown) => null);
vi.mock("./feed-card", () => ({ FeedCard: (props: unknown) => feedCardMock(props) }));
const feedViewMock = vi.hoisted(() => vi.fn(async (_a: unknown) => ({ kind: "none" as const })));
vi.mock("./feed-card-data", () => ({ loadFeedCardView: (a: unknown) => feedViewMock(a) }));
vi.mock("./feed-actions", () => ({
  makeFeedLinkAction: vi.fn(), replaceFeedLinkAction: vi.fn(), turnOffFeedLinkAction: vi.fn(), undoFeedLinkAction: vi.fn(),
}));
```

Add a new `describe("CalendarPage — the phone calendar card (F-048 part 2)")` with three cases:
1. Every role renders it once: Owner, Staff, Technician and agency, in a loop over `authState`.
2. `loadFeedCardView` receives the ROUTE's accountId and `clerkUserId: "user_1"`, and `renderForAccount("a2")` passes `"a2"`. This is the second-account case (mutation: pass a fixed id → FAILS).
3. The view it returns is the view the card gets.

`feedCardMock.mockClear()` and `feedViewMock.mockClear()` go in the existing `beforeEach`.

- [ ] **Step 9b: `read-only.test.ts` (review I3).** Add to `READ_ONLY_ALLOWED` (`:148`), each key exactly `file#function`:

```ts
  "app/(dashboard)/dashboard/accounts/[accountId]/calendar/feed-actions.ts#turnOffFeedLinkAction":
    "turning off the person's own calendar link: protective, a leaked link must be closable while paused",
  "app/(dashboard)/dashboard/accounts/[accountId]/calendar/feed-actions.ts#replaceFeedLinkAction":
    "replacing the person's own calendar link: protective, it ends a leaked link and issues its successor",
  "app/(dashboard)/dashboard/accounts/[accountId]/calendar/feed-actions.ts#undoFeedLinkAction":
    "the Undo of a turn-off or a replace, inside 30 seconds: restores exactly the link the person just had",
```

`makeFeedLinkAction` is NOT added: it stays refused during a pause. `feed-actions.test.ts` gains one case: the three protective actions call `requireAccountAccess` with `{ duringPause: "allow" }`, and `makeFeedLinkAction` with no option (mutation: drop the option from `turnOffFeedLinkAction` → FAILS here, and `read-only.test.ts`'s `THE ALLOW-LIST…` fails by name too).

- [ ] **Step 10: `in-account-service-reads.test.ts`.** Add, in path order, next to `:75-81`:

```ts
  "app/(dashboard)/dashboard/accounts/[accountId]/calendar/feed-actions.ts": "proven-target",
  "app/(dashboard)/dashboard/accounts/[accountId]/calendar/feed-card-data.ts": "proven-target",
```

Then check that `feed-card.tsx` and `feed-card-handlers.ts` name no service getter. They must not appear in the test's failure list.

- [ ] **Step 11: Run green.** Run the Step 3 command, plus `…/calendar/page.test.ts`, `…/[accountId]/in-account-service-reads.test.ts`, `src/lib/messages.test.ts`, `src/lib/i18n/ratchet.test.ts`, `src/lib/billing/read-only.test.ts` and `src/lib/palette/registry.test.ts`. Expected: all pass; paste each summary. Then `pnpm --filter web typecheck`.

- [ ] **Step 12: Commit.** `git add` every file in this task's Files list by explicit path, then `git commit -m "feat(booking): the Bookings on your phone card, make, copy, replace and turn off with Undo, in English and Spanish (F-048 part 2)"`

**Bare `vi.mock("@bis/db", () => ({` factories that importers rely on:** `page.tsx` is the only existing importer that gains new imports, and `page.test.ts:69` uses `importOriginal` (not bare) and now mocks all three new modules. The bare factories in this directory (`cancel-notice.test.ts`, from `grep -rln 'vi.mock("@bis/db", () => ({' "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calendar"`) belong to modules that import none of the new names. Re-run that grep after the change and confirm it still lists only `cancel-notice.test.ts`.

**Local tests to run:** the Step 11 list, nothing else.

**Mutation probes:**

| # | Change (line) | Turns red | Why it can fail |
|---|---|---|---|
| M1 | `feed-card-data.ts`: delete `if (!userId) return { kind: "error" };` and use `a.clerkUserId` as the user id | case 3 (second account) | `readLiveCalendarFeed` is then reached for a non-member. |
| M2 | `feed-card-data.ts`: delete the hash comparison | case 6 (`stale`) | A mismatched row then reads `live`. |
| M3 | `feed-actions.ts` make: `tokenHash: feedTokenHash(feedToken(id))` → `feedTokenHash(id)` | actions case 1 | The stored hash no longer matches the derived token's. |
| M4 | `feed-actions.ts` undo: `userId: who.personId` → `userId: undo.feedId` | actions case 5 | The assertion on the caller's `userId` fails. |
| M5 | `feed-card.tsx`: give **Make a new link** `variant="default"` | the `feed-card.test.ts` case "exactly ONE primary" for `live` | Two `data-variant="default"`. |
| M6 | `page.tsx`: `loadFeedCardView({ accountId: "a1", … })` (a literal) | page case 2 | `renderForAccount("a2")` still passes `"a1"`. |
| M7 | `messages.ts`: delete `calendar.feed.copy.es` | `lib/i18n/ratchet.test.ts:183` `every catalogue key added from today has a Spanish twin unless it is agency-only…` | It names the key with no twin. The `feed-card.test.ts` Spanish render fails too (`Copy link` appears under `es`). |
| M8 | `feed-actions.ts`: in `turnOffFeedLinkAction`, `requireAccountAccess(accountId, { duringPause: "allow" })` → `requireAccountAccess(accountId)` | `read-only.test.ts:284` (`:276` when the plan was written, before T5's three entries) `THE ALLOW-LIST: the set of (file, function) passing \`duringPause: "allow"\` equals READ_ONLY_ALLOWED…` | The allowed key then has no opt-out in its body, so the scanned set loses it and no longer equals the list. |
| M9 | `feed-actions.ts`: add `revalidatePath(\`/dashboard/accounts/${accountId}/calendar\`);` before `turnOffFeedLinkAction`'s return | `read-only.test.ts:313` (was `:305`) `no allowed action revalidates…` | Its body regex finds `revalidatePath(`. |
| M10 | `feed-card.tsx`: `import type { FeedCardView }` → `import { FeedCardView }` (with `isolatedModules` off this still compiles) | the review-M9 case in `feed-card.test.ts` | The source regex for a non-type import then matches. |
| M11 | `registry.ts:74`: drop `"subscribe"` | the new `registry.test.ts` case | `toContain("subscribe")` fails. |

---

### Task 6: e2e on the per-run fixture account

**Tier:** medium · **Owner:** bis-e2e-qa · **Wave:** 4 (after 0104 is on bis-ci, checklist step 2)

**Files:**
- Create: `apps/web/e2e/calendar-feed.spec.ts`
- Modify: `apps/web/playwright.config.ts:133-140` and `:264` (a `CALENDAR_FEED_FIXTURE`, the `DOCUMENT_LINK_FIXTURE` shape)

- [ ] **Step 1: Config.** Add `const CALENDAR_FEED_FIXTURE = "bis_e2e_calendar_feed_fixture_only_00000000000";` (at least 32 characters, not a secret) and set `process.env.CALENDAR_FEED_SECRET = CALENDAR_FEED_FIXTURE;` beside `:140`. Add `CALENDAR_FEED_SECRET: CALENDAR_FEED_FIXTURE,` to the webServer env beside `:264`.
- [ ] **Step 2: Spec.** Run it on the PER-RUN FIXTURE ACCOUNT only (read `openFixtureCalendar` in `e2e/support` and the fixture helpers before writing; never `Test Client One`). As the fixture Owner:
  1. Create one booking 2 days ahead with `createBooking` (`@bis/db`, the way `booking.spec.ts:3` imports).
  2. Open the Calendar page and click **Make my link**. The card shows the link field.
  3. `request.get(<field value>)` returns 200, `text/calendar`, a body containing `BEGIN:VCALENDAR` and the booking customer's first name, and no last name.
  4. Click **Turn off**. The same GET is now 404.
  5. Click the toast's **Undo** within 30 s. The GET is 200 again.
  6. Click **Make a new link**. The old URL is 404 and the new field value is 200.
  7. Check the Spanish render (`?locale=es`) for the card title.
  Clean up the booking in a `finally`.
- [ ] **Step 3: Run.** bis-e2e-qa runs it under the orchestrator's gate discipline (one gate at a time).
- [ ] **Step 4: Commit.** `git add apps/web/e2e/calendar-feed.spec.ts apps/web/playwright.config.ts && git commit -m "test(e2e): the calendar feed end to end on the fixture account (F-048 part 2)"`

**Mutation probe:** temporarily make the route's `not_found` path return 200 (`route.ts`, `NOT_FOUND`) and confirm step 4 fails by name. Revert.

---

## Orchestrator checklist (in order)

1. **0103 first, everywhere.** Contacts archive (#302) is MERGED to `main`, and its 0103 is applied to bis-ci AND to production, before 0104 goes to production. Before the bis-ci push below, merge `main` into `feat/calendar-feed` (merge, never rebase or force-push): this branch predates 0103, and bis-ci's push refuses a branch that is missing a migration already in the remote history, which happened today (review M2).
2. **0104 to bis-ci.** Dispatch `ci-project-setup.yml` (push-dry-run, then push) from `feat/calendar-feed` after T1 merges into the branch. The e2e job's `ci-migrations-applied.sh` fails, naming 0104, until this is done.
3. **0104 to production.** MCP `apply_migration` once, name `calendar_feeds`, with the file's exact text (ASCII only, no backslash, so the `\u` escape trap does not apply).
4. **Parity check** (`docs/runbooks/ci-supabase-project.md`): `calendar_feeds`' columns, the four functions' `pg_get_functiondef` md5 and the grants match between bis-ci and production.
5. **`CALENDAR_FEED_SECRET`: the owner sets it (exact steps):**
   1. On your computer, run `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` and copy the 43-character line it prints.
   2. Open vercel.com, then the **bis-platform** project (`prj_JAfRdX8D…`), then **Settings**, then **Environment Variables**.
   3. Click **Add New**. Key: `CALENDAR_FEED_SECRET`. Value: the line from step 1. Environments: tick **Production** only. Mark it **Sensitive**. Click **Save**.
   4. Run the command from step 1 AGAIN for a different value, and add `CALENDAR_FEED_SECRET` a second time with Environments **Preview** only. The two must differ.
   5. Redeploy the latest Production deployment (Deployments, then ⋯, then **Redeploy**). An environment change reaches only new deployments. Do the same for the latest Preview deployment of `feat/calendar-feed` (or push a commit), or Preview keeps showing "not available yet".
   6. On Preview, a phone or calendar app CANNOT subscribe: Preview sits behind Vercel Authentication, so an iPhone, Google or Outlook fetch gets a 401, and only a signed-in browser opens the link. Test a real subscription on Production. Preview proves only that the card makes, copies and turns off a link, and that a browser download works (review M8).
   7. Never paste either value into chat, a file or a ticket. Rotating it later does not end anyone's link; it makes each card ask that person to make a new one.
6. **`.env.example`** (bis-platform lands it), after the `DOCUMENT_LINK_SECRET=` line (`:378`):
   ```
   # Calendar feed links (F-048 part 2). REQUIRED for the Calendar page's "Bookings on your phone" card:
   # a fresh random value of at least 32 characters, different in Production and Preview; no fallback.
   # Rotating it ends no link (they are looked up by hash); each person's card then asks for a new one.
   # To end every link at once: update calendar_feeds set revoked_at = now() where revoked_at is null;
   CALENDAR_FEED_SECRET=
   ```
7. **PR** from `feat/calendar-feed` to `main`, squash-merge only after `verify` and `e2e` are green FOR THE HEAD SHA (`gh api repos/:owner/:repo/commits/<sha>/check-runs`).
8. Optional, later: a Vercel Firewall rate rule on `/cal/` if unknown-token traffic is ever seen (spec §3.2).

## Self-review (done while writing)

- **Spec coverage:** token model §2 → T1 and T2; route §3 → T4; content §4 → T2 and T3; UI §5.1–5.2 → T5; last checked §5.3 → T1 (the stamp) and T5 (the line); tests §6 rows 1–18 → T1 P1–P7, T2, T3, T4, T5 and T6. Two items have no test: User-Agent naming (deferred by the spec) and timing equality of 404s (the spec asks for identical answers, not identical timing).
- **Probes checked for "can it fail":** T1 M2, T2 M8 and T3 M5 could NOT fail as first written; each names its substitute. T2 M4 needs the Map-to-array mutation to be meaningful, and says so. T4 M5 and T2 M2 also turn other tests red; they still turn the named test red.
- **Names used across tasks:** `FeedContentRow` (T2) and `FeedBookingRow` (T3) have the same fields. `claimCalendarFeedFetch`, `listFeedBookings`, `readLiveCalendarFeed`, `createCalendarFeed`, `replaceCalendarFeed`, `revokeCalendarFeed`, `restoreCalendarFeed` and `CALENDAR_FEED_UNDO_SECONDS` are spelled identically in T3, T4 and T5. `feedToken`/`feedTokenHash`/`feedUrl`/`webcalUrl`/`feedSecretConfigured`/`feedTokenFromFile` are identical in T2, T4 and T5.
