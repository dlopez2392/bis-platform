-- 0094_trade_modules.sql - Sofia's trade rules: which module an account runs, and which module and
-- version each call and each website chat ran under (S-47 part b; F-174 part; decisions 21 and 28)
-- (docs/superpowers/specs/2026-10-21-sofia-trade-modules-design.md section 4;
--  docs/superpowers/plans/2026-10-21-sofia-trade-modules-pr47b.md, Task 1)
--
-- WHY. Sofia is sold to insurance agencies and event venues (S-47). Each trade gets a versioned block of
-- rules in code (apps/web/src/lib/voice/modules/, owner decision B6), picked per account by the agency on
-- the Voice page (B1). Guardrails are never owner-editable (decision 28), so the setting is the agency's
-- alone. Every call and every website chat records the module and version it ran under, so a transcript
-- can always be read against the exact wording that produced it.
--
-- FIVE COLUMNS:
--   public.voice_profiles.trade_module text, nullable, one of insurance_pc, events. NULL means the general
--     rules only (the behaviour before this file). NULL is the one spelling of none: the CHECK admits no
--     none value.
--   public.calls.trade_module text and public.calls.trade_module_version integer, both nullable. Written
--     once, at call start, by the incoming call route, from the same profile read that built the prompt.
--     Both NULL for a call with no module and for every call before this file.
--   public.concierge_conversations.trade_module and trade_module_version: the same pair, written once when
--     the concierge turn route creates the conversation. Every later turn builds its prompt from this stamp,
--     so a chat that spans an agency change keeps one set of rules.
--   The pairing is enforced, not only promised: each table has a pair CHECK (NULL together or set
--   together), a module CHECK (the same two values) and a version CHECK (a positive integer).
--
-- WHO WRITES THEM. voice_profiles.trade_module: the agency only, through serviceDb(), behind the app
-- agency check, in saveVoiceProfileAction (the Voice page Save). calls: the server only, in startCallRow.
-- concierge_conversations: the server only, in createConciergeConversation.
--
-- GRANTS: NONE, and the absence is the control (the same reasoning as 0093 and 0058 before it).
--   authenticated has table SELECT on voice_profiles and calls (0019) and no write verb on either (0020;
--   0053 revoked maintain), so a client Owner reads the module and never writes it (decision 28), and
--   nobody but the server stamps a call. That includes the agency own authenticated token.
--   concierge_conversations has no grant at all to anon or authenticated (0042 revoked all); only
--   service_role reads or writes it, and nothing here changes that. anon gains nothing anywhere.
--   service_role writes through the project default privileges. The client-write digest is unchanged.
--
-- NO RLS POLICY CHANGE. voice_profiles_tenant and calls_tenant (0019), the restrictive
-- calls_technician_scope (0068), and the policy-free deny-all on concierge_conversations (0042) are row
-- level and cover every column added today.
--
-- APPLY ORDER: CI project (ci-project-setup.yml: push-dry-run, then push), then production (MCP
-- apply_migration, once), then the parity check, then merge. The migration goes BEFORE the code. Four
-- sites in the build after this file name these columns, and PostgREST fails a request naming a column it
-- does not know: every voice profile read (PROFILE_COLS), every call detail read (CALL_DETAIL_COLS), every
-- later chat turn (CONVO_COLS), and the Voice page save, whose patch carries trade_module
-- (saveVoiceProfileAction through upsertVoiceProfile).
-- SAFE UNDER THE RUNNING BUILD: additive. The running build never names any of the five columns; all five
-- are nullable with no default, so its inserts leave them NULL, which every CHECK here admits.
--
-- ROLLBACK (roll the app back first), in this order; the four stamp columns only on an owner decision,
-- because they drop the record of which rules each call and chat ran under:
--   alter table public.concierge_conversations drop column trade_module_version;  (its CHECK and the pair
--                                                                                   CHECK go with it)
--   alter table public.concierge_conversations drop column trade_module;          (its CHECK goes with it)
--   alter table public.calls drop column trade_module_version;                    (its CHECK and the pair
--                                                                                   CHECK go with it)
--   alter table public.calls drop column trade_module;                            (its CHECK goes with it)
--   alter table public.voice_profiles drop column trade_module;                   (its CHECK goes with it)
--
-- ASCII only, no backslash anywhere.

-- 0. Fail fast instead of queueing behind a long lock (0091 reason: inside a do block, so it is always in
--    the block transaction). The three ALTERs take ACCESS EXCLUSIVE on tables the call and chat paths read
--    on every call and every turn.
do $$
begin
  perform pg_catalog.set_config('lock_timeout', '5s', true);
end $$;

-- 1. The setting.
alter table public.voice_profiles
  add column trade_module text
    constraint voice_profiles_trade_module_check check (trade_module in ('insurance_pc', 'events'));

comment on column public.voice_profiles.trade_module is
  'Which trade rules the receptionist follows on calls and in the website chat: insurance_pc (insurance, property and casualty) or events (events and venues). NULL means the general rules only. Agency-written through serviceDb() by saveVoiceProfileAction; authenticated has SELECT and deliberately no UPDATE (decision 28: guardrails are never owner-editable).';

-- 2. The per-call stamp.
alter table public.calls
  add column trade_module text
    constraint calls_trade_module_check check (trade_module in ('insurance_pc', 'events')),
  add column trade_module_version integer
    constraint calls_trade_module_version_check check (trade_module_version > 0),
  add constraint calls_trade_module_pair_check check ((trade_module is null) = (trade_module_version is null));

comment on column public.calls.trade_module is
  'The trade rules this call ran under (insurance_pc or events), set once at call start by the incoming call route (startCallRow) from the same voice profile read that built the prompt. NULL for a call with no module and for every call before 0094. NULL exactly when trade_module_version is NULL (calls_trade_module_pair_check). Server-written only.';

comment on column public.calls.trade_module_version is
  'The VERSION of the module file whose wording this call ran under, written with trade_module at call start by the incoming call route (startCallRow). A positive integer (calls_trade_module_version_check); NULL exactly when trade_module is NULL (calls_trade_module_pair_check). Server-written only.';

-- 3. The per-chat stamp.
alter table public.concierge_conversations
  add column trade_module text
    constraint concierge_conversations_trade_module_check check (trade_module in ('insurance_pc', 'events')),
  add column trade_module_version integer
    constraint concierge_conversations_trade_module_version_check check (trade_module_version > 0),
  add constraint concierge_conversations_trade_module_pair_check
    check ((trade_module is null) = (trade_module_version is null));

comment on column public.concierge_conversations.trade_module is
  'The trade rules this website chat runs under (insurance_pc or events), set once when the concierge turn route creates the conversation (createConciergeConversation); every later turn builds its prompt from this stamp, not from a fresh profile read. NULL for a chat with no module and for every chat before 0094. NULL exactly when trade_module_version is NULL (concierge_conversations_trade_module_pair_check). Server-written only.';

comment on column public.concierge_conversations.trade_module_version is
  'The VERSION of the module file current when the conversation was created, written with trade_module by the concierge turn route at creation (createConciergeConversation). A positive integer (concierge_conversations_trade_module_version_check); NULL exactly when trade_module is NULL. Server-written only.';
