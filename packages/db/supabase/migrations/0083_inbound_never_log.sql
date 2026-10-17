-- 0083_inbound_never_log.sql - inbound email, part 2: the Never record list
-- (docs/superpowers/specs/2026-10-17-forward-to-record-design.md "Data model";
--  docs/superpowers/plans/2026-10-17-forward-to-record.md)
--
-- Each account keeps a list of addresses and whole domains whose mail is dropped by the inbound
-- pipeline before anything is stored, even when the sender is a customer. An address entry is the
-- sender's email key (lowercase, +tag stripped, the app's emailKey); a domain entry matches that
-- domain and every subdomain of it (the app's neverLogMatches). The agency edits it on Settings, an
-- Owner on Branding; both go through server actions on the service client (0053: server-only
-- writes). Members of the account read it, the agency every account's, a Technician none (plan G7:
-- staff can read it here; no page shows it to them).
-- One unique (account_id, pattern) index; it leads with account_id, so it serves every per-account
-- read and no second index is made (plan G17).
--
-- APPLY ORDER: CI project (ci-project-setup.yml: push-dry-run, then push), then production (MCP
-- apply_migration, once), then the parity check, then merge. Purely additive: safe for the build
-- before it, which never reads this table. The app that reads it must not run before this file
-- (every inbound email would answer 503 on the list read).
--
-- Rollback (by hand; revert the app first): drop table public.inbound_never_log;
--   Lost: every account's Never record entries.
--
-- ASCII only, no backslash anywhere.

-- 0. Fail fast instead of queueing behind a long lock.
set local lock_timeout = '5s';

-- 1. The table.
create table public.inbound_never_log (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  pattern text not null,
  kind text not null,
  added_by text not null,
  created_at timestamptz not null default now(),
  constraint inbound_never_log_account_pattern_key unique (account_id, pattern),
  constraint inbound_never_log_kind_check check (kind in ('address', 'domain')),
  constraint inbound_never_log_pattern_check check (
    pattern = lower(pattern)
    and char_length(pattern) <= 254
    and (
      (kind = 'address'
        and pattern ~ '^[a-z0-9.!#$%&''*/=?^_`{|}~-]+@([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?[.])+[a-z]{2,63}$')
      or (kind = 'domain'
        and pattern ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?[.])+[a-z]{2,63}$')))
);

-- 2. Who reads it. Server-written only (0053).
alter table public.inbound_never_log enable row level security;
create policy inbound_never_log_member_read on public.inbound_never_log for select to authenticated
  using (coalesce(app.is_agency(), false) or account_id = app.current_account_id());
create policy inbound_never_log_no_technician on public.inbound_never_log as restrictive for select to authenticated
  using (coalesce(app.sees_all_customers(account_id), false));
revoke all on public.inbound_never_log from anon, authenticated;
grant select on public.inbound_never_log to authenticated;
grant select, insert, update, delete on public.inbound_never_log to service_role;

-- 3. deleteContacts' empty-conversation cleanup (owner ruling 2026-10-17, amending G15 before
--    apply): a conversation with no message and no inbound email must not block deleting its
--    contact, and the check-then-delete must be ONE statement, or a row written between the two
--    (a 1001st message past PostgREST's max_rows=1000, or a held email landing in the gap) is
--    either misjudged empty or silently lost. messages.conversation_id has no ON DELETE action
--    (NO ACTION/RESTRICT), so a conversation that still has one is never touched by this delete,
--    not even partially. inbound_emails.conversation_id IS ON DELETE CASCADE (0082:93-94), which
--    is exactly why a row landing in a check-then-delete GAP was unsafe; inside one statement
--    there is no gap. calls.conversation_id is ON DELETE SET NULL (0019:49): a call never blocks
--    and never stops a conversation from being judged empty.
--    Scoped by account_id and the caller's already-proven contact ids; never called with a
--    bare id. Service role only: no client ever deletes a conversation (0053).
create function public.delete_empty_conversations(p_account_id uuid, p_contact_ids uuid[])
returns table(id uuid)
language sql
security invoker
set search_path = ''
as $$
  delete from public.conversations c
   where c.account_id = p_account_id
     and c.contact_id = any(p_contact_ids)
     and not exists (
       select 1 from public.messages m
        where m.account_id = p_account_id and m.conversation_id = c.id)
     and not exists (
       select 1 from public.inbound_emails e
        where e.account_id = p_account_id and e.conversation_id = c.id)
  returning c.id;
$$;
comment on function public.delete_empty_conversations(uuid, uuid[]) is
  'deleteContacts'' empty-conversation cleanup (S-06 part 2, owner ruling 2026-10-17): deletes, in one
   statement, the conversations of the given contacts in the given account that have no message and
   no inbound email, returning the deleted ids. Service role only.';
revoke all on function public.delete_empty_conversations(uuid, uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.delete_empty_conversations(uuid, uuid[]) to service_role;
