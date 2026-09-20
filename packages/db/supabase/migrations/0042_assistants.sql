-- The website assistant becomes an ACCOUNT-OWNED OBJECT, like a form or a
-- calendar: a public id, a hosted page, a one-line embed.
--
-- WHY THIS EXISTS. bis-rgv.com's chat assistant lives in the marketing
-- site's repo, knows only BIS, and files leads through a hand-set shared
-- secret. Every client of this platform should be able to switch the same
-- assistant on for THEIR website, have it talk about THEIR business, and
-- have its leads land in THEIR CRM. That is a tenant object, so it is a
-- table with `account_id` on every row and the house member policy over it
-- — not a config file and not an environment variable.
--
-- THREE TABLES, THREE DIFFERENT AUDIENCES, THREE DIFFERENT GRANT SETS:
--   assistants         — the client's own settings. They read and write it.
--   assistant_sessions — a visitor's conversation. They READ it (phase 2
--                        shows transcripts); only the server writes it.
--   assistant_turns    — the cap counter and cost ledger. Server only.
-- The grants below are what enforce that, not the policies. See the grant
-- block on each table.
--
-- WHY `assistant_turns` IS NOT A `calls` ROW AND NEVER COUNTED AS ONE.
-- `calls` feeds ANSWERED_OUTCOMES and the weekly report's "calls answered",
-- a number a client reads on Monday morning. A typed chat turn is not a
-- call answered. Same refusal, for the same reason, as
-- 0039_screened_calls.sql, 0040_call_proposals.sql and
-- 0041_voice_web_sessions.sql.
--
-- ON `updated_at`: checked before inventing anything — this schema has NO
-- updated_at trigger and no trigger function to reuse (no `create trigger`
-- and no `moddatetime` anywhere in migrations 0001-0041). Every table that
-- carries `updated_at` is stamped by the WRITER instead
-- (`forms.ts:updateForm`, `booking.ts:updateCalendarSettings`,
-- `contacts.ts:updateContact`, `messaging.ts`). `assistants.ts` does the
-- same, and the column-level UPDATE grant below deliberately includes
-- `updated_at` so an `authenticated` writer can stamp it — the same reason
-- 0018_calendars_updated_at_grant.sql exists.

create table public.assistants (
  id uuid primary key default gen_random_uuid(),
  -- One assistant per account is SCHEMA, not convention — the same call
  -- 0016 made for `calendars`. Cascade, not restrict: an assistant's
  -- settings are configuration, not a lead, so the account's own deletion
  -- carries it away (see account-teardown.ts's doc-block on which tables
  -- ride the account cascade and which must be deleted by hand first).
  account_id uuid not null references public.accounts(id) on delete cascade,
  constraint assistants_one_per_account unique (account_id),
  -- The URL. Opaque `newPublicId()` alphabet (forms.ts), NOT a slug: a
  -- guessable /a/acme would let anyone enumerate every client's assistant
  -- by name, exactly the argument 0006_forms.sql makes for forms.
  public_id text not null unique,
  -- Off means the hosted page AND the chat API both 404 — the same answer
  -- as an id that never existed, on purpose.
  enabled boolean not null default true,
  -- The header label ("BIS Assistant"). A CUSTOMER-FACING name, so the
  -- settings UI seeds it from `brandDisplayName`, never `accounts.name`
  -- (the agency's internal label, which has leaked to customers before).
  name text not null default 'Assistant',
  -- The lead sink. Null means the model gets no `capture_lead` tool at all
  -- rather than a tool that fails. `set null`, not `restrict`: forms are
  -- archived rather than deleted, but if one ever is deleted the assistant
  -- must survive it without a tool, the same treatment
  -- `form_submissions.contact_id` gets in 0006.
  form_id uuid references public.forms(id) on delete set null,
  -- Owner-written facts, plain text, injected into the prompt as REFERENCE
  -- DATA (the prompt says so explicitly), never as instructions.
  knowledge text not null default '',
  -- { "en"?: url, "es"?: url } — fetched at request time and cached, so a
  -- client's own site can be the source of truth without this table
  -- holding a stale copy of it.
  knowledge_urls jsonb not null default '{}'::jsonb,
  -- [{ "q": string, "a": string }]
  faq jsonb not null default '[]'::jsonb,
  -- { "en"?: string, "es"?: string }. Empty means the widget uses the
  -- platform default greeting from public-strings.ts, not an empty bubble.
  greeting jsonb not null default '{}'::jsonb,
  -- { "en"?: string[], "es"?: string[] } — the chips above an empty
  -- transcript. At most 3 are shown; the cap is the widget's, not the
  -- column's, so a client can keep a longer list and reorder it.
  suggestions jsonb not null default '{}'::jsonb,
  locale_default text not null default 'en'
    check (locale_default in ('en','es')),
  -- Reserved for frame-ancestors enforcement in phase 2. Stored NOW so the
  -- BIS seed can carry its origin from day one and phase 2 is a read, not
  -- a migration plus a backfill.
  allowed_origins text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.assistants is
  'One website chat assistant per account. public_id is the URL; enabled=false means the page and the chat API both 404.';

-- One row per widget conversation. The id is SERVER-issued and handed back
-- in the `x-bis-session` response header; the browser never chooses it,
-- which is why it is a uuid default and not anything the client supplies.
create table public.assistant_sessions (
  id uuid primary key default gen_random_uuid(),
  assistant_id uuid not null references public.assistants(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  -- HMAC-keyed (forms/guards.ts's `hashIp`), NEVER the address. Rate
  -- limiting needs only equality, and a visitor's IP is personal data we
  -- have no reason to hold — 0006_forms.sql's argument, unchanged.
  ip_hash text not null,
  locale text not null check (locale in ('en','es')),
  -- The host page the visitor was on. Nullable: the embed passes it, a
  -- direct visit to /a/<id> has none.
  page_url text,
  -- [{ role: 'user'|'assistant', text, at }], capped at 60 entries by the
  -- writer. The cap lives in the app, not in a CHECK, because the failure
  -- mode of a CHECK here is a REFUSED write in the middle of a live
  -- conversation, which is worse than a long transcript.
  transcript jsonb not null default '[]'::jsonb,
  turns integer not null default 0 check (turns >= 0),
  -- Set when `capture_lead` files. `set null` on both: a session is a
  -- record of a conversation and must outlive the lead row it produced,
  -- which is the same reasoning 0006 gives for form_submissions.contact_id.
  submission_id uuid references public.form_submissions(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.assistant_sessions is
  'One visitor conversation with an account''s website assistant. Written by the server only; phase 2 reads transcripts in the dashboard.';

-- The dashboard list (phase 2): this account's conversations, newest first.
create index assistant_sessions_account_idx
  on public.assistant_sessions (account_id, created_at desc);
-- The returning-visitor lookup, which arrives with a hashed IP and no
-- tenant context, so it is not account-scoped — same shape and same reason
-- as form_submissions_rate (0006).
create index assistant_sessions_ip_idx
  on public.assistant_sessions (ip_hash, updated_at desc);

-- One row per model call: the cap counters and the cost ledger. Separate
-- from `assistant_sessions` because the counters are read BEFORE the model
-- call, on every request, and must not depend on scanning transcripts.
create table public.assistant_turns (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.assistant_sessions(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  ip_hash text not null,
  -- From the provider's own usage report. Zero is the honest default for a
  -- provider that returned none; a negative number is not a thing a usage
  -- report can mean, so the database refuses it (0029's shape).
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  created_at timestamptz not null default now()
);

comment on table public.assistant_turns is
  'One row per assistant model call: the per-IP and per-account rate-limit counters, and the token cost ledger. NOT a call and never counted as one.';

-- The two counters the chat route reads BEFORE it calls the model.
create index assistant_turns_ip_idx
  on public.assistant_turns (ip_hash, created_at desc);
create index assistant_turns_account_idx
  on public.assistant_turns (account_id, created_at desc);

alter table public.assistants enable row level security;
alter table public.assistant_sessions enable row level security;
alter table public.assistant_turns enable row level security;

-- The house member policy, copied from the live `notes_member_all` row
-- (generated by 0003_crm_core.sql) and matching the forms block in
-- 0006_forms.sql verb for verb. `to authenticated`, never PUBLIC — 0016
-- shipped the only PUBLIC-scoped policies in this schema and 0017 exists
-- to undo them; the grants test below pins `pg_policies.roles` so that
-- cannot happen again.
create policy assistants_member_all on public.assistants
  for all to authenticated
  using (app.is_agency() or account_id = app.current_account_id())
  with check (app.is_agency() or account_id = app.current_account_id());

-- SELECT ONLY, deliberately: a transcript is a RECORD of what a visitor
-- and the model said. A client who could edit or delete one could rewrite
-- history the lead in it came from. Writes belong to the route, which uses
-- serviceDb(). Same shape as `sites_tenant` (0029).
create policy assistant_sessions_member_read on public.assistant_sessions
  for select to authenticated
  using (app.is_agency() or account_id = app.current_account_id());

-- `assistant_turns` gets NO policy at all. RLS on with no policy is
-- deny-all, and the grant block below gives no client role anything to
-- deny — the belt-and-braces shape 0041_voice_web_sessions.sql uses, so a
-- future widened grant cannot silently open the ledger.

-- ⚠️ THE GRANTS ARE THE SECURITY BOUNDARY HERE, NOT THE POLICIES.
-- This project's default ACL auto-grants ALL privileges to `anon` AND
-- `authenticated` on every new table (config.toml's
-- `auto_expose_new_tables` block describes the LOCAL CLI and is unset
-- here; the live default ACL is the thing that matters).
-- 0020_voice_grants_revoke.sql exists because of exactly this, and 0033
-- shipped without a grant block and still carries INSERT/UPDATE/DELETE to
-- `anon` today. So: revoke everything from both client roles first, then
-- grant back only what each caller genuinely needs.
revoke all on public.assistants from anon, authenticated;
revoke all on public.assistant_sessions from anon, authenticated;
revoke all on public.assistant_turns from anon, authenticated;

-- The client configures their own assistant from Settings (phase 2), so
-- this table — unlike the two below it — is genuinely client-writable.
grant select on public.assistants to authenticated;
-- INSERT is table-level because creating the row means writing
-- `account_id` and `public_id` themselves; RLS's `with check` is what
-- keeps that `account_id` the caller's own.
grant insert on public.assistants to authenticated;
-- UPDATE is COLUMN-LEVEL (0016_booking.sql:84-88's shape, and
-- 0040_call_proposals.sql's). The list is exactly the settings a client
-- edits — which is exactly `AssistantPatch` in assistants.ts, plus
-- `updated_at`, which the writer stamps. What is NOT on it is the point:
-- `id`, `created_at`, the tenancy anchor `account_id`, and `public_id`,
-- the capability that IS the assistant's URL. A client who could rewrite
-- `public_id` could take over a token someone else's site already embeds;
-- a client who could rewrite `account_id` would be attempting a tenancy
-- move that RLS would refuse anyway, and there is no reason to let them
-- reach the attempt.
grant update (
  enabled, name, form_id, knowledge, knowledge_urls, faq, greeting,
  suggestions, locale_default, allowed_origins, updated_at
) on public.assistants to authenticated;
grant select, insert, update, delete on public.assistants to service_role;

-- Read-only for the dashboard (phase 2 shows transcripts), written by the
-- chat route alone.
grant select on public.assistant_sessions to authenticated;
grant select, insert, update, delete on public.assistant_sessions to service_role;

-- Service role only. Nothing in the app reads the ledger as a client: the
-- caps are enforced server-side before the model call, and a client who
-- could read another tenant's turn rows could infer their traffic.
grant select, insert, update, delete on public.assistant_turns to service_role;

-- `anon` is granted NOTHING on any of the three, and that absence is the
-- control. The hosted page /a/<publicId> and the chat API are public
-- surfaces, but they reach these tables through serviceDb() on the server
-- — the browser never holds a key that can touch them.
