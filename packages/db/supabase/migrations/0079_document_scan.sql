-- 0079_document_scan.sql - the document vault, part 2a: virus scanning
-- (docs/superpowers/specs/2026-10-15-document-vault-part2-design.md section 3;
--  docs/superpowers/plans/2026-10-15-document-vault-pr2a.md)
--
-- Every stored version is scanned before anyone can open it (owner decision P3). The state lives
-- on the VERSION: pending until a verdict, then clean, infected or unscannable. Part 1's rows take
-- the default, pending, which is what makes the retry pass scan them once (the catch-up).
-- documents.current_version_id keeps 0077's meaning (the newest ready version, which lists the
-- file): what may be OPENED is decided by the one mint function in packages/db/src/documents.ts,
-- which re-reads the version and refuses unless it is clean (plan deviation 1). So 0077's trigger
-- and mark_document_version_ready are untouched.
-- documents.scan_status (0077, per document, always 'skipped') is retired: the app stops writing
-- it with this migration's build and it gets a default here. It is NOT dropped here: this file
-- applies before the merge, and the build running then still writes it (plan deviation 2). The
-- drop is the first statement of 0080.
--
-- 1. Scan columns on document_versions and one check that keeps them coherent.
-- 2. The retry pass's partial index.
-- 3. record_document_scan: the one write of a verdict. A compare-and-set from pending on a READY
--    version of that account; error adds an attempt and stays pending. SECURITY INVOKER with an
--    empty search_path, EXECUTE for service_role only (record_heartbeat's shape, 0057): it writes
--    with service_role's own grants (0077 section 3). The app deletes an infected object BEFORE it
--    records the verdict, so a crash leaves the version pending and the next pass finds it again.
-- 4. document_scan_timeline: the removed-file timeline rows, security_invoker so the documents
--    policies decide (0078's view's shape). The second reviewed view in public
--    (schema-grants-guard.test.ts).
--
-- APPLY ORDER: CI project (ci-project-setup.yml: push-dry-run, then push), then production (MCP
-- apply_migration, once), then the parity check, then merge. Additive for the build before it:
-- that build reads none of the new columns and keeps writing documents.scan_status.
-- ROLLBACK (revert the app first):
--   drop view public.document_scan_timeline;
--   drop function public.record_document_scan(uuid, uuid, text, text);
--   drop index public.document_versions_scan_pending;
--   alter table public.document_versions drop constraint document_versions_scan_coherent, drop column scan_tried_at,
--     drop column scan_signature, drop column scanned_at, drop column scan_attempts, drop column scan_status;
--   alter table public.documents alter column scan_status drop default;
--
-- ASCII only, no backslash anywhere.

set local lock_timeout = '5s';

-- 1. The scan state. A constant default is a catalog-only change; the checks read every row once.
alter table public.document_versions
  add column scan_status text not null default 'pending'
    constraint document_versions_scan_status_check check (scan_status in ('pending', 'clean', 'infected', 'unscannable')),
  add column scan_attempts integer not null default 0
    constraint document_versions_scan_attempts_check check (scan_attempts >= 0),
  add column scanned_at timestamptz,
  add column scan_tried_at timestamptz,
  add column scan_signature text
    constraint document_versions_scan_signature_check check (scan_signature is null or char_length(scan_signature) between 1 and 200);

alter table public.document_versions add constraint document_versions_scan_coherent check (
  (scan_status = 'pending') = (scanned_at is null)
  and (scan_signature is null or scan_status in ('infected', 'unscannable'))
  and (status = 'ready' or scan_status = 'pending'));

comment on column public.document_versions.scan_status is
  'Virus scan (0079): pending until a verdict, then clean, infected or unscannable. Only a clean version may be opened (the mint function in packages/db/src/documents.ts). An infected or unscannable version has had its object deleted.';
comment on column public.document_versions.scan_signature is
  'clamd''s name for an infected version, or for an unscannable one when clamd named its cause (Heuristics.Encrypted.* = password-protected; owner ruling 2026-10-15) (0079). The app never shows it or puts it in an event payload.';

alter table public.documents alter column scan_status set default 'skipped';
comment on column public.documents.scan_status is
  'Retired by 0079: the scan state lives on document_versions.scan_status. Nothing reads it; 0079''s build stops writing it; 0080 drops it.';

-- 2. The retry pass reads ready + pending versions never tried first, then least recently tried, then
--    oldest (re-review N2b: a version that always times out must not head every run).
create index document_versions_scan_pending on public.document_versions (scan_tried_at nulls first, created_at, id)
  where status = 'ready' and scan_status = 'pending';

-- 3. The one write of a verdict.
create function public.record_document_scan(p_account_id uuid, p_version_id uuid, p_verdict text, p_signature text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_attempts integer; v_document uuid;
begin
  if p_account_id is null or p_version_id is null or p_verdict is null then
    raise exception 'record_document_scan: a required argument is null' using errcode = '22004';
  end if;
  if p_verdict not in ('clean', 'infected', 'unscannable', 'error', 'tried') then
    raise exception 'record_document_scan: unknown verdict' using errcode = '22023';
  end if;
  if p_verdict = 'infected' and coalesce(btrim(p_signature), '') = '' then
    raise exception 'record_document_scan: an infected verdict names its signature' using errcode = '22004';
  end if;
  -- 'tried': the retry pass stamps a version before it scans it; nothing else changes.
  if p_verdict = 'tried' then
    update public.document_versions v set scan_tried_at = now()
     where v.id = p_version_id and v.account_id = p_account_id and v.status = 'ready' and v.scan_status = 'pending'
    returning v.scan_attempts, v.document_id into v_attempts, v_document;
    if not found then return jsonb_build_object('status', 'stale'); end if;
    return jsonb_build_object('status', 'ok', 'attempts', v_attempts, 'document_id', v_document);
  end if;
  update public.document_versions v
     set scan_attempts = v.scan_attempts + 1,
         scan_tried_at = now(),
         scan_status = case when p_verdict = 'error' then 'pending' else p_verdict end,
         scanned_at = case when p_verdict = 'error' then null else now() end,
         scan_signature = case when p_verdict = 'infected' then left(btrim(p_signature), 200)
                               when p_verdict = 'unscannable' then nullif(left(btrim(coalesce(p_signature, '')), 200), '')
                               else null end
   where v.id = p_version_id and v.account_id = p_account_id and v.status = 'ready' and v.scan_status = 'pending'
  returning v.scan_attempts, v.document_id into v_attempts, v_document;
  if not found then return jsonb_build_object('status', 'stale'); end if;
  return jsonb_build_object('status', 'ok', 'attempts', v_attempts, 'document_id', v_document);
end $$;

revoke all on function public.record_document_scan(uuid, uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.record_document_scan(uuid, uuid, text, text) to service_role;

-- 4. The removed-file timeline rows (spec 3.5): the automation removed a file, at its verdict.
create view public.document_scan_timeline with (security_invoker = true) as
  select v.id, v.document_id, v.account_id, v.scan_status, v.scanned_at, v.scan_signature,
         d.title, d.category, d.contact_id, d.client_group_id, d.deleted_at
    from public.document_versions v
    join public.documents d on d.id = v.document_id and d.account_id = v.account_id
   where v.status = 'ready' and v.scan_status in ('infected', 'unscannable');

revoke all on public.document_scan_timeline from public, anon, authenticated, service_role;
grant select on public.document_scan_timeline to authenticated, service_role;

comment on view public.document_scan_timeline is
  'One row per removed version (0079): infected or unscannable, at scanned_at. security_invoker, so the RLS of documents and document_versions decides what each caller sees.';
