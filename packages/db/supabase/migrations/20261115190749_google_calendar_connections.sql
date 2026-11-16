-- Append-only: once this migration has reached bis-ci it is never edited. A fix is a new migration
-- (pnpm --filter @bis/db migration:new <slug>). docs/runbooks/ci-supabase-project.md, section 6.
--
-- google_calendar_connections: an account's link to its owner's Google Calendar (S-22 slice 1, PR 1).
-- docs/superpowers/plans/2026-11-15-google-busy-blocks-slots.md, sections 1 (D3, D5, D6, D12) and 2.
--
-- WHAT. One row per account (account_id unique): the Google account it reads (google_email, the scope
-- Google granted), the refresh token SEALED by the app (AES-256-GCM under GOOGLE_CALENDAR_TOKEN_KEY, which
-- never reaches the database; apps/web/src/lib/google/token-seal.ts), and the health of the link (status,
-- needs_reconnect_since, the reconnect To-do). `version` is bumped on every connect; the sealed token's
-- additional data names account_id, id and version, so a ciphertext copied onto another row, or kept from
-- an older connect, does not open. The app mints `id` before sealing, so it has no default (0104's reason).
--
-- CHECKS. status is 'connected' or 'needs_reconnect', and needs_reconnect_since is set exactly when it is
-- 'needs_reconnect' (the pair check). refresh_token_sealed must look sealed: "g<format>." then base64url,
-- at most 4096 characters. A Google refresh token in the clear ("1//0g...") holds slashes and is refused,
-- so a missed seal fails the write instead of storing a usable credential.
--
-- FOREIGN KEYS. account_id cascades (a token is not a lead, so not 0017's restrict); connected_by and
-- reconnect_task_id are set null (the agency may connect, D3, so not 0104's memberships key; a deleted
-- To-do leaves the link). Neither has an index: the table holds at most one row per account, so the scan
-- a users or tasks delete makes here is over that many rows.
--
-- WHO READS AND WRITES. Server code only (0104's pattern, D6): RLS on with no policy, every client
-- privilege revoked, service_role alone holds the table. Its UPDATE is column-level, every column but id
-- and account_id, so no server write can move a connection to another account.
--
-- GRANTS. The default ACL hands ALL (MAINTAIN included) on a new table to anon, authenticated and
-- service_role by name, so the table's privileges are revoked from all three and PUBLIC, then service_role
-- gets back SELECT, INSERT, DELETE and UPDATE on the twelve updatable columns (0054's
-- revoke-all-then-grant-back). No function is added.
--
-- LOCKS AND COST. A new, empty table. Its three foreign keys take SHARE ROW EXCLUSIVE on public.accounts,
-- public.users and public.tasks for the rest of the transaction, which blocks writes to them for the few
-- milliseconds this file runs; lock_timeout 5s bounds the wait to take them.
--
-- APPLY ORDER. bis-ci (CI, once the PR is ready), then production (CI, after danlo's approval), then the
-- parity check. Additive: nothing reads the table before the code that does, which ships inert.
--
-- Rollback (by hand, app reverted first):
--   drop table public.google_calendar_connections;
--
-- ASCII only, no backslash anywhere.

-- Fail fast instead of queueing behind a lock (0104's form: inside a do block, so it is always in the
-- block's transaction).
do $$
begin
  perform pg_catalog.set_config('lock_timeout', '5s', true);
end $$;

create table public.google_calendar_connections (
  id uuid primary key,
  account_id uuid not null
    constraint google_calendar_connections_account_id_key unique
    constraint google_calendar_connections_account_id_fkey references public.accounts (id) on delete cascade,
  version integer not null default 1
    constraint google_calendar_connections_version_check check (version >= 1),
  google_email text not null
    constraint google_calendar_connections_google_email_check check (btrim(google_email) <> ''),
  scope text not null
    constraint google_calendar_connections_scope_check check (btrim(scope) <> ''),
  status text not null
    constraint google_calendar_connections_status_check check (status in ('connected', 'needs_reconnect')),
  refresh_token_sealed text not null
    constraint google_calendar_connections_refresh_token_sealed_check
      check (char_length(refresh_token_sealed) <= 4096 and refresh_token_sealed ~ '^g[0-9]+[.][A-Za-z0-9_-]+$'),
  key_version smallint not null
    constraint google_calendar_connections_key_version_check check (key_version >= 1),
  refresh_expires_at timestamptz,
  connected_by uuid
    constraint google_calendar_connections_connected_by_fkey references public.users (id) on delete set null,
  connected_at timestamptz not null default now(),
  last_checked_at timestamptz,
  needs_reconnect_since timestamptz,
  reconnect_task_id uuid
    constraint google_calendar_connections_reconnect_task_id_fkey references public.tasks (id) on delete set null,
  constraint google_calendar_connections_reconnect_pair_check
    check ((status = 'needs_reconnect') = (needs_reconnect_since is not null))
);
comment on table public.google_calendar_connections is
  'An account''s link to its owner''s Google Calendar (S-22). The refresh token is sealed by the app under a '
  'key the database never holds. Server-written and server-read only.';

alter table public.google_calendar_connections enable row level security;
-- No policy: RLS on with none refuses every row to every role that does not bypass it, and the grants below
-- refuse anon and authenticated outright.
revoke all on public.google_calendar_connections from public, anon, authenticated, service_role;
grant select, insert, delete on public.google_calendar_connections to service_role;
grant update (version, google_email, scope, status, refresh_token_sealed, key_version, refresh_expires_at,
  connected_by, connected_at, last_checked_at, needs_reconnect_since, reconnect_task_id)
  on public.google_calendar_connections to service_role;
