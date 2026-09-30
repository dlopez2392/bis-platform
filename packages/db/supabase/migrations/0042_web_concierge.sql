-- The web concierge: a text assistant a client embeds on their OWN website.
--
-- Three columns on voice_profiles and one new table. The profile is where
-- this belongs because the persona already lives there — persona_name, both
-- greetings, facts, services, languages, after_hours. The widget speaks as
-- THAT business because it reads THAT row. See
-- docs/superpowers/specs/2026-09-20-web-concierge-design.md.

-- The address. NULLABLE and minted lazily by app code the first time the
-- concierge is switched on: newPublicId() (packages/db/src/forms.ts:54) is
-- 12 random bytes over an app-side alphabet, so no SQL default matches it,
-- and backfilling every profile would mint addresses for accounts that will
-- never use one. Postgres allows many nulls under a unique constraint.
alter table public.voice_profiles add column public_id text unique;

-- SEPARATE from `enabled`, which is the PHONE line. A client may want the
-- website assistant without the phone receptionist, or the reverse. This
-- joins booking_enabled and textback_enabled as a third per-feature switch.
alter table public.voice_profiles
  add column concierge_enabled boolean not null default false;

-- Which form a widget-captured lead files into. enrich() takes a FormRow and
-- form_submissions.form_id is NOT NULL, so there is no path into the CRM
-- without one — the operator chooses it, and the toggle cannot be switched
-- on until they have.
--
-- `set null`, NOT `restrict`: deleting a form must not be blocked by this
-- pointer, it must turn the widget off. A null here reads as "not
-- configured" and the route refuses — the fail-closed direction.
alter table public.voice_profiles
  add column concierge_form_id uuid references public.forms(id) on delete set null;

-- One row per visitor conversation.
--
-- WHY SERVER-SIDE AT ALL. The turn cap is the one guard this repo has never
-- needed: every existing limiter assumes one POST is one interaction (5 per
-- 10 minutes). A real conversation is ten turns in four minutes. A design
-- where the browser posts the transcript and the count each turn hands the
-- counter to the attacker — they reset it by not sending it. The transcript
-- lives here for the same reason: decision 1's whole premise is that the
-- typed conversation IS the lead's record, and a record the client holds is
-- not one.
--
-- WHY NOT A `calls` ROW. `calls` feeds ANSWERED_OUTCOMES and the weekly
-- report's "calls answered", a number a client reads on Monday morning. A
-- website chat is not a call. Same refusal, same reason, as
-- 0039_screened_calls.sql, 0040_call_proposals.sql and 0041.
--
-- WHY NOT A `conversations` ROW. That table is the OPERATOR's inbox thread,
-- and enrich() already opens one when a lead is filed. This is the
-- visitor-side conversation, which exists before and mostly without a lead.
create table public.concierge_conversations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  -- Captured at conversation START, not read per turn: an operator changing
  -- the destination form mid-conversation must not strand a lead halfway.
  -- `restrict` for 0006_forms.sql:39-41's stated reason — these carry leads,
  -- and deleting a form must never be able to destroy them.
  form_id uuid not null references public.forms(id) on delete restrict,
  -- HMAC-keyed, never the raw address (forms/guards.ts's hashIp).
  ip_hash text not null,
  -- The cap's counter. Claimed atomically by concierge_claim_turn below,
  -- never read-then-written.
  turn_count int not null default 0,
  -- [{role, text, at}] — the same shape as calls.transcript's
  -- TranscriptEvent, so one reader renders both.
  transcript jsonb not null default '[]'::jsonb,
  -- Set once, when capture_lead first succeeds. Its non-null-ness is what
  -- stops a second submission for the same visitor.
  submission_id uuid references public.form_submissions(id) on delete set null,
  locale text not null default 'en',
  attribution jsonb not null default '{}'::jsonb,
  -- Which site the frame was embedded on. Nullable: Origin is a browser
  -- courtesy, not a guarantee.
  origin text,
  created_at timestamptz not null default now(),
  last_turn_at timestamptz not null default now()
);

-- The two counters the route reads before starting a conversation.
create index concierge_conversations_ip_idx
  on public.concierge_conversations (ip_hash, created_at desc);
create index concierge_conversations_account_idx
  on public.concierge_conversations (account_id, created_at desc);

-- THE TURN CLAIM, ATOMIC.
-- Read-then-write loses the race: two turns posted together both read N and
-- both write N+1, and the cap leaks. One statement cannot. Returns the new
-- count, or no row at all when the cap is already reached. Precedent:
-- increment_conversation_unread, called through db.rpc at
-- packages/db/src/messaging.ts:498.
create function public.concierge_claim_turn(p_conversation_id uuid, p_max int)
returns int language sql as $fn$
  update public.concierge_conversations
     set turn_count = turn_count + 1, last_turn_at = now()
   where id = p_conversation_id and turn_count < p_max
  returning turn_count;
$fn$;

-- ⚠️ THE GRANTS ARE THE SECURITY BOUNDARY HERE, NOT THE POLICY.
-- This project's default ACL auto-grants ALL privileges to `anon` AND
-- `authenticated` on every new table (0020_voice_grants_revoke.sql exists
-- because of exactly this; 0033 shipped without a grant block and still
-- carries INSERT/UPDATE/DELETE to `anon`). Revoke everything, then grant
-- back only what is needed.
--
-- Nothing but the concierge route reads or writes this, and the route uses
-- serviceDb(). So: service_role only, no `authenticated` grant at all — the
-- same shape as screened_calls and voice_web_sessions, narrower than
-- call_proposals, which a human reviews in the UI. No policy is needed for
-- service_role (it bypasses RLS); RLS is enabled anyway so the table is
-- never accidentally world-readable if a grant is ever widened.
alter table public.concierge_conversations enable row level security;
revoke all on public.concierge_conversations from anon, authenticated;
grant select, insert, update, delete on public.concierge_conversations to service_role;

-- The function runs as its caller, so it needs no elevated privilege; revoke
-- the default PUBLIC execute so only service_role can reach it.
revoke all on function public.concierge_claim_turn(uuid, int) from public;
grant execute on function public.concierge_claim_turn(uuid, int) to service_role;
