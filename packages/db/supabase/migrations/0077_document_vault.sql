-- 0077_document_vault.sql - the document vault, part 1: the staff vault
-- (docs/superpowers/specs/2026-10-13-document-vault-design.md section 3)
--
-- A document is filed on exactly one record: a contact or a client group in part 1 (place and
-- opportunity links exist and stay unused). Each upload is a document_versions row; the stored object
-- lives in the PRIVATE documents bucket at {account_id}/{document_id}/{version_id}, never a name the
-- uploader chose. Written by server code only (0053's pattern): the client role reads both tables
-- under the tenant policy, 0068's Technician fence and an Owners-only fence, and writes nothing.
-- No storage.objects policy is added for anon or authenticated: only the service role reaches the
-- objects, through URLs it mints after an RLS read. reserve_document_version holds the 5 GiB quota
-- under a lock on the account row; mark_document_version_ready refuses a size other than the reserved one,
-- so the quota is held by the database, not by the caller. Every record link is a composite same-account key
-- (0050's shape; opportunities gains its (account_id, id) key here for it), so no document can name another
-- account's record. The record FKs are NO ACTION: the app removes a contact's objects and document rows
-- BEFORE the contact row (deleteContacts' purge hook), and the FK refuses any delete it did not clear.
--
-- APPLY ORDER: CI project (ci-project-setup.yml: push-dry-run, then push), then production (MCP
-- apply_migration, once), then the parity check (the fingerprint compares the bucket row), then merge.
-- Additive: the build before it reads neither table.
--
-- ROLLBACK (revert the app first; this drops every stored file's record, so only on an owner decision,
-- after the objects are exported or removed through the Storage API, which Postgres refuses to do):
--   drop table public.documents cascade;  -- takes document_versions' FK and the current-version FK
--   drop table public.document_versions;
--   drop function public.reserve_document_version(uuid, uuid, bigint, text, text, text);
--   drop function public.mark_document_version_ready(uuid, uuid, uuid, bigint, text);
--   drop function app.documents_current_is_ready();
--   alter table public.opportunities drop constraint opportunities_account_id_id_key;  -- after documents is gone
--   then remove the bucket through the Storage API (deleteBucket) once it is empty: a direct
--   delete from storage.buckets is refused on production by its storage.protect_delete trigger (42501).
--
-- ASCII only, no backslash anywhere.

set local lock_timeout = '5s';

-- 1. The bucket. Private; 25 MiB; the six types the finish step can recognise (spec 5.2), in the order
--    packages/db/src/document-rules.ts lists them (the parity fingerprint compares the array as text).
--    No HEIC: the browser cannot strip its location data. No SVG or HTML, ever.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 26214400, array[
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);

-- 2. Tables. opportunities first gains the (account_id, id) key a same-account link needs (0050 gave
--    contacts and calendars theirs; 0069 and 0071 built client_groups and places with one). id is already
--    the primary key, so the new key can never refuse an existing row.
alter table public.opportunities add constraint opportunities_account_id_id_key unique (account_id, id);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  contact_id uuid,
  client_group_id uuid,
  place_id uuid,
  opportunity_id uuid,
  title text not null constraint documents_title_check check (app.tidy_text(title, 200)),
  category text not null constraint documents_category_check
    check (category in ('id', 'contract', 'estimate', 'invoice', 'photo', 'permit', 'insurance', 'warranty', 'other')),
  expires_on date,
  owners_only boolean not null default false,
  client_visible boolean not null default false,
  source text not null constraint documents_source_check check (source in ('upload', 'camera')),
  scan_status text not null constraint documents_scan_status_check check (scan_status in ('skipped', 'pending', 'clean', 'infected')),
  current_version_id uuid,
  created_by text not null constraint documents_created_by_check check (btrim(created_by) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by text,
  constraint documents_one_record check (num_nonnulls(contact_id, client_group_id, place_id, opportunity_id) = 1),
  constraint documents_trash_coherent check ((deleted_at is null) = (deleted_by is null)),
  constraint documents_contact_fkey foreign key (account_id, contact_id) references public.contacts (account_id, id),
  constraint documents_group_fkey foreign key (account_id, client_group_id) references public.client_groups (account_id, id),
  constraint documents_place_fkey foreign key (account_id, place_id) references public.places (account_id, id),
  constraint documents_opportunity_fkey foreign key (account_id, opportunity_id) references public.opportunities (account_id, id),
  constraint documents_account_id_id_key unique (account_id, id)
);

create table public.document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null,
  account_id uuid not null references public.accounts(id) on delete cascade,
  storage_path text not null constraint document_versions_storage_path_key unique,
  bytes bigint not null constraint document_versions_bytes_check check (bytes between 1 and 26214400),
  content_type text not null constraint document_versions_content_type_check check (content_type in (
    'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')),
  sha256 text constraint document_versions_sha256_check check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  original_name text constraint document_versions_original_name_check
    check (original_name is null or char_length(original_name) between 1 and 255),
  uploaded_by text not null constraint document_versions_uploaded_by_check check (btrim(uploaded_by) <> ''),
  status text not null constraint document_versions_status_check check (status in ('uploading', 'ready')),
  created_at timestamptz not null default now(),
  constraint document_versions_document_fkey foreign key (account_id, document_id)
    references public.documents (account_id, id) on delete cascade,
  constraint document_versions_path_shape
    check (storage_path = account_id::text || '/' || document_id::text || '/' || id::text),
  constraint document_versions_ready_hashed check (status = 'uploading' or sha256 is not null),
  constraint document_versions_document_id_id_key unique (document_id, id)
);

-- The current version is a version of THIS document (the composite key) and a ready one (section 4).
alter table public.documents add constraint documents_current_version_fkey
  foreign key (id, current_version_id) references public.document_versions (document_id, id);

create index documents_by_contact on public.documents (account_id, contact_id) where contact_id is not null;
create index documents_by_group on public.documents (account_id, client_group_id) where client_group_id is not null;
create index documents_by_opportunity on public.documents (account_id, opportunity_id) where opportunity_id is not null;
create index documents_trashed on public.documents (deleted_at) where deleted_at is not null;
create index document_versions_by_account on public.document_versions (account_id);
create index document_versions_uploading on public.document_versions (created_at) where status = 'uploading';

comment on table public.documents is
  'A file on a record (0077). Server-written only; authenticated reads under the record''s visibility and the Owners-only fence. Listed once current_version_id names a ready version; in the trash while deleted_at is set.';
comment on table public.document_versions is
  'One stored upload of a document (0077), at storage_path in the private documents bucket. uploading until the finish step checks its bytes; counted against the account quota in either status.';

-- 3. Grants: SELECT for the client role, nothing else (a new table gets Supabase's default ALL).
alter table public.documents enable row level security;
alter table public.document_versions enable row level security;
revoke all on public.documents, public.document_versions from anon, authenticated;
grant select on public.documents, public.document_versions to authenticated;
grant select, insert, update, delete on public.documents, public.document_versions to service_role;

-- 4. Who reads. The tenant policy (0069's shape), 0068's Technician fence (a customer assigned to them,
--    or that customer's household or business, as places_technician_scope), and Owners only. Every
--    helper coalesces (0066, 0068), so a NULL never opens a row.
create policy documents_member_read on public.documents for select to authenticated
  using (app.is_agency() or account_id = app.current_account_id());
create policy documents_technician_scope on public.documents as restrictive for select to authenticated
  using ((select app.sees_all_customers(app.current_account_id()))
         or contact_id in (select app.my_contact_ids())
         or client_group_id in (select app.my_client_group_ids()));
create policy documents_owners_only on public.documents as restrictive for select to authenticated
  using (not owners_only or (select app.is_account_owner(app.current_account_id())));
-- A version is visible exactly when its document is: the subquery runs under documents' own policies.
create policy document_versions_member_read on public.document_versions for select to authenticated
  using (app.is_agency() or account_id = app.current_account_id());
create policy document_versions_through_document on public.document_versions as restrictive for select to authenticated
  using (document_id in (select d.id from public.documents d));

-- 5. current_version_id names a READY version. Plain, not definer: it runs as the writer (service_role).
create function app.documents_current_is_ready() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.current_version_id is not null and not exists (
       select 1 from public.document_versions v
        where v.id = new.current_version_id and v.document_id = new.id and v.status = 'ready') then
    raise exception 'documents: the current version must be a ready version of this document' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger documents_current_is_ready before insert or update of current_version_id on public.documents
  for each row execute function app.documents_current_is_ready();
revoke all on function app.documents_current_is_ready() from public, anon;
grant execute on function app.documents_current_is_ready() to authenticated, service_role;

-- 6. The quota (spec 3.5). Locks the account row (FOR NO KEY UPDATE: two reservations queue, child inserts do not), sums EVERY version of the account (ready and
--    uploading; trashed documents included until purged), refuses past 5 GiB, else inserts the
--    uploading row. The literals are document-rules.ts's DOCUMENT_QUOTA_BYTES and DOCUMENT_MAX_BYTES.
create function public.reserve_document_version(
  p_account_id uuid, p_document_id uuid, p_bytes bigint, p_content_type text, p_original_name text, p_uploaded_by text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_used bigint; v_id uuid := gen_random_uuid(); v_path text;
begin
  if p_account_id is null or p_document_id is null or p_bytes is null or p_content_type is null or p_uploaded_by is null then
    raise exception 'reserve_document_version: a required argument is null' using errcode = '22004';
  end if;
  if p_bytes < 1 or p_bytes > 26214400 then
    return jsonb_build_object('status', 'too_large');
  end if;
  perform 1 from public.accounts where id = p_account_id for no key update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  perform 1 from public.documents where id = p_document_id and account_id = p_account_id;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  select coalesce(sum(v.bytes), 0) into v_used from public.document_versions v where v.account_id = p_account_id;
  if v_used + p_bytes > 5368709120 then
    return jsonb_build_object('status', 'over_quota', 'used', v_used);
  end if;
  v_path := p_account_id::text || '/' || p_document_id::text || '/' || v_id::text;
  insert into public.document_versions (id, document_id, account_id, storage_path, bytes, content_type, original_name, uploaded_by, status)
  values (v_id, p_document_id, p_account_id, v_path, p_bytes, p_content_type, p_original_name, p_uploaded_by, 'uploading');
  return jsonb_build_object('status', 'ok', 'version_id', v_id, 'storage_path', v_path, 'used', v_used + p_bytes);
end $$;
revoke all on function public.reserve_document_version(uuid, uuid, bigint, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.reserve_document_version(uuid, uuid, bigint, text, text, text) to service_role;

-- 7. A version becomes ready and current in ONE transaction (plan review minor 4): the version row and
--    the document's pointer move together or not at all, so a document is never left with a ready
--    version that nothing lists (which would count against the quota forever). Only an UPLOADING
--    version of THIS document qualifies, and only at the size it reserved: the quota was checked against
--    that size, so any other size answers size_mismatch before anything is written (the caller removes
--    the object and its row). `first` tells the caller whether to emit document.added.
create function public.mark_document_version_ready(
  p_account_id uuid, p_document_id uuid, p_version_id uuid, p_bytes bigint, p_sha256 text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_prior uuid; v_reserved bigint;
begin
  if p_account_id is null or p_document_id is null or p_version_id is null or p_bytes is null or p_sha256 is null then
    raise exception 'mark_document_version_ready: a required argument is null' using errcode = '22004';
  end if;
  select current_version_id into v_prior from public.documents
   where id = p_document_id and account_id = p_account_id for no key update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  select v.bytes into v_reserved from public.document_versions v
   where v.id = p_version_id and v.document_id = p_document_id and v.account_id = p_account_id and v.status = 'uploading'
   for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if v_reserved <> p_bytes then return jsonb_build_object('status', 'size_mismatch'); end if;
  update public.document_versions set status = 'ready', sha256 = p_sha256
   where id = p_version_id and document_id = p_document_id and account_id = p_account_id and status = 'uploading'
     and bytes = p_bytes;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  update public.documents set current_version_id = p_version_id, updated_at = now() where id = p_document_id;
  return jsonb_build_object('status', 'ok', 'first', v_prior is null);
end $$;
revoke all on function public.mark_document_version_ready(uuid, uuid, uuid, bigint, text) from public, anon, authenticated, service_role;
grant execute on function public.mark_document_version_ready(uuid, uuid, uuid, bigint, text) to service_role;
