-- 0080_document_requests.sql - the document vault, part 2b: customer upload links
-- (docs/superpowers/specs/2026-10-15-document-vault-part2-design.md section 4;
--  docs/superpowers/plans/2026-10-15-document-vault-pr2b.md)
--
-- Staff ask a customer for named documents; the customer uploads them through /d/<token> with no
-- sign-in. A request names 1 to 9 items (a category, or other with a note), lives 7 days, and is
-- reached by a token the database never stores: only its sha256 (token_hash). The app mints the
-- request id itself, because the token is derived from it (plan deviation 1).
-- A customer file is an ordinary document with source 'customer', created_by 'customer:<request id>',
-- linked to its request and item. Every customer start goes through ONE function that locks the
-- request, re-proves it open, counts today's starts, and creates the document and reserves its
-- version through 0077's reserve_document_version in one transaction, so the record and the
-- category always come from the request row, never from the browser.
-- A request completes when its last item gets a clean file: a trigger on the verdict, so the
-- finish and the retry pass both complete it.
-- Also: documents.scan_status (retired by 0079, unread and unwritten since 2a) is dropped FIRST;
-- automation_log gains the document_request source (quiet-hours holds, What went out); tasks gain
-- the request links for the one work-queue To-do per request and kind, guarded like call_id.
--
-- Rollback (by hand, in this order):
--   drop trigger document_versions_request_on_clean on public.document_versions;
--   drop function app.document_request_on_clean();
--   drop function public.start_document_request_upload(uuid, uuid, text, bigint, text, text, text);
--   re-create 0074's app.keep_task_links() exactly;
--   drop index public.tasks_document_request_once;
--   alter table public.tasks drop constraint tasks_document_request_coherent,
--     drop column document_request_kind, drop column document_request_id;
--   delete the document_request rows of automation_log, then re-add 0054's automation_log_source_check exactly;
--   delete the customer documents (their objects first), then
--   alter table public.documents drop constraint documents_request_coherent,
--     drop constraint documents_request_fkey, drop column request_item_key, drop column request_id;
--   re-add 0077's documents_source_check exactly;
--   drop table public.document_requests; drop function app.document_request_items_ok(jsonb);
--   alter table public.documents add column scan_status text not null default 'skipped'
--     constraint documents_scan_status_check check (scan_status in ('skipped', 'pending', 'clean', 'infected'));

-- 0. Fail fast instead of queueing behind a long lock on documents, tasks or automation_log (plan review I2):
--    the drop and the constraint swaps take ACCESS EXCLUSIVE locks, and a queued one blocks every later reader.
set local lock_timeout = '5s';

-- 1. The retired per-document scan state (0079 gave it a default; nothing reads or writes it).
alter table public.documents drop column scan_status;

-- 2. Items: 1 to 9, each {key, category, note}, key = category, distinct, a note only on other.
create function app.document_request_items_ok(p_items jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(
    jsonb_typeof(p_items) = 'array'
    and jsonb_array_length(p_items) between 1 and 9
    and (select bool_and(
          jsonb_typeof(e) = 'object'
          and e ? 'key' and e ? 'category' and e ? 'note'
          and jsonb_typeof(e -> 'key') = 'string'
          and e ->> 'key' = e ->> 'category'
          and e ->> 'category' in ('id', 'contract', 'estimate', 'invoice', 'photo', 'permit', 'insurance', 'warranty', 'other')
          and case when e ->> 'category' = 'other'
                   then jsonb_typeof(e -> 'note') = 'string'
                        and char_length(e ->> 'note') between 1 and 80
                        and app.tidy_text(e ->> 'note', 80)
                   else jsonb_typeof(e -> 'note') = 'null' end)
         from jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) e)
    and (select count(distinct e ->> 'key') = jsonb_array_length(p_items)
         from jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) e),
    false)
$$;
revoke all on function app.document_request_items_ok(jsonb) from public, anon;
grant execute on function app.document_request_items_ok(jsonb) to authenticated, service_role;

-- 3. The request. Server-written only; members read under the record's visibility (as documents).
create table public.document_requests (
  id uuid primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  contact_id uuid,
  client_group_id uuid,
  items jsonb not null constraint document_requests_items_check check (app.document_request_items_ok(items)),
  language text not null constraint document_requests_language_check check (language in ('en', 'es')),
  token_hash text not null constraint document_requests_token_hash_key unique
    constraint document_requests_token_hash_check check (token_hash ~ '^[0-9a-f]{64}$'),
  channel text not null constraint document_requests_channel_check check (channel in ('text', 'email', 'link')),
  created_by text not null constraint document_requests_created_by_check check (btrim(created_by) <> ''),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by text,
  completed_at timestamptz,
  -- The at-most-once send stamp (2b plan re-review R1): set just before a text or email is handed to the
  -- provider, cleared when that send did not go out; a held release skips a request that carries it.
  sent_at timestamptz,
  constraint document_requests_one_record check (num_nonnulls(contact_id, client_group_id) = 1),
  constraint document_requests_expiry check (expires_at = created_at + interval '7 days'),
  constraint document_requests_revoke_coherent check ((revoked_at is null) = (revoked_by is null)),
  constraint document_requests_contact_fkey foreign key (account_id, contact_id)
    references public.contacts (account_id, id) on delete cascade,
  constraint document_requests_group_fkey foreign key (account_id, client_group_id)
    references public.client_groups (account_id, id) on delete cascade,
  constraint document_requests_account_id_id_key unique (account_id, id)
);
create index document_requests_by_contact on public.document_requests (account_id, contact_id) where contact_id is not null;
create index document_requests_by_group on public.document_requests (account_id, client_group_id) where client_group_id is not null;
comment on table public.document_requests is
  'A request for documents sent to a customer (0080). Reached by /d/<token>; only sha256(token) is stored. Server-written only; authenticated reads under the record''s visibility. Expired once expires_at has passed (computed, never written).';

alter table public.document_requests enable row level security;
revoke all on public.document_requests from anon, authenticated;
grant select on public.document_requests to authenticated;
grant select, insert, update, delete on public.document_requests to service_role;
create policy document_requests_member_read on public.document_requests for select to authenticated
  using (app.is_agency() or account_id = app.current_account_id());
create policy document_requests_technician_scope on public.document_requests as restrictive for select to authenticated
  using ((select app.sees_all_customers(app.current_account_id()))
         or contact_id in (select app.my_contact_ids())
         or client_group_id in (select app.my_client_group_ids()));

-- 4. A customer file names its request and item; nothing else may claim the customer source.
alter table public.documents drop constraint documents_source_check;
alter table public.documents add constraint documents_source_check check (source in ('upload', 'camera', 'customer'));
alter table public.documents add column request_id uuid, add column request_item_key text;
alter table public.documents add constraint documents_request_coherent check (
  (request_id is null) = (request_item_key is null)
  and (source = 'customer') = (request_id is not null)
  and (source <> 'customer' or created_by = 'customer:' || request_id::text));
alter table public.documents add constraint documents_request_fkey foreign key (account_id, request_id)
  references public.document_requests (account_id, id);
create index documents_by_request on public.documents (account_id, request_id) where request_id is not null;

-- 5. The one start: the request locked and re-proved open, today's starts counted (UTC day), the
--    document created on the REQUEST's record under the ITEM's category, then 0077's reservation.
--    A refused reservation removes the document it just made. service_role only.
create function public.start_document_request_upload(
  p_account_id uuid, p_request_id uuid, p_item_key text, p_bytes bigint, p_content_type text,
  p_original_name text, p_title text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r public.document_requests%rowtype; v_item jsonb; v_today integer; v_doc uuid; v_res jsonb;
begin
  if p_account_id is null or p_request_id is null or p_item_key is null or p_bytes is null
     or p_content_type is null or p_title is null then
    raise exception 'start_document_request_upload: a required argument is null' using errcode = '22004';
  end if;
  if p_bytes < 1 or p_bytes > 26214400 then
    return jsonb_build_object('status', 'too_large');
  end if;
  select * into r from public.document_requests
   where id = p_request_id and account_id = p_account_id for no key update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if r.revoked_at is not null then return jsonb_build_object('status', 'revoked'); end if;
  if r.completed_at is not null then return jsonb_build_object('status', 'completed'); end if;
  if r.expires_at <= now() then return jsonb_build_object('status', 'expired'); end if;
  select e into v_item from jsonb_array_elements(r.items) e where e ->> 'key' = p_item_key;
  if v_item is null then return jsonb_build_object('status', 'no_item'); end if;
  select count(*) into v_today
    from public.document_versions v
    join public.documents d on d.id = v.document_id and d.account_id = v.account_id
   where d.account_id = p_account_id and d.request_id = p_request_id
     and v.created_at >= date_trunc('day', now(), 'UTC');
  if v_today >= 20 then return jsonb_build_object('status', 'rate_limited'); end if;
  insert into public.documents (account_id, contact_id, client_group_id, title, category, source, created_by,
                                owners_only, request_id, request_item_key)
  values (p_account_id, r.contact_id, r.client_group_id, p_title, v_item ->> 'category', 'customer',
          'customer:' || r.id::text, false, r.id, p_item_key)
  returning id into v_doc;
  v_res := public.reserve_document_version(p_account_id, v_doc, p_bytes, p_content_type, p_original_name,
                                           'customer:' || r.id::text);
  if v_res ->> 'status' <> 'ok' then
    delete from public.documents where id = v_doc and account_id = p_account_id;
    return v_res;
  end if;
  return v_res || jsonb_build_object('document_id', v_doc);
end $$;
revoke all on function public.start_document_request_upload(uuid, uuid, text, bigint, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.start_document_request_upload(uuid, uuid, text, bigint, text, text, text)
  to service_role;

-- 6. Completion: on a version's clean verdict, a customer file's request completes once every item
--    has a non-trashed document with a ready, clean version. The request row is locked first, so two
--    verdicts landing together serialise and the second sees the first. Plain, not definer: it runs
--    as the verdict's writer (service_role, 0079's record_document_scan).
create function app.document_request_on_clean() returns trigger
language plpgsql set search_path = '' as $$
declare v_req uuid; r public.document_requests%rowtype;
begin
  select d.request_id into v_req from public.documents d
   where d.id = new.document_id and d.account_id = new.account_id;
  if v_req is null then return null; end if;
  select * into r from public.document_requests
   where id = v_req and account_id = new.account_id for no key update;
  if not found or r.completed_at is not null then return null; end if;
  if not exists (
    select 1 from jsonb_array_elements(r.items) i
     where not exists (
       select 1 from public.documents d
         join public.document_versions v on v.document_id = d.id and v.account_id = d.account_id
        where d.account_id = r.account_id and d.request_id = r.id and d.request_item_key = i ->> 'key'
          and d.deleted_at is null and v.status = 'ready' and v.scan_status = 'clean')) then
    update public.document_requests set completed_at = now()
     where id = r.id and account_id = r.account_id and completed_at is null;
  end if;
  return null;
end $$;
revoke all on function app.document_request_on_clean() from public, anon;
grant execute on function app.document_request_on_clean() to service_role;
create trigger document_versions_request_on_clean
  after update of scan_status on public.document_versions
  for each row when (new.scan_status = 'clean' and old.scan_status is distinct from 'clean')
  execute function app.document_request_on_clean();

-- 7. Quiet-hours holds and What went out for the request's text or email.
alter table public.automation_log drop constraint automation_log_source_check;
alter table public.automation_log add constraint automation_log_source_check
  check (source in (
    'reminders', 'followups', 'review_request', 'no_show_nudge', 'sms_reminder',
    'instant_reply', 'weekly_report', 'concierge', 'voice',
    'appointment_confirm', 'referral_ask', 'reactivation', 'quote_followup',
    'textback', 'document_request'));

-- 8. The work-queue To-do: one per request and kind (received, storage_full). The client role can
--    neither set nor change the links (0074's guard, extended; create or replace keeps its ACL and
--    the tasks_keep_links trigger).
alter table public.tasks
  add column document_request_id uuid references public.document_requests(id) on delete cascade,
  add column document_request_kind text
    constraint tasks_document_request_kind_check check (document_request_kind in ('received', 'storage_full'));
alter table public.tasks add constraint tasks_document_request_coherent
  check ((document_request_id is null) = (document_request_kind is null));
create unique index tasks_document_request_once on public.tasks (document_request_id, document_request_kind)
  where document_request_id is not null;

create or replace function app.keep_task_links() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_user = 'authenticated', false) then
    if tg_op = 'INSERT' then
      new.call_id := null;
      new.consent_event_id := null;
      new.document_request_id := null;
      new.document_request_kind := null;
    else
      new.call_id := old.call_id;
      new.consent_event_id := old.consent_event_id;
      new.document_request_id := old.document_request_id;
      new.document_request_kind := old.document_request_kind;
    end if;
  end if;
  return new;
end $$;
