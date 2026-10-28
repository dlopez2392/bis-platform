-- 0104_calendar_feeds.sql - the owner's calendar feed (F-048 part 2)
-- (docs/superpowers/specs/2026-10-28-calendar-feed-design.md sections 2 and 3;
--  docs/superpowers/plans/2026-10-28-calendar-feed.md, Task 1)
--
-- WHAT. public.calendar_feeds: one row per private calendar link a person made for one account. The app
-- mints the id, derives the token from it under CALENDAR_FEED_SECRET (HMAC-SHA256, base64url, 43 chars),
-- and stores only sha256(token) (token_hash). One LIVE row per person per account (calendar_feeds_one_live).
-- The composite FK to memberships (account_id, user_id) (0066's memberships_account_user_key) cascades:
-- a person removed from the team, a deleted user and a deleted account take every link with them.
-- Four functions, EXECUTE service_role only:
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
-- SECURITY INVOKER AND SEARCH PATHS. All four functions are SECURITY INVOKER with
-- set search_path = pg_catalog, pg_temp (0096's rule for every later migration; 0102's shape for
-- service_role-only functions): only service_role may execute them, and it already holds what they touch
-- (this file's grants on calendar_feeds; SELECT on memberships, accounts and users) and bypasses RLS, so a
-- definer would add privilege and nothing else (0057's reasoning). No definer is added, so EXPECTED_DEFINERS
-- in definer-search-path.test.ts does not change (23). Every name in every body is schema-qualified.
-- The claim's policy-like checks coalesce their NULLs to a refusal (the plpgsql NULL-guard lesson).
--
-- GRANTS. The default ACL hands ALL (MAINTAIN included) on a new table to anon, authenticated and
-- service_role by name, so the table's privileges are revoked from all three and service_role gets back
-- SELECT, INSERT, UPDATE and DELETE (0054's revoke-all-then-grant-back, as 0102). Each function: EXECUTE
-- revoked from public, anon, authenticated and service_role by name (0043's lesson), then granted to
-- service_role.
--
-- LOCKS AND COST. A new, empty table. The composite FK takes SHARE ROW EXCLUSIVE on public.memberships for
-- the rest of the transaction, which blocks membership writes (invites, role changes, removals) for the
-- few milliseconds this file runs; lock_timeout 5s bounds the wait to take it.
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

-- 0. Fail fast instead of queueing behind a lock (0091's reason: inside a do block, so it is always in the
--    block transaction).
do $$
begin
  perform pg_catalog.set_config('lock_timeout', '5s', true);
end $$;

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
-- No policy: RLS on with none refuses every row to every role that does not bypass it, and the grants below
-- refuse anon and authenticated outright.
revoke all on public.calendar_feeds from anon, authenticated, service_role;
grant select, insert, update, delete on public.calendar_feeds to service_role;

create function public.claim_calendar_feed_fetch(p_token_hash text, p_max integer, p_window_seconds integer)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, pg_temp as $$
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
returns jsonb language plpgsql security invoker set search_path = pg_catalog, pg_temp as $$
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
returns text language plpgsql security invoker set search_path = pg_catalog, pg_temp as $$
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
returns jsonb language plpgsql security invoker set search_path = pg_catalog, pg_temp as $$
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

-- Default privileges hand EXECUTE to anon, authenticated and service_role BY NAME, so revoking from PUBLIC
-- alone would leave them (0043's lesson).
revoke all on function public.revoke_calendar_feed(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.claim_calendar_feed_fetch(text, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.replace_calendar_feed(uuid, uuid, uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.restore_calendar_feed(uuid, uuid, uuid, timestamptz, uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.claim_calendar_feed_fetch(text, integer, integer) to service_role;
grant execute on function public.replace_calendar_feed(uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.restore_calendar_feed(uuid, uuid, uuid, timestamptz, uuid, integer) to service_role;
grant execute on function public.revoke_calendar_feed(uuid, uuid) to service_role;
