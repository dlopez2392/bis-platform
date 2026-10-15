-- 0078_document_space_used.sql - the document vault, part 1b: the space-used line
-- Two reads: the Documents card's space-used number (1, below) and the timeline's new-version rows (2, below).
-- (docs/superpowers/specs/2026-10-13-document-vault-design.md section 4.2 item 4;
--  docs/superpowers/plans/2026-10-14-document-vault-pr1b.md deviation 1)
--
-- One number for the Documents card: the bytes of every version of the account, ready AND uploading,
-- trashed documents included until purged. That is exactly the sum reserve_document_version (0077,
-- section 6) checks against the 5 GiB quota, so the card's line and the quota's refusal can never
-- disagree. SECURITY DEFINER because the number is the ACCOUNT's: under RLS a Staff member would not
-- count an Owners-only file, nor a Technician a customer outside their scope, and the card would
-- understate a quota the whole team shares. It answers one number, never a row, a name or a count.
-- The caller must be the agency or a member of that account's organisation (the tenant rule of
-- documents_member_read, 0077); anyone else gets 42501. Both halves of the guard coalesce:
-- app.is_agency() is NULL for a client token, and app.current_account_id() is NULL for a token whose
-- organisation matches no account, and a NULL in an IF condition would fall through, open.
--
-- APPLY ORDER: CI project (ci-project-setup.yml: push-dry-run, then push), then production (MCP
-- apply_migration, once), then the parity check, then merge. Additive: nothing before it calls it.
-- ROLLBACK (revert the app first): drop view public.document_version_timeline; drop function public.document_space_used(uuid);
--
-- ASCII only, no backslash anywhere.

set local lock_timeout = '5s';

-- 1. The Documents card's space-used number (above): the account's sum, by the quota's own rule.
create function public.document_space_used(p_account_id uuid)
returns bigint language plpgsql stable security definer set search_path = '' as $$
begin
  if p_account_id is null then
    raise exception 'document_space_used: the account is null' using errcode = '22004';
  end if;
  if not (coalesce(app.is_agency(), false) or coalesce(p_account_id = app.current_account_id(), false)) then
    raise exception 'document_space_used: not this account' using errcode = '42501';
  end if;
  -- reserve_document_version's own sum (0077 section 6), on document_versions_by_account.
  return (select coalesce(sum(v.bytes), 0) from public.document_versions v where v.account_id = p_account_id);
end $$;

revoke all on function public.document_space_used(uuid) from public, anon, authenticated, service_role;
grant execute on function public.document_space_used(uuid) to authenticated;

-- 2. The timeline's new-version rows (owner ruling 2026-10-14; plan deviation 6): every READY version
--    that has an older ready version of the same document (the first is the "added a file" row, read
--    from documents). The first ready version is the oldest only because the APP refuses to start a
--    new version until the document has a ready current one (startDocumentVersionUploadAction, plan
--    Task 4); reserve_document_version (0077) checks only that the document exists, so the database
--    does not hold this rule. security_invoker: the view runs with the CALLER's
--    privileges, so the documents policies (tenant, Technician fence, Owners only) and
--    document_versions_through_document decide every row, as for the card. The first view in public:
--    schema-grants-guard.test.ts lists it, a reviewed decision. SELECT only; the default ALL grant a
--    new view gets is revoked first.
create view public.document_version_timeline with (security_invoker = true) as
  select v.id, v.document_id, v.account_id, v.uploaded_by, v.created_at,
         d.title, d.category, d.contact_id, d.client_group_id, d.deleted_at
    from public.document_versions v
    join public.documents d on d.id = v.document_id and d.account_id = v.account_id
   where v.status = 'ready'
     and exists (select 1 from public.document_versions p
                  where p.document_id = v.document_id and p.status = 'ready'
                    and (p.created_at, p.id) < (v.created_at, v.id));

revoke all on public.document_version_timeline from public, anon, authenticated, service_role;
grant select on public.document_version_timeline to authenticated, service_role;

comment on view public.document_version_timeline is
  'One row per new version of a document (0078): every ready version after the first. security_invoker, so the RLS of documents and document_versions decides what each caller sees.';
