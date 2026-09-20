-- One row per Realtime session this platform agreed to mint for a browser.
--
-- WHY THIS EXISTS. `api/voice/web/session` mints an OpenAI ephemeral client
-- secret and hands it to the visitor's browser, which then talks to OpenAI
-- DIRECTLY over WebRTC. This server is never in the media loop again, so it
-- cannot end that session — and OpenAI exposes no server-side session
-- lifetime parameter (verified 2026-09-20), so nothing else ends it either.
-- Before this table there was also no RECORD that a session happened: no
-- `calls` row, no counter, only a console.log. So an abandoned tab, a
-- replayed ticket or a scripted client could bill indefinitely and nobody
-- could tell. This table is what makes the one thing this server still
-- controls — HOW MANY sessions it agrees to mint — measurable and capped.
--
-- WHY THIS IS NOT A `calls` ROW. `calls` feeds ANSWERED_OUTCOMES and the
-- weekly report's "calls answered", a number a client reads on Monday
-- morning. A browser session is not a call and must never inflate it. Same
-- refusal, for the same reason, as 0039_screened_calls.sql and
-- 0040_call_proposals.sql.
create table public.voice_web_sessions (
  id uuid primary key default gen_random_uuid(),
  -- The tenant whose Sofía answered. Cascade so an account teardown carries
  -- these away, like call_proposals.
  account_id uuid not null references public.accounts(id) on delete cascade,
  -- THE REPLAY STORE. web-demo.ts's ticket was documented as "not
  -- single-use, because there is no shared replay store in this deployment".
  -- There is one now: this column, unique, is it. A replayed ticket inside
  -- its 120s window hits this constraint instead of minting a second
  -- session.
  ticket_nonce text not null,
  -- HMAC-keyed, never the raw address (forms/guards.ts's hashIp). 32 hex
  -- chars.
  ip_hash text not null,
  -- Which allowlisted site vouched for this visitor. Nullable because the
  -- Origin header is a browser courtesy, not a guarantee.
  origin text,
  created_at timestamptz not null default now()
);

-- Single-use tickets, enforced by the database rather than by a check the
-- route could race against itself.
create unique index voice_web_sessions_nonce_key
  on public.voice_web_sessions (ticket_nonce);

-- The two counters the route reads before minting.
create index voice_web_sessions_ip_idx
  on public.voice_web_sessions (ip_hash, created_at desc);
create index voice_web_sessions_account_idx
  on public.voice_web_sessions (account_id, created_at desc);

alter table public.voice_web_sessions enable row level security;

-- ⚠️ THE GRANTS ARE THE SECURITY BOUNDARY HERE, NOT THE POLICY.
-- This project's default ACL auto-grants ALL privileges to `anon` AND
-- `authenticated` on every new table (0020_voice_grants_revoke.sql exists
-- because of exactly this; 0033 shipped without a grant block and still
-- carries INSERT/UPDATE/DELETE to `anon`). Revoke everything, then grant
-- back only what is needed.
--
-- Nothing but the route reads or writes this, and the route uses
-- serviceDb(). So: service_role only, no `authenticated` grant at all —
-- the same shape as screened_calls, and narrower than call_proposals,
-- which a human reviews in the UI. No policy is needed for service_role
-- (it bypasses RLS); RLS is enabled anyway so the table is never
-- accidentally world-readable if a grant is ever widened.
revoke all on public.voice_web_sessions from anon, authenticated;
grant select, insert, update, delete on public.voice_web_sessions to service_role;
