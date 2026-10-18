-- 0085_document_shares.sql - the document vault, part 3b: share links
-- (docs/superpowers/specs/2026-10-17-document-vault-part3-design.md section 4;
--  docs/superpowers/plans/2026-10-18-document-vault-pr3b.md)
--
-- Staff make a link to ONE version of ONE file: /s/<token>, no sign-in, 24 hours, revocable. The
-- token is 32 random bytes the app mints; only sha256(token) is stored (token_hash). A share names
-- the version the reader saw when it was made (the app computes it on the server: the newest clean
-- ready version), so a newer version never changes what an old link serves. Every link to a document or a version is a same-account composite key; a share and its
-- downloads go with their document (on delete cascade), as the purge and the teardown need.
-- Written by server code only (0053's pattern): the client role reads a share exactly when it can
-- read its document (the restrictive policy's subquery runs under documents' own policies: the
-- tenant, the Technician fence, Owners only) and writes nothing. One service-only function claims
-- a download: it locks the share, re-proves it open (not revoked, not expired, the document not in
-- the trash, the version ready and clean), answers closed past the link's total cap (p_link_max), counts this
-- address's downloads of this link inside the window (the forms limiter's numbers, passed by the app),
-- records the download, and sets
-- first_opened_at only the first time: under the lock, exactly one claim sees it unset.
-- document_share_downloads keeps an HMAC of the address (lib/forms/guards.ts hashIp), never the
-- address. A security_invoker view feeds the record's timeline (a share made, its first open).
--
-- APPLY ORDER: CI project (ci-project-setup.yml: push-dry-run, then push), then production (MCP
-- apply_migration, once), then the parity check, then merge. Additive: the build before it reads
-- none of it, and every existing version row satisfies the new key (id is its primary key). The
-- build after it needs it: the migration goes BEFORE the code deploy.
--
-- Rollback (by hand, in this order; revert the app first):
--   drop view public.document_share_timeline;
--   drop function public.claim_document_share_download(uuid, uuid, text, integer, integer, integer);
--   drop table public.document_share_downloads;
--   drop table public.document_shares;
--   alter table public.document_versions drop constraint document_versions_account_document_id_key;
--
-- ASCII only, no backslash anywhere.

-- 0. Fail fast instead of queueing behind a long lock on document_versions.
set local lock_timeout = '5s';

-- 1. The key a same-account version link needs (plan deviation 11). id is the primary key, so no
--    existing row can refuse it.
alter table public.document_versions
  add constraint document_versions_account_document_id_key unique (account_id, document_id, id);

-- 2. The share.
create table public.document_shares (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  document_id uuid not null,
  version_id uuid not null,
  token_hash text not null constraint document_shares_token_hash_key unique
    constraint document_shares_token_hash_check check (char_length(token_hash) = 64 and token_hash !~ '[^0-9a-f]'),
  created_by text not null constraint document_shares_created_by_check check (btrim(created_by) <> ''),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by text,
  first_opened_at timestamptz,
  open_count integer not null default 0 constraint document_shares_open_count_check check (open_count >= 0),
  constraint document_shares_expiry check (expires_at = created_at + interval '24 hours'),
  constraint document_shares_revoke_coherent check ((revoked_at is null) = (revoked_by is null)),
  constraint document_shares_opened_coherent check ((first_opened_at is null) = (open_count = 0)),
  constraint document_shares_document_fkey foreign key (account_id, document_id)
    references public.documents (account_id, id) on delete cascade,
  constraint document_shares_version_fkey foreign key (account_id, document_id, version_id)
    references public.document_versions (account_id, document_id, id) on delete cascade,
  constraint document_shares_account_id_id_key unique (account_id, id)
);
create index document_shares_by_document on public.document_shares (account_id, document_id);
comment on table public.document_shares is
  'A link to one version of one document (0085). Reached by /s/<token>; only sha256(token) is stored. Server-written only; authenticated reads a share exactly when it reads its document. Expired once expires_at has passed (computed, never written).';

-- 3. Each download, for the per-link, per-address limit (plan deviation 1). Service only.
create table public.document_share_downloads (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  share_id uuid not null,
  ip_hash text not null
    constraint document_share_downloads_ip_hash_check check (char_length(ip_hash) = 32 and ip_hash !~ '[^0-9a-f]'),
  created_at timestamptz not null default now(),
  constraint document_share_downloads_share_fkey foreign key (account_id, share_id)
    references public.document_shares (account_id, id) on delete cascade
);
create index document_share_downloads_recent on public.document_share_downloads (share_id, ip_hash, created_at);
comment on table public.document_share_downloads is
  'One row per download through a share link (0085): an HMAC of the address, never the address. Service role only.';

-- 4. Grants and who reads. SELECT on shares for the client role, nothing else; downloads are the
--    service role's alone (RLS on, no policy). A new table gets Supabase's default ALL.
alter table public.document_shares enable row level security;
alter table public.document_share_downloads enable row level security;
revoke all on public.document_shares, public.document_share_downloads from anon, authenticated;
grant select on public.document_shares to authenticated;
grant select, insert, update, delete on public.document_shares, public.document_share_downloads to service_role;
create policy document_shares_member_read on public.document_shares for select to authenticated
  using (app.is_agency() or account_id = app.current_account_id());
-- A share is visible exactly when its document is: the subquery runs under documents' own policies.
create policy document_shares_through_document on public.document_shares as restrictive for select to authenticated
  using (document_id in (select d.id from public.documents d));

-- 5. The one claim of a download (spec 4.2, 4.3). Locks the share row, so concurrent claims queue
--    and exactly one sees first_opened_at unset.
create function public.claim_document_share_download(
  p_account_id uuid, p_share_id uuid, p_ip_hash text, p_max integer, p_window_seconds integer, p_link_max integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_share public.document_shares%rowtype; v_recent integer;
begin
  if p_account_id is null or p_share_id is null or p_ip_hash is null or p_max is null or p_window_seconds is null or p_link_max is null then
    raise exception 'claim_document_share_download: a required argument is null' using errcode = '22004';
  end if;
  select * into v_share from public.document_shares
   where account_id = p_account_id and id = p_share_id
     for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if v_share.revoked_at is not null or v_share.expires_at <= now() then
    return jsonb_build_object('status', 'closed');
  end if;
  perform 1 from public.documents d
    join public.document_versions v on v.account_id = d.account_id and v.document_id = d.id
   where d.account_id = p_account_id and d.id = v_share.document_id and v.id = v_share.version_id
     and d.deleted_at is null and v.status = 'ready' and v.scan_status = 'clean';
  if not found then return jsonb_build_object('status', 'closed'); end if;
  -- Ruling O3: a link is downloaded at most p_link_max times in all, from any address. Past it the link
  -- is closed for everyone and waiting never helps, so it answers closed, not rate_limited.
  if v_share.open_count >= p_link_max then return jsonb_build_object('status', 'closed'); end if;
  select count(*) into v_recent from public.document_share_downloads
   where share_id = p_share_id and ip_hash = p_ip_hash
     and created_at > now() - make_interval(secs => p_window_seconds);
  if v_recent >= p_max then return jsonb_build_object('status', 'rate_limited'); end if;
  insert into public.document_share_downloads (account_id, share_id, ip_hash) values (p_account_id, p_share_id, p_ip_hash);
  update public.document_shares
     set open_count = open_count + 1, first_opened_at = coalesce(first_opened_at, now())
   where account_id = p_account_id and id = p_share_id;
  return jsonb_build_object('status', 'ok', 'first', v_share.first_opened_at is null);
end $$;
revoke all on function public.claim_document_share_download(uuid, uuid, text, integer, integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.claim_document_share_download(uuid, uuid, text, integer, integer, integer) to service_role;

-- 6. The record's timeline (plan deviation 4): a share made (created_at) and its first open
--    (first_opened_at), one row each, read from this view. security_invoker: the view runs with the
--    CALLER's privileges, so document_shares' and documents' policies decide every row, as for the
--    card. SELECT only; schema-grants-guard.test.ts lists it, a reviewed decision.
create view public.document_share_timeline with (security_invoker = true) as
  select s.id, s.account_id, s.document_id, s.created_by, s.created_at, s.expires_at, s.revoked_at, s.first_opened_at,
         d.title, d.category, d.contact_id, d.client_group_id, d.deleted_at
    from public.document_shares s
    join public.documents d on d.account_id = s.account_id and d.id = s.document_id;
revoke all on public.document_share_timeline from public, anon, authenticated, service_role;
grant select on public.document_share_timeline to authenticated, service_role;
comment on view public.document_share_timeline is
  'One row per share link (0085), with its document''s title and record. security_invoker, so the RLS of document_shares and documents decides what each caller sees.';
