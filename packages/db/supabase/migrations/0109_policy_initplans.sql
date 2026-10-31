-- 0109_policy_initplans.sql - every policy that called a helper once per row calls it once per statement
-- (F-092 scale follow-up, part A; docs/superpowers/specs/2026-10-31-search-scale-design.md sections 2, 3.3, 3.5, 4.1)
--
-- WHY. 64 permissive policies on 59 tables called app.current_account_id(), app.is_agency() or app.jwt() bare, so
-- PostgreSQL evaluated the call for every row a statement visited. app.current_account_id() is SECURITY DEFINER with a
-- SET clause (0008, 0096), so it cannot be inlined: one function call and one accounts lookup per row, about 13
-- microseconds a contact. At 50,000 contacts an unsearched contact list plus its count took 1,226 ms (p95 sum) and
-- counting an account's 50,000 conversations 516 ms; with the calls wrapped, 60 ms and 8 ms (spec 3.3, 3.5). The
-- owner ruled on 2026-10-31 (spec section 5): wrap all 64, ship this file on its own pull request, ahead of 0110.
--
-- Why the answers cannot change. The three helpers take no arguments and are STABLE (0001, 0008): within one statement
-- every call returns the same value, so the per-row calls already all returned one value. An uncorrelated
-- (select app.f()) computes that value once, as an InitPlan, and hands it to every row. NULL is carried unchanged (a
-- client token's is_agency() is NULL, and NULL OR x reads the same from a call or a sub-select; a disabled account's
-- current_account_id() is NULL either way). PostgREST sets request.jwt.claims once, before the statement, and nothing
-- in the app changes it mid-statement. 0066 and 0068 already wrote every restrictive policy in this form, and those
-- run ANDed with these on every read today.
--
-- WHAT. alter policy on each of the 64, with USING and WITH CHECK set to the expression pg_policies held after 0108
-- with each bare call app.is_agency(), app.current_account_id(), app.jwt() replaced by (select app.f()), and NOTHING
-- else changed. alter policy leaves the name, the command, the roles (authenticated) and PERMISSIVE as they are. The
-- statements are GENERATED, not typed: the generator read pg_policies on a PostgreSQL 17.6 replica of 0001-0108
-- (its whole-policy digest 4f4914fcd094dbb3f13894fa6e19b3f2, the value production and bis-ci read on 2026-10-31)
-- under an empty search_path, so every relation is schema-qualified (users_member_read names public.memberships),
-- and refused any policy whose per-row calls were not all zero-argument calls to those three.
--   The shapes: 50 house policies (app.is_agency() OR account_id = app.current_account_id(), from 0003; 20 for ALL,
--   29 SELECT, 1 INSERT), 9 agency-only (6 app.is_agency(), 3 COALESCE(app.is_agency(), false)),
--   accounts_member_read and accounts_member_update (app.jwt()), memberships_member_read, inbound_never_log_member_read
--   and users_member_read (whose call sits in a correlated EXISTS and becomes an InitPlan of that sub-plan).
--   NOT changed: inbound_never_log_no_technician, which calls app.sees_all_customers(account_id) with the ROW's
--   account, so no wrap applies (spec 2.4 item 4); and the 71 policies that call no helper per row.
--   After this file the live notes_member_all row, the one later migrations are told to copy, is the wrapped form.
--   policy-initplans-schema.test.ts pins the pre-0109 text of all 64, computes this file's text from it, and fails
--   naming any policy in public that calls a helper per row, except the one above.
--
-- GRANTS. None change. No function is added or altered (EXPECTED_DEFINERS stays 37); the client-write digest in
-- proposals-drop.test.ts stays 49|e0df0cc230da2dce6fa93b26b43e6d46.
--
-- LOCKS AND COST. The file runs as one transaction; lock_timeout 5s below bounds only the WAIT to take each lock.
--   alter policy takes ACCESS EXCLUSIVE on its table, held to the end of the file, so the 59 tables are locked one
--   after another, in table-name order, until it commits: every read and write of them waits that long. No table is
--   rewritten and no index is built: the file only replaces 64 catalog rows. MEASURED on a PostgreSQL 17.6 replica:
--   the whole file 253 to 367 ms wall (psql -1, three runs, on 0001-0108 with no rows), and 280 to 397 ms on a copy
--   holding 500,000 contacts (10 accounts of 50,000), 100,000 conversations and 200,000 messages, spec 3.1 seed.
--   On that copy, 20 timed runs after 3 warm-up, p95, as the app queries (spec 3.1): an unsearched contact list
--   newest first plus its count, as an Owner of a 50,000-contact account, 601.9 + 581.3 ms before and 40.1 + 16.1
--   after; as a Technician 58.7 + 44.4 and 17.3 + 15.2; as the agency 94.1 + 74.8 and 33.7 + 15.7; counting the
--   Owner's 50,000 conversations 523.2 and 7.4 ms. Every answer identical before and after (the page's ids and the
--   count). Production held 53 contacts on 2026-10-31: no off-peak rule.
--   A lock wait past 5 s, or a deadlock with a transaction holding one of these tables, aborts the whole file, which
--   is then simply run again.
--
-- LOAD-BEARING. Nothing in the app reads policy text. Every later migration that adds a tenant table copies the
-- house shape from the live notes_member_all row: from here on pg_policies shows it as
--   (( SELECT app.is_agency() AS is_agency) OR (account_id = ( SELECT app.current_account_id() AS current_account_id)))
-- which is ((select app.is_agency()) or account_id = (select app.current_account_id())) as written, and the guard
-- test fails naming any new policy that calls a helper bare.
--
-- ROLLBACK. Run each statement below with every (select app.is_agency()), (select app.current_account_id()) and
-- (select app.jwt()) put back as the bare call app.is_agency(), app.current_account_id(), app.jwt(). That is the
-- pre-0109 text exactly; policy-initplans-schema.test.ts holds it verbatim, policy by policy, as PRE.
--
-- ASCII only, no backslash anywhere, and every dollar sign in this file is part of a dollar-quote pair.

-- 0. Fail fast instead of queueing behind a long lock.
do $$
begin
  perform pg_catalog.set_config('lock_timeout', '5s', true);
end $$;

-- 1. The 64 policies, in table-name order.
alter policy account_ai_settings_agency_read on public.account_ai_settings
  using (COALESCE((select app.is_agency()), false));

alter policy account_billing_tenant on public.account_billing
  using (((select app.is_agency()) OR (account_id = (select app.current_account_id()))));

alter policy accounts_agency_all on public.accounts
  using ((select app.is_agency()))
  with check ((select app.is_agency()));

alter policy accounts_member_read on public.accounts
  using (((clerk_org_id = ((select app.jwt()) ->> 'org_id'::text)) AND client_access_enabled));

alter policy accounts_member_update on public.accounts
  using (((clerk_org_id = ((select app.jwt()) ->> 'org_id'::text)) AND client_access_enabled))
  with check (((clerk_org_id = ((select app.jwt()) ->> 'org_id'::text)) AND client_access_enabled));

alter policy agencies_agency_all on public.agencies
  using ((select app.is_agency()))
  with check ((select app.is_agency()));

alter policy ai_acts_member_read on public.ai_acts
  using (((select app.is_agency()) OR (account_id = (select app.current_account_id()))));

alter policy ai_gateway_settings_agency_read on public.ai_gateway_settings
  using (COALESCE((select app.is_agency()), false));

alter policy ai_ledger_agency_read on public.ai_ledger
  using (COALESCE((select app.is_agency()), false));

alter policy automation_log_tenant on public.automation_log
  using (((select app.is_agency()) OR (account_id = (select app.current_account_id()))));

alter policy automation_settings_tenant on public.automation_settings
  using (((select app.is_agency()) OR (account_id = (select app.current_account_id()))));

alter policy automations_tenant on public.automations
  using (((select app.is_agency()) OR (account_id = (select app.current_account_id()))))
  with check (((select app.is_agency()) OR (account_id = (select app.current_account_id()))));

alter policy blueprints_agency_all on public.blueprints
  using ((select app.is_agency()))
  with check ((select app.is_agency()));

alter policy bookings_tenant_read on public.bookings
  using (((select app.is_agency()) OR (account_id = (select app.current_account_id()))));

alter policy business_status_member_read on public.business_status
  using (((select app.is_agency()) OR (account_id = (select app.current_account_id()))));

alter policy calendars_tenant on public.calendars
  using (((select app.is_agency()) OR (account_id = (select app.current_account_id()))))
  with check (((select app.is_agency()) OR (account_id = (select app.current_account_id()))));

alter policy calls_tenant on public.calls
  using (((select app.is_agency()) OR (account_id = (select app.current_account_id()))))
  with check (((select app.is_agency()) OR (account_id = (select app.current_account_id()))));

alter policy checklist_items_member_all on public.checklist_items
  using (((select app.is_agency()) OR (account_id = (select app.current_account_id()))))
  with check (((select app.is_agency()) OR (account_id = (select app.current_account_id()))));

alter policy client_group_members_member_read on public.client_group_members
  using (((select app.is_agency()) OR (account_id = (select app.current_account_id()))));

alter policy client_groups_member_read on public.client_groups
  using (((select app.is_agency()) OR (account_id = (select app.current_account_id()))));

alter policy closed_days_member_read on public.closed_days
  using (((select app.is_agency()) OR (account_id = (select app.current_account_id()))));

alter policy consent_events_read on public.consent_events
  using (((select app.is_agency()) OR (account_id = (select app.current_account_id()))));

alter policy contact_duplicate_flags_member_insert on public.contact_duplicate_flags
  with check (((select app.is_agency()) OR (account_id = (select app.current_account_id()))));

alter policy contact_duplicate_flags_member_read on public.contact_duplicate_flags
  using (((select app.is_agency()) OR (account_id = (select app.current_account_id()))));

alter policy contact_relationships_member_all on public.contact_relationships
  using (((select app.is_agency()) OR (account_id = (select app.current_account_id()))))
  with check (((select app.is_agency()) OR (account_id = (select app.current_account_id()))));

alter policy contact_tags_member_all on public.contact_tags
  using (((select app.is_agency()) OR (account_id = (select app.current_account_id()))))
  with check (((select app.is_agency()) OR (account_id = (select app.current_account_id()))));

alter policy contacts_member_all on public.contacts
  using (((select app.is_agency()) OR (account_id = (select app.current_account_id()))))
  with check (((select app.is_agency()) OR (account_id = (select app.current_account_id()))));

alter policy conversations_member_read on public.conversations
  using (((select app.is_agency()) OR (account_id = (select app.current_account_id()))));

alter policy custom_fields_member_all on public.custom_fields
  using (((select app.is_agency()) OR (account_id = (select app.current_account_id()))))
  with check (((select app.is_agency()) OR (account_id = (select app.current_account_id()))));

alter policy custom_values_member_all on public.custom_values
  using (((select app.is_agency()) OR (account_id = (select app.current_account_id()))))
  with check (((select app.is_agency()) OR (account_id = (select app.current_account_id()))));

alter policy document_requests_member_read on public.document_requests
  using (((select app.is_agency()) OR (account_id = (select app.current_account_id()))));

alter policy document_requirement_skips_member_read on public.document_requirement_skips
  using (((select app.is_agency()) OR (account_id = (select app.current_account_id()))));

alter policy document_shares_member_read on public.document_shares
  using (((select app.is_agency()) OR (account_id = (select app.current_account_id()))));

alter policy document_versions_member_read on public.document_versions
  using (((select app.is_agency()) OR (account_id = (select app.current_account_id()))));

alter policy documents_member_read on public.documents
  using (((select app.is_agency()) OR (account_id = (select app.current_account_id()))));

alter policy equipment_member_all on public.equipment
  using (((select app.is_agency()) OR (account_id = (select app.current_account_id()))))
  with check (((select app.is_agency()) OR (account_id = (select app.current_account_id()))));

alter policy events_read on public.events
  using (((select app.is_agency()) OR (account_id = (select app.current_account_id()))));

alter policy form_submissions_member_read on public.form_submissions
  using (((select app.is_agency()) OR (account_id = (select app.current_account_id()))));

alter policy forms_member_all on public.forms
  using (((select app.is_agency()) OR (account_id = (select app.current_account_id()))))
  with check (((select app.is_agency()) OR (account_id = (select app.current_account_id()))));

alter policy inbound_emails_member_read on public.inbound_emails
  using (((select app.is_agency()) OR (account_id = (select app.current_account_id()))));

alter policy inbound_never_log_member_read on public.inbound_never_log
  using ((COALESCE((select app.is_agency()), false) OR (account_id = (select app.current_account_id()))));

alter policy memberships_agency_read on public.memberships
  using ((select app.is_agency()));

alter policy memberships_member_read on public.memberships
  using ((account_id = (select app.current_account_id())));

alter policy messages_member_read on public.messages
  using (((select app.is_agency()) OR (account_id = (select app.current_account_id()))));

alter policy notes_member_all on public.notes
  using (((select app.is_agency()) OR (account_id = (select app.current_account_id()))))
  with check (((select app.is_agency()) OR (account_id = (select app.current_account_id()))));

alter policy opportunities_member_all on public.opportunities
  using (((select app.is_agency()) OR (account_id = (select app.current_account_id()))))
  with check (((select app.is_agency()) OR (account_id = (select app.current_account_id()))));

alter policy phone_numbers_tenant on public.phone_numbers
  using (((select app.is_agency()) OR (account_id = (select app.current_account_id()))))
  with check (((select app.is_agency()) OR (account_id = (select app.current_account_id()))));

alter policy pipeline_stages_member_all on public.pipeline_stages
  using (((select app.is_agency()) OR (account_id = (select app.current_account_id()))))
  with check (((select app.is_agency()) OR (account_id = (select app.current_account_id()))));

alter policy pipelines_member_all on public.pipelines
  using (((select app.is_agency()) OR (account_id = (select app.current_account_id()))))
  with check (((select app.is_agency()) OR (account_id = (select app.current_account_id()))));

alter policy places_member_all on public.places
  using (((select app.is_agency()) OR (account_id = (select app.current_account_id()))))
  with check (((select app.is_agency()) OR (account_id = (select app.current_account_id()))));

alter policy plans_agency_read on public.plans
  using ((select app.is_agency()));

alter policy proposals_member_read on public.proposals
  using (((select app.is_agency()) OR (account_id = (select app.current_account_id()))));

alter policy record_summaries_member_read on public.record_summaries
  using (((select app.is_agency()) OR (account_id = (select app.current_account_id()))));

alter policy site_traffic_breakdown_tenant on public.site_traffic_breakdown
  using (((select app.is_agency()) OR (account_id = (select app.current_account_id()))));

alter policy site_traffic_daily_tenant on public.site_traffic_daily
  using (((select app.is_agency()) OR (account_id = (select app.current_account_id()))));

alter policy sites_tenant on public.sites
  using (((select app.is_agency()) OR (account_id = (select app.current_account_id()))));

alter policy tags_member_all on public.tags
  using (((select app.is_agency()) OR (account_id = (select app.current_account_id()))))
  with check (((select app.is_agency()) OR (account_id = (select app.current_account_id()))));

alter policy tasks_member_all on public.tasks
  using (((select app.is_agency()) OR (account_id = (select app.current_account_id()))))
  with check (((select app.is_agency()) OR (account_id = (select app.current_account_id()))));

alter policy usage_events_tenant on public.usage_events
  using (((select app.is_agency()) OR (account_id = (select app.current_account_id()))));

alter policy users_agency_read on public.users
  using ((select app.is_agency()));

alter policy users_member_read on public.users
  using ((EXISTS ( SELECT 1
   FROM public.memberships m
  WHERE ((m.user_id = users.id) AND (m.scope = 'account'::text) AND (m.account_id = (select app.current_account_id()))))));

alter policy voice_knowledge_snapshots_member_read on public.voice_knowledge_snapshots
  using (((select app.is_agency()) OR (account_id = (select app.current_account_id()))));

alter policy voice_profiles_tenant on public.voice_profiles
  using (((select app.is_agency()) OR (account_id = (select app.current_account_id()))))
  with check (((select app.is_agency()) OR (account_id = (select app.current_account_id()))));

alter policy voice_services_member_read on public.voice_services
  using (((select app.is_agency()) OR (account_id = (select app.current_account_id()))));
