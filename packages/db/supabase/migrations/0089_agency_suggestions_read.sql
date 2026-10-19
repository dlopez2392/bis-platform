-- 0089_agency_suggestions_read.sql - one read for every account's pending suggestions, at most N per
-- account (first release item 8, part 8b-2; S-14, F-019)
-- (docs/superpowers/specs/2026-10-19-ai-proposals-review-tray-design.md section 5.2;
--  docs/superpowers/plans/2026-10-19-ai-proposals-tray-pr8b2.md, Task 1)
--
-- The agency Work page shows every account's pending suggestions, capped per account. One call
-- answers every account at once: the pending rows (status 'pending' and not yet past expires_at),
-- the p_per_account newest per account (created_at desc, then id desc, so a tie on created_at always
-- keeps the same row), ordered account_id, created_at desc, id desc. It returns the table's own row
-- type, every column and nothing added. proposals_account_pending_idx (0088) serves it.
--
-- WHY SECURITY INVOKER: only the service role may execute it (the grants below), and the service role
-- bypasses RLS, so the function needs no privilege of its own. Nothing else may run it: a definer
-- function here would hand every account's suggestions to whoever could call it. A client role is
-- refused EXECUTE outright rather than left to RLS.
--
-- p_per_account null or below 1 raises 22023: a cap of zero is a caller's bug, never an empty page.
--
-- APPLY ORDER: CI project first (ci-project-setup.yml: push-dry-run, then push, from a ref holding
-- 0089 and not 0090), then production (MCP apply_migration, once), then the parity check. BEFORE the
-- code that calls it deploys; the build before it never calls it, so it is safe to apply at any time.
--
-- Rollback (by hand, after the code that calls it is rolled back):
--   drop function public.list_pending_proposals_for_agency(integer);
--
-- ASCII only, no backslash anywhere.

create function public.list_pending_proposals_for_agency(p_per_account integer)
returns setof public.proposals
language plpgsql stable security invoker set search_path = '' as $$
begin
  if p_per_account is null or p_per_account < 1 then
    raise exception 'list_pending_proposals_for_agency: p_per_account must be 1 or more, got %', p_per_account
      using errcode = '22023';
  end if;
  return query
    select (r.p).*
      from (select p, pg_catalog.row_number() over (partition by p.account_id
                                                    order by p.created_at desc, p.id desc) as n
              from public.proposals p
             where p.status = 'pending' and p.expires_at > pg_catalog.now()) r
     where r.n <= p_per_account
     order by (r.p).account_id, (r.p).created_at desc, (r.p).id desc;
end $$;
comment on function public.list_pending_proposals_for_agency(integer) is
  'Every account''s pending suggestions, at most p_per_account newest per account (0089). Service role '
  'only; security invoker, so it reads through the service role''s own RLS bypass.';
revoke all on function public.list_pending_proposals_for_agency(integer) from public, anon, authenticated;
grant execute on function public.list_pending_proposals_for_agency(integer) to service_role;
