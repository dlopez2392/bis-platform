-- 0101_account_trade.sql - every company's trade, and the only trades the database accepts
-- (S-53 tenant vetting; docs/superpowers/specs/2026-10-27-tenant-vetting-design.md sections 3-4;
--  docs/superpowers/plans/2026-10-27-s53-tenant-vetting.md, Task 1)
--
-- WHY. The plan's holds (adult day care and home health turned away; HIPAA verticals, law firms and tax
-- preparers held; restaurants and child care CRM-only) lived only in prose: Add company recorded no trade.
-- The verdicts live in ONE code module (apps/web/src/lib/vetting/trades.ts); this file records each
-- company's trade and makes the database itself refuse every trade that may not be created (owner
-- decision V4, 2026-10-27).
--
-- WHAT THIS FILE ADDS:
--   public.accounts.trade        the company's trade, a key from trades.ts. NULL = not recorded yet (every
--                                company that exists before this file, until the agency sets it).
--   public.accounts.trade_other  what the business does, one line, only for trade 'other' (owner decision V2).
--   accounts_trade_check             trade is NULL or one of the 21 CREATABLE keys (every 'allowed' and
--                                    'crm_only' entry in trades.ts, 'other' included). A held or turned-away
--                                    key is refused here, whatever the app does. trades.test.ts (apps/web)
--                                    parses this list and requires it to equal creatableTradeKeys();
--                                    account-trade-schema.test.ts (packages/db) requires the live
--                                    constraint to equal this file.
--   accounts_trade_other_check       trade 'other' needs a description that is not blank and at most 120
--                                    characters. Written with an explicit "is not null": a CHECK passes when
--                                    it evaluates to NULL, so "length(btrim(trade_other)) between 1 and 120"
--                                    alone would admit 'other' with no description at all.
--   accounts_trade_other_only_check  a description only beside 'other'. "is not distinct from", not "=",
--                                    for the same reason: with trade NULL, "trade = 'other'" is NULL and
--                                    the CHECK would pass a description on a company with no trade.
--
-- WHO WRITES. Only service_role: createAccount (Add company and Add as a company, behind requireAgency) and
-- setAccountTrade (the agency's Settings Trade card, behind requireAgencyOnlyAccountAccess), each after the
-- module's own validation.
--
-- GRANTS AND POLICIES. No grant changes. 0013 revoked table-level UPDATE on accounts from authenticated and
-- re-granted nine columns; a new column gets no column grant, so no client session and no agency session
-- can UPDATE trade or trade_other (client-branding-grants.test.ts's exact UPDATE set and EXPECTED_WRITES in
-- schema-grants-guard.test.ts are unchanged and keep pinning that). authenticated keeps the table-level
-- INSERT it has had since 0001, which RLS admits only for the agency (accounts_agency_all): an agency
-- session writing through the data API could insert a creatable trade, never a held one (the CHECK). No
-- client role can insert an account. The client-write digest (proposals-drop.test.ts) counts table-level
-- privileges only, so it stays 52|b66203ca5d355155540b520af510d120. SELECT stays table-level: a company's
-- own members can read trade through the data API; the app never shows it to them (spec 5.2).
--
-- SEARCH PATHS (0096 rule). This file creates no function. EXPECTED_DEFINERS is unchanged (23).
--
-- TEARDOWN. Two columns on accounts; nothing new to delete, ACCOUNT_OWNED_TABLES is unchanged.
--
-- LOCKS. ACCESS EXCLUSIVE on accounts for the length of this file. The two columns are nullable with no
-- default (no rewrite); each CHECK is validated by one scan of accounts (a handful of rows, every one with
-- trade NULL, so all three pass). Every in-account page reads accounts, so a lock queued behind a long
-- transaction would stall them: lock_timeout 5s is the protection.
--
-- APPLY ORDER: after 0100 everywhere. CI project (ci-project-setup.yml: push-dry-run, then push), then
-- production (MCP apply_migration, once), then the parity check, then merge.
-- LOAD-BEARING: the build after this file selects accounts.trade on the accounts, Setup, Settings and Voice
-- pages and in every Sofia and web-chat on-switch, and inserts it on Add company. PostgREST refuses a column
-- it does not know, so production gets this file BEFORE the merge deploy.
-- SAFE UNDER THE RUNNING BUILD: additive. The running build names neither column, and every row it inserts
-- has trade NULL, which all three CHECKs admit.
--
-- CHANGING A VERDICT (owner decision V3). Moving a key into or out of the creatable list is a dated owner
-- decision, a change to trades.ts and a NEW migration that drops and re-adds accounts_trade_check (deciding
-- first what happens to companies that hold a key leaving the list). Never edit this file once applied.
--
-- ROLLBACK (roll the app back first; loses every recorded trade):
--   alter table public.accounts drop constraint accounts_trade_other_only_check,
--     drop constraint accounts_trade_other_check, drop constraint accounts_trade_check,
--     drop column trade_other, drop column trade;
--
-- ASCII only, no backslash anywhere, and every dollar sign in this file is part of a dollar-quote pair.

-- 0. Fail fast instead of queueing behind a long lock (0094 reason: inside a do block).
do $$
begin
  perform pg_catalog.set_config('lock_timeout', '5s', true);
end $$;

alter table public.accounts
  add column trade text,
  add column trade_other text;

alter table public.accounts
  add constraint accounts_trade_check check (trade is null or trade in (
    'hvac', 'plumbing', 'electrical', 'roofing', 'landscaping', 'pool', 'pest_control', 'cleaning',
    'painting', 'remodeling', 'woodworking', 'handyman', 'auto', 'beauty', 'fitness', 'insurance',
    'real_estate', 'events', 'restaurant', 'child_care', 'other')),
  add constraint accounts_trade_other_check check (
    trade is distinct from 'other'
    or (trade_other is not null and btrim(trade_other) <> '' and length(trade_other) <= 120)),
  add constraint accounts_trade_other_only_check check (
    trade_other is null or trade is not distinct from 'other');

comment on column public.accounts.trade is
  'S-53: the company''s trade, a key from apps/web/src/lib/vetting/trades.ts. Only creatable keys (accounts_trade_check); NULL = not recorded yet. Decides whether Sofia and the web chat may be switched on. Written only by service_role (createAccount, setAccountTrade); never shown to the company''s own users.';
comment on column public.accounts.trade_other is
  'S-53: what the business does, one line of at most 120 characters, present only when trade = ''other'' (accounts_trade_other_check, accounts_trade_other_only_check).';

notify pgrst, 'reload schema';
