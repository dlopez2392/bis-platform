-- Append-only: once this migration has reached bis-ci it is never edited. A fix is a new migration
-- (pnpm --filter @bis/db migration:new <slug>). docs/runbooks/ci-supabase-project.md, section 6.
--
-- job_checkins: the customer's answer to "How did we do?" after a completed job, and the one To-do a "not great"
-- opens (F-072, PR 1 of docs/superpowers/plans/2026-11-17-review-requests.md, D2 and D3). Inert: nothing writes
-- or reads either until the page (plan PR 2) and the send (PR 3) ship.
--
-- WHAT.
--   public.job_checkins  one row per answered booking (job_checkins_booking_id_key): answer is great, okay or
--     not_great; answered_at; review_link_opened_at, the first press of the review button (D1). A row exists only
--     once the customer answered; "asked" stays bookings.review_requested_at, the one send stamp. First answer
--     wins: the server inserts with on conflict (booking_id) do nothing, and no role may UPDATE the answer.
--   public.bookings gains UNIQUE (account_id, id, contact_id), redundant as a rule (id is the key) but the target a
--     three-column key needs (0061 added (account_id, id) for the same reason).
--   public.tasks.review_checkin_id  the "not great" To-do's link, one To-do per check-in (tasks_review_checkin_once,
--     0084's 23505-means-already-there pattern), same account by its composite key, gone with its check-in.
--   app.keep_task_links  re-created from 0097's body (the latest; 0084's and 0080's are older and would drop
--     closure_kind and closure_on) with review_checkin_id added to both branches, so a signed-in client can neither
--     set nor change it. create or replace keeps its ACL, its owner and the tasks_keep_links trigger.
--
-- FOREIGN KEYS. job_checkins_booking_fkey is (account_id, booking_id, contact_id) onto the bookings key above, ON
--   UPDATE CASCADE ON DELETE CASCADE. Three columns, not two, so the row can point at no other account's booking
--   AND at no customer but its booking's own (bookings_contact_id_fkey makes that customer the same account's).
--   ON UPDATE CASCADE is how the check-in follows a contact merge and its Undo: merge_contacts and
--   undo_contact_merge move bookings.contact_id (c_moves), and the key carries the change here, so no merge
--   function is re-created and the guards that pin every key INTO contacts (ai-acts-schema.test.ts' 26 pairs,
--   contact-merge-schema.test.ts' table list) are unchanged: this table has no key into contacts of its own.
--   ON DELETE CASCADE because an answer is not a lead (0017's restrict is for lead-bearing rows; 0100's
--   booking_cancel_notices is the precedent): the only booking deletes are the teardown and the undo of an
--   unsettled staff job, which is never completed. account_id also cascades. tasks_review_checkin_fkey is
--   (account_id, review_checkin_id) onto job_checkins (account_id, id), ON DELETE CASCADE (0084's shape).
--
-- WHO READS AND WRITES. Every write is service_role's: the answer page acts on the service client scoped by its
--   signed token's account, after re-reading the booking (packages/db/src/job-checkins.ts). service_role holds
--   SELECT, INSERT, DELETE (teardown, fixtures, the sweep) and UPDATE on review_link_opened_at alone, so even the
--   server cannot rewrite an answer or move one to another booking or customer. Members of the account READ their
--   rows (the record timeline and the counts, PR 4): authenticated holds SELECT and nothing else; anon nothing.
--
-- POLICIES (both to authenticated, both SELECT). job_checkins_member_read is the house read copied from the most
--   recent member-read policy, record_changes_read (0111), which is the wrapped form 0109 made of notes_member_all:
--   ((select app.is_agency()) OR (account_id = (select app.current_account_id()))). job_checkins_technician_scope
--   is 0068 section 4b's restrictive shape, the one bookings carries (bookings_technician_scope), for SELECT: a
--   Technician reads a check-in only on a customer assigned to them, as they read that customer's booking.
--
-- GRANTS. The default ACL hands ALL (MAINTAIN included) on a new table to anon, authenticated and service_role by
--   name, so everything is revoked from all three and PUBLIC first, then granted back (0115's and
--   20261115190749's revoke-all-then-grant-back). No function is added; keep_task_links stays an invoker with
--   search_path = pg_catalog, pg_temp (0096 rule), so EXPECTED_DEFINERS does not change.
--
-- LOCKS AND COST. The bookings constraint builds a unique index and the tasks ALTERs add a nullable column with no
--   default (no rewrite) and a validated key: ACCESS EXCLUSIVE on public.bookings and public.tasks, SHARE ROW
--   EXCLUSIVE on public.accounts, for the length of this file. Production held 20 bookings and 7 tasks on
--   2026-11-17, so milliseconds; lock_timeout 5s bounds the wait to take them.
--
-- APPLY ORDER. bis-ci (CI, once the PR is ready), then production (CI, after danlo's approval), then the parity
--   check, then the app. Additive: the running build names none of these objects, the new column is nullable, and
--   the re-created keep_task_links nulls a column that build never sends.
--
-- ROLLBACK (by hand, app reverted first), in this order:
--   re-create app.keep_task_links() exactly as 0097 wrote it (FIRST: it names review_checkin_id, and every task
--     insert fails once the column is gone);
--   alter table public.tasks drop column review_checkin_id;   (drops tasks_review_checkin_fkey and
--     tasks_review_checkin_once; lost: each "not great" To-do's link, the To-dos stay as plain To-dos)
--   drop table public.job_checkins;   (lost: every answer and review-link press; owner decision)
--   alter table public.bookings drop constraint bookings_account_id_id_contact_id_key;
--
-- ASCII only, no backslash anywhere, and every dollar sign in this file is part of a dollar-quote pair.

-- 0. Fail fast instead of queueing behind a lock (0104's form: inside a do block, so it is always in the block's
--    transaction).
do $$
begin
  perform pg_catalog.set_config('lock_timeout', '5s', true);
end $$;

-- 1. The key a check-in names its booking and that booking's customer by.
alter table public.bookings
  add constraint bookings_account_id_id_contact_id_key unique (account_id, id, contact_id);

-- 2. The answers.
create table public.job_checkins (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null
    constraint job_checkins_account_id_fkey references public.accounts (id) on delete cascade,
  booking_id uuid not null
    constraint job_checkins_booking_id_key unique,
  contact_id uuid not null,
  answer text not null
    constraint job_checkins_answer_check check (answer in ('great', 'okay', 'not_great')),
  answered_at timestamptz not null default now(),
  review_link_opened_at timestamptz,
  created_at timestamptz not null default now(),
  constraint job_checkins_account_id_id_key unique (account_id, id),
  constraint job_checkins_booking_fkey foreign key (account_id, booking_id, contact_id)
    references public.bookings (account_id, id, contact_id) on update cascade on delete cascade
);
-- The record's timeline reads a customer's answers (plan D2, PR 4).
create index job_checkins_account_contact on public.job_checkins (account_id, contact_id);

comment on table public.job_checkins is
  'F-072: a customer''s answer to "How did we do?" after a completed job, one per booking, first answer wins. '
  'Written only by the server (service_role) from the public check-in page; read by the account''s members. '
  'Asked is bookings.review_requested_at, never a row here.';
comment on column public.job_checkins.booking_id is
  'The completed booking asked about. Unique: one answer per booking (insert on conflict do nothing).';
comment on column public.job_checkins.contact_id is
  'The booking''s own customer, read from the booking by the server, never from the request. Follows the booking '
  '(job_checkins_booking_fkey, on update cascade), so a contact merge and its Undo carry it.';
comment on column public.job_checkins.answer is 'great, okay or not_great. Never updated (no role holds UPDATE on it).';
comment on column public.job_checkins.review_link_opened_at is
  'The first press of the review button on the check-in page, a POST (never a fetch). NULL until pressed. The only '
  'column service_role may UPDATE.';

-- 3. The "not great" To-do's link: one per check-in, same account.
alter table public.tasks add column review_checkin_id uuid;
alter table public.tasks add constraint tasks_review_checkin_fkey
  foreign key (account_id, review_checkin_id) references public.job_checkins (account_id, id) on delete cascade;
create unique index tasks_review_checkin_once on public.tasks (review_checkin_id) where review_checkin_id is not null;
comment on column public.tasks.review_checkin_id is
  'F-072: the check-in whose "not great" answer opened this To-do (ensureCheckinTask). One To-do per check-in '
  '(tasks_review_checkin_once). Set only by server code (service_role); a signed-in insert stores NULL and a '
  'signed-in update keeps it (app.keep_task_links). NULL for every other To-do.';

-- 4. Only server code sets or changes a To-do link (0074 guard, extended by 0080, 0084, 0097, now by this file).
--    0097's body, with review_checkin_id added to both branches.
create or replace function app.keep_task_links() returns trigger
language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  if coalesce(current_user = 'authenticated', false) then
    if tg_op = 'INSERT' then
      new.call_id := null;
      new.consent_event_id := null;
      new.document_request_id := null;
      new.document_request_kind := null;
      new.document_expiry_id := null;
      new.document_expiry_on := null;
      new.closure_kind := null;
      new.closure_on := null;
      new.review_checkin_id := null;
    else
      new.call_id := old.call_id;
      new.consent_event_id := old.consent_event_id;
      new.document_request_id := old.document_request_id;
      new.document_request_kind := old.document_request_kind;
      new.document_expiry_id := old.document_expiry_id;
      new.document_expiry_on := old.document_expiry_on;
      new.closure_kind := old.closure_kind;
      new.closure_on := old.closure_on;
      new.review_checkin_id := old.review_checkin_id;
    end if;
  end if;
  return new;
end $$;

-- 5. Grants.
revoke all on public.job_checkins from public, anon, authenticated, service_role;
grant select on public.job_checkins to authenticated;
grant select, insert, delete on public.job_checkins to service_role;
grant update (review_link_opened_at) on public.job_checkins to service_role;

-- 6. Row level security: members read their account's answers, a Technician only their customers'.
alter table public.job_checkins enable row level security;
create policy job_checkins_member_read on public.job_checkins for select to authenticated
  using (((select app.is_agency()) OR (account_id = (select app.current_account_id()))));
create policy job_checkins_technician_scope on public.job_checkins as restrictive for select to authenticated
  using ((select app.sees_all_customers(app.current_account_id())) or contact_id in (select app.my_contact_ids()));
