-- 0084_document_expiry_tasks.sql - the document vault, part 3a: expiry To-dos and the Documents page
-- (docs/superpowers/specs/2026-10-17-document-vault-part3-design.md sections 3.2 and 3.4;
--  docs/superpowers/plans/2026-10-17-document-vault-pr3a.md)
--
-- Thirty days before a file's expiry, the documentsExpiry cron pass opens ONE To-do on its record.
-- The To-do names the document and the expiry date it was opened for (tasks.document_expiry_id,
-- tasks.document_expiry_on): one per document AND date (tasks_document_expiry_once), so a renewed
-- file with a new date gets its own To-do, and the pass relies on 23505 to dedupe, as the request
-- To-do does (0080). The link is same-account (the composite FK) and goes with the document when the
-- document is purged (on delete cascade: the sweep and the contact purge delete document rows, and
-- NO ACTION would refuse every such purge; plan deviation 2). Only server code sets the two columns:
-- 0080's keep_task_links is re-created with them (create or replace keeps its ACL and the
-- tasks_keep_links trigger), so a signed-in insert stores NULL and a signed-in update keeps them.
-- Three documents indexes serve the Documents page's expiry filters, the pass's cross-account window
-- and the page's All filter (plan deviation 4). No new table, no new grant: tasks keeps its
-- table-wide client grants and its policies.
--
-- APPLY ORDER: CI project (ci-project-setup.yml: push-dry-run, then push), then production (MCP
-- apply_migration, once), then the parity check, then merge. Additive for the build before it, which
-- never sends the two columns. The build after it needs them (the pass inserts them): the migration
-- goes BEFORE the code deploy.
--
-- Rollback (by hand, in this order; revert the app first):
--   re-create 0080's app.keep_task_links() exactly (FIRST: the function names the two columns, and
--     every task insert would fail once they are gone);
--   drop index public.documents_live_by_created;
--   drop index public.documents_expiry_window;
--   drop index public.documents_by_expiry;
--   drop index public.tasks_document_expiry_once;
--   alter table public.tasks drop constraint tasks_document_expiry_coherent,
--     drop constraint tasks_document_expiry_fkey, drop column document_expiry_on, drop column document_expiry_id;
--   Lost: every expiry To-do's link (the To-dos themselves stay, as plain To-dos).
--
-- ASCII only, no backslash anywhere.

-- 0. Fail fast instead of queueing behind a long lock on tasks or documents.
set local lock_timeout = '5s';

-- 1. The expiry To-do's link.
alter table public.tasks
  add column document_expiry_id uuid,
  add column document_expiry_on date;
alter table public.tasks add constraint tasks_document_expiry_fkey
  foreign key (account_id, document_expiry_id) references public.documents (account_id, id)
  on delete cascade;
alter table public.tasks add constraint tasks_document_expiry_coherent
  check ((document_expiry_id is null) = (document_expiry_on is null));
create unique index tasks_document_expiry_once on public.tasks (document_expiry_id, document_expiry_on)
  where document_expiry_id is not null;

-- 2. Only server code sets or changes a To-do's links (0074's guard, extended by 0080, now by 0084).
create or replace function app.keep_task_links() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_user = 'authenticated', false) then
    if tg_op = 'INSERT' then
      new.call_id := null;
      new.consent_event_id := null;
      new.document_request_id := null;
      new.document_request_kind := null;
      new.document_expiry_id := null;
      new.document_expiry_on := null;
    else
      new.call_id := old.call_id;
      new.consent_event_id := old.consent_event_id;
      new.document_request_id := old.document_request_id;
      new.document_request_kind := old.document_request_kind;
      new.document_expiry_id := old.document_expiry_id;
      new.document_expiry_on := old.document_expiry_on;
    end if;
  end if;
  return new;
end $$;

-- 3. The Documents page's expiry filters (expires_on, then id for the cursor's tiebreak).
create index documents_by_expiry on public.documents (account_id, expires_on, id)
  where deleted_at is null and expires_on is not null;

-- 4. The pass's window, across every account (a leading account_id cannot serve it). No owners_only
--    clause: a parameterised owners_only test under a generic plan cannot match a partial predicate,
--    and the pass filters owners_only on the rows anyway.
create index documents_expiry_window on public.documents (expires_on)
  where deleted_at is null and expires_on is not null;

-- 5. The Documents page's All filter (0077 has no created_at index on documents).
create index documents_live_by_created on public.documents (account_id, created_at desc, id desc)
  where deleted_at is null;
