-- 0113_record_changes_enforce.sql - every change row names its author, and every server write must
-- (F-115 part 1 / S-04; docs/superpowers/specs/2026-11-02-record-history-design.md sections 2.3 and 4;
--  docs/superpowers/plans/2026-11-02-record-history.md, Task 7)
--
-- WHY. 0111 started the change log in observe mode: a server write that did not say who made it was still
-- recorded, with a NULL author, so a missed path could never break a live call. PR A and 0112 named every
-- author, CI's stacks have refused an unattributed write since 0111, and production has now gone 7 days
-- (2026-11-04 to 2026-11-10, read 2026-11-11 about 01:45Z) with 0 unattributed rows a day, with the
-- cron.pass.recordChangesAudit heartbeat green throughout (last ok 01:30Z, last_error_at NULL). So the log can
-- promise what the Provenance rule needs: every row has an author (a row with no mark is a defect), and a server
-- write that names no author is refused instead of recorded.
--
-- WHAT.
--   app.backfill_record_change_authors() -> table (bucket, row_count): NOT a definer, EXECUTE to nobody; 0073
--     and 0091's shape (a function the migration runs once and a test can run again). It touches only rows whose
--     author_kind is NULL, so a second run changes nothing.
--     1. A NULL row takes the author of ONE events row: the same account_id, payload contactId = the row's
--        record_id, created_at within 2 seconds either side (inclusive), the NEAREST such event (then the lowest
--        event id). Only contact rows can match:
--          op update <- a contact.updated event whose payload fields names the row's column. The writers emit
--            either the TypeScript name or the column (updateContact: Object.keys(ContactInput), contacts.ts:617;
--            fillContactBlanksReport and restoreContactFieldIf: the column, :752 and :801); the literal values
--            table below maps both. A custom key's row ('custom.<key>') matches the event's 'custom'.
--            Actor: user -> person (author_id = the actor id, trimmed; blank is no id), ai -> ai,
--            system -> automation.
--          op insert <- a contact.created event. Actor: app.contact_author (0091, contactAuthor's SQL twin,
--            provenance.ts:47): ai -> ai, a seed actor id -> import, user -> person, any other system -> customer.
--        Matched rows keep via as it was (NULL: observe mode wrote none with a NULL author).
--     2. Leftovers: every row still NULL becomes automation with via 'backfill:unknown' (author_id stays NULL).
--     Its buckets are raised as NOTICEs when it runs below; the leftover bucket is always named, even at 0.
--   alter table public.record_changes alter column author_kind set not null.
--   drop index public.record_changes_unattributed_idx: 0111 built it for the daily audit's count of NULL rows,
--     and promised this file would drop it; with NOT NULL there are none. (On PostgreSQL 17 the audit's
--     author_kind IS NULL filter on a NOT NULL column plans as a constant false: no scan at all.)
--   update app.record_changes_settings set enforce = true: every environment, bis-ci included. CI's stacks
--     already turn it on after migrating (.github/scripts/ci-local-supabase.sh); that line becomes a no-op.
--     The column default stays false: the table holds exactly one row (check (id), primary key), so the default
--     is never read.
--   app.record_changes_capture() is NOT changed: its step 6 already refuses an unattributed server write when
--     enforce is on (42501), and with enforce off its NULL now fails the column (23502). Either way the write
--     rolls back.
--
-- DRY RUN, production (checklist D1, read-only, 2026-11-11 about 01:45Z): public.record_changes holds 100 rows,
-- the first at 2026-11-04 20:45Z, 0 of them with a NULL author_kind. The backfill is a no-op there: every bucket
-- reads 0. bis-ci and local replicas may hold NULL rows (Vercel Preview runs bis-ci in observe mode); the
-- NOTICEs name them.
--
-- GRANTS. app.backfill_record_change_authors: everything revoked from public, anon, authenticated and
-- service_role. No table, sequence or policy grant moves: the client-write digest is unchanged, EXPECTED_WRITES is
-- unchanged, and EXPECTED_DEFINERS stays 39 (the backfill is an invoker).
--
-- SEARCH PATHS. The backfill says set search_path = pg_catalog, pg_temp, and names every relation and function by
-- schema (0096's rule); nullif and extract are syntax and take no schema.
--
-- LOCKS AND COST. The file runs as one transaction (section 0 refuses to go on otherwise); lock_timeout 5s bounds
-- only the WAIT for each lock. Section 0 takes ACCESS EXCLUSIVE on public.record_changes and holds it until the file
-- commits, so no other session can commit a NULL row between the backfill and the NOT NULL (the ALTER would then
-- fail), and the lock is never upgraded mid-file. While it is held, every audited write (a contact, household, member, place,
-- unit, deal, relationship or tag; its capture inserts a change row) and every read of the log (the timeline, the
-- history download, the audit pass) waits for the file. The backfill reads public.events (ACCESS SHARE: nothing
-- waits) through events_account_created (account_id, created_at desc), one range of 4 seconds per NULL row. The
-- set not null scans the whole table once under the same lock. Dropping the partial index and the one-row update
-- are instant.
-- MEASURED on a PostgreSQL 17.6 replica (pre = 0001-0112, laptop SSD, one account, a fresh database per run;
-- 100,000 NULL-author change rows, half of them with a matching contact.updated event, half leftovers):
--   the whole file: 4335 ms, the sum of its statements (backfill 4271 ms, set not null 34 ms), median of 3
--     (runs 4835, 4335, 3947 ms). An earlier set on the same seed, the lock then a bare statement and the work
--     otherwise identical, read 2945 ms (backfill 2891, set not null 25; runs 3177, 2900, 2945): the spread is the
--     laptop's load. The lock is held that long: about 0.03 to 0.05 ms per NULL row.
--   set not null alone over 100,000 rows that all have an author (production's shape: no NULL rows, so the
--     backfill finds nothing): 42.1 ms, median of 3 (92.9, 36.9, 42.1 ms; the earlier set 30.5 ms).
--   Production holds 100 rows today, none NULL: the lock is held for milliseconds.
--
-- LOAD-BEARING.
--   1. The ACCESS EXCLUSIVE lock comes before the backfill: without it a NULL row committed by another session
--      after the leftover update fails the set not null, and the whole file rolls back (safe, but it must be
--      re-run).
--   2. The leftover update is what makes the set not null possible on a database with unmatched NULL rows.
--   3. Enforce on is permanent from here. A server write that names no author is refused (42501) in every
--      environment: a new writer must send x-bis-author (withAuthor), or run in a definer that sets bis.author
--      (0111 load-bearing 4 and 6), or be a direct session (automation/'sql').
--
-- ROLLBACK (revert the app first only if the app needs it; nothing in the app needs this file):
--   update app.record_changes_settings set enforce = false;
--   alter table public.record_changes alter column author_kind drop not null;
--   create index record_changes_unattributed_idx on public.record_changes (created_at) where author_kind is null;
--   drop function app.backfill_record_change_authors();
--   The backfilled marks stay: they are history (0111's rule).
--
-- ASCII only, no backslash anywhere, and every dollar sign in this file is part of a dollar-quote pair.

-- 0. One transaction, holding the lock, or nothing at all (0088's pattern). Fail fast instead of queueing behind a
--    long lock; then nothing writes or reads the log until this file commits (LOCKS AND COST; load-bearing 1). The
--    lock is taken INSIDE the do block: on PostgreSQL 17 a bare LOCK TABLE as a later statement of a multi-statement
--    string is not guaranteed to be inside a transaction block (0088:58-64). The second block proves the NEXT
--    statement is still that transaction and still holds the lock; a path that commits between statements
--    (autocommit) fails there, before any DDL.
do $$
begin
  perform pg_catalog.set_config('lock_timeout', '5s', true);
  perform pg_catalog.set_config('bis.m0113_xid', pg_catalog.txid_current()::text, true);
  lock table public.record_changes in access exclusive mode;
end $$;
do $$
begin
  if pg_catalog.current_setting('bis.m0113_xid', true) is distinct from pg_catalog.txid_current()::text
     or pg_catalog.current_setting('lock_timeout') <> '5s'
     or not exists (select 1 from pg_catalog.pg_locks l
                     where l.locktype = 'relation' and l.relation = 'public.record_changes'::regclass
                       and l.pid = pg_catalog.pg_backend_pid() and l.mode = 'AccessExclusiveLock' and l.granted) then
    raise exception '0113_not_one_transaction' using errcode = 'P0001';
  end if;
end $$;

-- 2. The backfill. Not a definer: the migration runs it as the table owner; no API role may.
create function app.backfill_record_change_authors() returns table (bucket text, row_count bigint)
language plpgsql set search_path = pg_catalog, pg_temp as $$
#variable_conflict use_column
begin
  return query
  with names (event_field, column_name) as (values
    ('firstName', 'first_name'), ('first_name', 'first_name'),
    ('lastName', 'last_name'), ('last_name', 'last_name'),
    ('email', 'email'), ('phone', 'phone'), ('source', 'source'), ('custom', 'custom')
  ), pick as (
    select r.id, ev.type, ev.kind, ev.actor_id
      from public.record_changes r
      cross join lateral (
        select e.type, e.actor_id,
               case when e.type = 'contact.created' then app.contact_author(e.actor_type, e.actor_id)
                    when e.actor_type = 'user' then 'person'
                    when e.actor_type = 'ai' then 'ai'
                    else 'automation' end as kind
          from public.events e
         where e.account_id = r.account_id
           and e.created_at between r.created_at - interval '2 seconds' and r.created_at + interval '2 seconds'
           and e.payload ->> 'contactId' = r.record_id::text
           and ((r.op = 'update' and e.type = 'contact.updated'
                 and exists (select 1 from names n
                              where n.column_name = pg_catalog.split_part(r.field, '.', 1)
                                and (e.payload -> 'fields') @> pg_catalog.jsonb_build_array(n.event_field)))
             or (r.op = 'insert' and e.type = 'contact.created'))
         order by pg_catalog.abs(extract(epoch from (e.created_at - r.created_at))), e.id
         limit 1
      ) ev
     where r.author_kind is null and r.record_type = 'contact'
  ), done as (
    update public.record_changes r
       set author_kind = p.kind,
           author_id = case when p.kind = 'person' then nullif(pg_catalog.btrim(p.actor_id), '') end
      from pick p
     where r.id = p.id and r.author_kind is null
    returning p.type, r.author_kind
  )
  select d.type || ' ' || d.author_kind, pg_catalog.count(*) from done d group by 1;

  return query
  with done as (
    update public.record_changes r
       set author_kind = 'automation', via = 'backfill:unknown'
     where r.author_kind is null
    returning r.id
  )
  select 'leftover automation backfill:unknown'::text, pg_catalog.count(*) from done;
end $$;
revoke all on function app.backfill_record_change_authors() from public, anon, authenticated, service_role;

do $$
declare r record;
begin
  for r in select * from app.backfill_record_change_authors() loop
    raise notice 'record_changes authors backfill (0113): % = %', r.bucket, r.row_count;
  end loop;
end $$;

-- 3. Every row names its author.
alter table public.record_changes alter column author_kind set not null;
drop index public.record_changes_unattributed_idx;

-- 4. Every server write must.
update app.record_changes_settings set enforce = true;
