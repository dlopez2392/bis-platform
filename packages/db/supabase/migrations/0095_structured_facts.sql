-- 0095_structured_facts.sql - Sofia knowledge as records: business hours, a price list she quotes word
-- for word, and a numbered snapshot of exactly what she was given, stamped on every call and website
-- chat (S-47 part c; F-037 part 1; decisions 21 and 28)
-- (docs/superpowers/specs/2026-10-23-sofia-structured-facts-design.md section 4;
--  docs/superpowers/plans/2026-10-23-sofia-structured-facts-pr47c.md, Task 1)
--
-- WHY. Until this file everything Sofia knew about a business was two free-text boxes (facts, services)
-- pasted into her prompt. She worked out whether the business was open herself, any amount anywhere in
-- the prose was quotable in her own words, and nobody could tell afterwards what she had been told on
-- the afternoon of a given call. Now the hours and the prices are records, code renders each price into
-- one fixed sentence per language, and every call and chat records the numbered snapshot of what she was
-- given (owner decisions C1 to C4).
--
-- WHAT THIS FILE ADDS:
--   public.voice_profiles.business_hours  jsonb, NULL = no structured hours (the behaviour before this
--     file). The calendars.open_hours shape (0016). Only an object is admitted by the CHECK; the inner
--     shape is checked by app.voice_business_hours_valid inside save_voice_knowledge (0016 set the
--     precedent of no deep CHECK on this JSON).
--   public.voice_services  the price list: up to 50 ordered rows per account, six price kinds, each kind
--     carrying exactly its amounts (voice_services_price_shape_check). No text column may hold a line
--     break: a name is one prompt line, and a break would start a line of instructions.
--   public.voice_knowledge_snapshots  append-only, numbered 1, 2, 3 per account, the payload exactly as
--     she is given it. Never edited (a BEFORE UPDATE trigger raises) and never deleted by any role
--     (UPDATE, DELETE and TRUNCATE are granted to nobody); rows leave only with their account, because
--     referential actions run as the table owner.
--   public.calls.knowledge_version and public.concierge_conversations.knowledge_version  the snapshot each
--     call and chat started under, with a composite foreign key to a snapshot of the SAME account. NULL
--     for every call and chat before this file, and for one whose snapshot could not be recorded.
--   app.voice_business_hours_valid, public.save_voice_knowledge, public.ensure_knowledge_snapshot.
--
-- WHO WRITES. Only the two functions, run as the function owner (security definer), EXECUTE granted to
-- service_role alone, called through serviceDb() behind the app agency check, as go_live (0063) and the
-- document functions (0077) are. save_voice_knowledge: every Voice page knowledge save (the Business
-- hours card, the Services and prices card, and the Facts and Services boxes of the profile card), all
-- of it in one transaction with its snapshot, under a lock on the account row so two writes on one
-- account queue and version numbers never collide. ensure_knowledge_snapshot: the incoming call route
-- and the concierge turn route, at call and chat start; it appends a snapshot (created_by system) only
-- when what she is about to be given differs from the latest one. The stamp columns: startCallRow and
-- createConciergeConversation, server only.
--
-- GRANTS AND POLICIES. Both new tables: everything revoked from public, anon, authenticated and
-- service_role, then SELECT to authenticated and service_role and nothing else, so even the server cannot
-- change the list without recording a snapshot. RLS on both: the tenant read (0077 shape) and a
-- restrictive Owners-only read (0066 shape, every helper coalesced). Client Owners read; Staff,
-- Technicians and anon read nothing; no client role writes anything, the agency token included.
-- business_hours inherits voice_profiles: authenticated SELECT (every member, as facts; decision C17),
-- no write verb. The client-write digest is unchanged.
--
-- TEARDOWN. Neither new table may be listed in ACCOUNT_OWNED_TABLES (packages/db/src/account-teardown.ts):
-- service_role holds no DELETE on them, so a listed delete would fail every teardown (the consent_events
-- precedent). The account row delete carries both away.
--
-- LOCKS. The ALTERs take ACCESS EXCLUSIVE on voice_profiles, calls and concierge_conversations for the
-- length of this file; the lock_timeout of 5s below is the protection. The two foreign keys are added
-- NOT VALID and then validated as the spec asks; inside one transaction that saves no lock (plan SD2),
-- and the validation reads an all-NULL column.
--
-- APPLY ORDER: CI project (ci-project-setup.yml: push-dry-run, then push), then production (MCP
-- apply_migration, once), then the parity check, then merge. LOAD-BEARING: PostgREST refuses a request
-- naming a column, table or function it does not know, and the build after this file names them on
-- every voice profile read (PROFILE_COLS: every call, every chat turn, the chat page, the Voice page,
-- every profile save), every call page (CALL_DETAIL_COLS), every later chat turn and the web chat sync
-- (CONVO_COLS), nearly every call and chat start (the stamp and ensure_knowledge_snapshot), every price
-- list read, and every Voice page knowledge save (save_voice_knowledge).
-- SAFE UNDER THE RUNNING BUILD: additive. The running build names none of these objects; the new columns
-- are nullable with no default, so its inserts leave them NULL, which every CHECK and key here admits.
--
-- ROLLBACK (roll the app back first), in this order. The stamp columns and the snapshots table only on an
-- owner decision, because they drop the record of what each call and chat knew:
--   drop function public.save_voice_knowledge(uuid, text, jsonb, jsonb, integer);
--   drop function public.ensure_knowledge_snapshot(uuid, jsonb);
--   drop function app.voice_business_hours_valid(jsonb);
--   alter table public.concierge_conversations drop column knowledge_version;  (its CHECK and key go too)
--   alter table public.calls drop column knowledge_version;                    (its CHECK and key go too)
--   drop table public.voice_knowledge_snapshots;                               (its trigger goes too)
--   drop function app.voice_knowledge_snapshots_never_edited();
--   drop table public.voice_services;
--   alter table public.voice_profiles drop column business_hours;              (its CHECK goes too)
--
-- ASCII only, no backslash anywhere, and every dollar sign in this file is part of a dollar-quote pair.

-- 0. Fail fast instead of queueing behind a long lock (0094 reason: inside a do block, so it is always in
--    the block transaction).
do $$
begin
  perform pg_catalog.set_config('lock_timeout', '5s', true);
end $$;

-- 1. Business hours on the profile.
alter table public.voice_profiles
  add column business_hours jsonb
    constraint voice_profiles_business_hours_check
      check (business_hours is null or jsonb_typeof(business_hours) = 'object');

comment on column public.voice_profiles.business_hours is
  'The regular weekly hours the receptionist answers whether the business is open from (the calendars.open_hours shape: keys sun to sat, each a list of HH:MM to HH:MM spans, 24:00 ends a day, an absent day is closed). NULL means no structured hours. Written only by save_voice_knowledge (0095), which checks the shape with app.voice_business_hours_valid and records a knowledge snapshot in the same transaction; upsertVoiceProfile refuses it. authenticated has SELECT (every member, decision C17) and no write.';

-- 2. The price list.
create table public.voice_services (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  position integer not null constraint voice_services_position_check check (position between 1 and 50),
  name_en text not null constraint voice_services_name_en_check check (length(btrim(name_en)) between 1 and 80),
  name_es text constraint voice_services_name_es_check check (name_es is null or length(btrim(name_es)) between 1 and 80),
  description_en text constraint voice_services_description_en_check
    check (description_en is null or length(btrim(description_en)) between 1 and 300),
  description_es text constraint voice_services_description_es_check
    check (description_es is null or length(btrim(description_es)) between 1 and 300),
  price_kind text not null constraint voice_services_price_kind_check
    check (price_kind in ('fixed', 'from', 'range', 'per_unit', 'free', 'after_visit')),
  amount_cents integer constraint voice_services_amount_cents_check
    check (amount_cents is null or amount_cents between 1 and 100000000),
  amount_max_cents integer,
  unit_en text constraint voice_services_unit_en_check check (unit_en is null or length(btrim(unit_en)) between 1 and 30),
  unit_es text constraint voice_services_unit_es_check check (unit_es is null or length(btrim(unit_es)) between 1 and 30),
  created_at timestamptz not null default now(),
  constraint voice_services_account_position_key unique (account_id, position),
  constraint voice_services_name_en_one_line check (strpos(name_en, chr(10)) = 0 and strpos(name_en, chr(13)) = 0),
  constraint voice_services_name_es_one_line check (strpos(name_es, chr(10)) = 0 and strpos(name_es, chr(13)) = 0),
  constraint voice_services_description_en_one_line
    check (strpos(description_en, chr(10)) = 0 and strpos(description_en, chr(13)) = 0),
  constraint voice_services_description_es_one_line
    check (strpos(description_es, chr(10)) = 0 and strpos(description_es, chr(13)) = 0),
  constraint voice_services_unit_en_one_line check (strpos(unit_en, chr(10)) = 0 and strpos(unit_en, chr(13)) = 0),
  constraint voice_services_unit_es_one_line check (strpos(unit_es, chr(10)) = 0 and strpos(unit_es, chr(13)) = 0),
  constraint voice_services_price_shape_check check (
       (price_kind in ('fixed', 'from') and amount_cents is not null
          and amount_max_cents is null and unit_en is null and unit_es is null)
    or (price_kind = 'range' and amount_cents is not null and amount_max_cents is not null
          and amount_max_cents > amount_cents and unit_en is null and unit_es is null)
    or (price_kind = 'per_unit' and amount_cents is not null and amount_max_cents is null
          and unit_en is not null and unit_es is not null)
    or (price_kind in ('free', 'after_visit') and amount_cents is null
          and amount_max_cents is null and unit_en is null and unit_es is null))
);

comment on table public.voice_services is
  'The price list the receptionist quotes from (0095, decisions C2, C3, C11, C16): up to 50 ordered rows per account. Code renders each row into one fixed sentence in English and one in Spanish, and she says only those sentences. Written only by save_voice_knowledge, which replaces the whole list and records a knowledge snapshot in the same transaction; no role holds INSERT, UPDATE or DELETE. Owners and the agency read it.';
comment on column public.voice_services.id is 'Row id. Never part of a knowledge snapshot (the list is replaced on every save).';
comment on column public.voice_services.account_id is 'The account. The account row delete carries the list away. Written by save_voice_knowledge.';
comment on column public.voice_services.position is 'Order on the Voice page and in the prompt, 1 to 50, unique per account. Written by save_voice_knowledge as 1..n in the order sent.';
comment on column public.voice_services.name_en is 'The service name, one line, 1 to 80 characters. Written by save_voice_knowledge.';
comment on column public.voice_services.name_es is 'The Spanish name, or NULL, in which case the Spanish sentence uses the English name. Written by save_voice_knowledge.';
comment on column public.voice_services.description_en is 'An optional one-line description in English, up to 300 characters. Written by save_voice_knowledge.';
comment on column public.voice_services.description_es is 'An optional one-line description in Spanish, up to 300 characters. Written by save_voice_knowledge.';
comment on column public.voice_services.price_kind is 'fixed, from, range, per_unit, free or after_visit; voice_services_price_shape_check holds each kind to exactly its amounts. Written by save_voice_knowledge.';
comment on column public.voice_services.amount_cents is 'US cents: the price (fixed, from, per_unit) or the low end (range); NULL for free and after_visit. Written by save_voice_knowledge.';
comment on column public.voice_services.amount_max_cents is 'US cents, the high end of a range, above amount_cents; NULL for every other kind. Written by save_voice_knowledge.';
comment on column public.voice_services.unit_en is 'The English unit of a per_unit price (guest, hour); required with unit_es for per_unit (decision C16), NULL otherwise. Written by save_voice_knowledge.';
comment on column public.voice_services.unit_es is 'The Spanish unit of a per_unit price (invitado, hora); required for per_unit, no English fallback (decision C16). Written by save_voice_knowledge.';
comment on column public.voice_services.created_at is 'When save_voice_knowledge wrote this row (every save rewrites the list).';

-- 3. The snapshots, append-only.
create table public.voice_knowledge_snapshots (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  version integer not null constraint voice_knowledge_snapshots_version_check check (version > 0),
  payload jsonb not null constraint voice_knowledge_snapshots_payload_check check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  created_by text not null constraint voice_knowledge_snapshots_created_by_check check (length(btrim(created_by)) > 0),
  constraint voice_knowledge_snapshots_account_version_key unique (account_id, version)
);

comment on table public.voice_knowledge_snapshots is
  'Numbered, never-edited snapshots of exactly what the receptionist is given about an account (0095, decisions C4 and C15). Appended only by save_voice_knowledge (a Voice page save) and ensure_knowledge_snapshot (call or chat start, when what she is about to be given differs from the latest). calls and concierge_conversations stamp the version they started under. No role holds INSERT, UPDATE, DELETE or TRUNCATE; a trigger refuses every UPDATE; rows leave only with their account.';
comment on column public.voice_knowledge_snapshots.id is 'Row id.';
comment on column public.voice_knowledge_snapshots.account_id is 'The account. The account row delete carries its snapshots away.';
comment on column public.voice_knowledge_snapshots.version is 'Per account, 1, 2, 3 in order, under a lock on the account row in both writing functions.';
comment on column public.voice_knowledge_snapshots.payload is 'Exactly what she is given, built by the app (apps/web/src/lib/voice/knowledge/payload.ts): facts, services text, zone, hours and their rendered lines, the list with both rendered sentences, and the renderer version. Not the moment-dependent Right now line.';
comment on column public.voice_knowledge_snapshots.created_at is 'When the snapshot was appended.';
comment on column public.voice_knowledge_snapshots.created_by is 'The Clerk user id of the agency person who saved, or system for a snapshot ensure_knowledge_snapshot recorded at call or chat start.';

create function app.voice_knowledge_snapshots_never_edited() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'voice_knowledge_snapshots: a snapshot is never edited' using errcode = '55000';
end $$;
create trigger voice_knowledge_snapshots_never_edited before update on public.voice_knowledge_snapshots
  for each row execute function app.voice_knowledge_snapshots_never_edited();
revoke all on function app.voice_knowledge_snapshots_never_edited() from public, anon;
grant execute on function app.voice_knowledge_snapshots_never_edited() to authenticated, service_role;

-- 4. Grants and policies (spec section 4). SELECT for the client role and the server, nothing else.
alter table public.voice_services enable row level security;
alter table public.voice_knowledge_snapshots enable row level security;
revoke all on public.voice_services, public.voice_knowledge_snapshots from public, anon, authenticated, service_role;
grant select on public.voice_services, public.voice_knowledge_snapshots to authenticated, service_role;

create policy voice_services_member_read on public.voice_services for select to authenticated
  using (app.is_agency() or account_id = app.current_account_id());
create policy voice_services_owners_only on public.voice_services as restrictive for select to authenticated
  using ((select coalesce(app.is_agency(), false))
         or (account_id = (select app.current_account_id())
             and (select app.is_account_owner(app.current_account_id()))));
create policy voice_knowledge_snapshots_member_read on public.voice_knowledge_snapshots for select to authenticated
  using (app.is_agency() or account_id = app.current_account_id());
create policy voice_knowledge_snapshots_owners_only on public.voice_knowledge_snapshots as restrictive for select to authenticated
  using ((select coalesce(app.is_agency(), false))
         or (account_id = (select app.current_account_id())
             and (select app.is_account_owner(app.current_account_id()))));

-- 5. The stamps. NULL passes the composite key (MATCH SIMPLE).
alter table public.calls
  add column knowledge_version integer
    constraint calls_knowledge_version_check check (knowledge_version > 0);
alter table public.calls
  add constraint calls_knowledge_version_fkey foreign key (account_id, knowledge_version)
    references public.voice_knowledge_snapshots (account_id, version) not valid;
alter table public.calls validate constraint calls_knowledge_version_fkey;

comment on column public.calls.knowledge_version is
  'The knowledge snapshot (voice_knowledge_snapshots.version of this account) this call started under, written once at call start by the incoming call route through startCallRow, from the same payload that built the prompt. NULL for calls before 0095 and for a call whose snapshot could not be recorded (fail-open). Server-written only.';

alter table public.concierge_conversations
  add column knowledge_version integer
    constraint concierge_conversations_knowledge_version_check check (knowledge_version > 0);
alter table public.concierge_conversations
  add constraint concierge_conversations_knowledge_version_fkey foreign key (account_id, knowledge_version)
    references public.voice_knowledge_snapshots (account_id, version) not valid;
alter table public.concierge_conversations validate constraint concierge_conversations_knowledge_version_fkey;

comment on column public.concierge_conversations.knowledge_version is
  'The knowledge snapshot this website chat runs under, written once when the concierge turn route creates the conversation (createConciergeConversation). Every later turn builds its prompt from that snapshot, not the live profile, so a chat keeps its starting knowledge. NULL for chats before 0095 and for one whose snapshot could not be recorded. Server-written only.';

-- 6. The hours shape. Times are compared as minutes, never as text, so no collation can reorder them.
create function app.voice_business_hours_valid(p_hours jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  v_day text; v_spans jsonb; v_span jsonb; v_from text; v_to text;
  v_from_m integer; v_to_m integer; v_prev_m integer; v_days integer := 0;
begin
  if p_hours is null or jsonb_typeof(p_hours) <> 'object' then return false; end if;
  for v_day, v_spans in select e.key, e.value from jsonb_each(p_hours) as e loop
    if v_day not in ('sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat') then return false; end if;
    if jsonb_typeof(v_spans) <> 'array' or jsonb_array_length(v_spans) = 0 then return false; end if;
    v_prev_m := null;
    for v_span in select a.value from jsonb_array_elements(v_spans) as a loop
      if jsonb_typeof(v_span) <> 'array' or jsonb_array_length(v_span) <> 2
         or jsonb_typeof(v_span -> 0) <> 'string' or jsonb_typeof(v_span -> 1) <> 'string' then
        return false;
      end if;
      v_from := v_span ->> 0;
      v_to := v_span ->> 1;
      if length(v_from) <> 5 or v_from !~ '^([01][0-9]|2[0-3]):[0-5][0-9]' then return false; end if;
      if length(v_to) <> 5 or (v_to <> '24:00' and v_to !~ '^([01][0-9]|2[0-3]):[0-5][0-9]') then return false; end if;
      v_from_m := substr(v_from, 1, 2)::integer * 60 + substr(v_from, 4, 2)::integer;
      v_to_m := substr(v_to, 1, 2)::integer * 60 + substr(v_to, 4, 2)::integer;
      if v_to_m <= v_from_m then return false; end if;
      if v_prev_m is not null and v_from_m < v_prev_m then return false; end if;
      v_prev_m := v_to_m;
    end loop;
    v_days := v_days + 1;
  end loop;
  return v_days > 0;
end $$;
revoke all on function app.voice_business_hours_valid(jsonb) from public, anon, authenticated, service_role;
comment on function app.voice_business_hours_valid(jsonb) is
  'True when a value is a valid business_hours object: keys sun to sat only, each a non-empty list of two-string spans HH:MM to HH:MM (24:00 may end a day), each end after its start, spans in order and not overlapping, at least one day. Called only by save_voice_knowledge, as the function owner.';

-- 7. Every Voice page knowledge save, all or nothing, with its snapshot (spec 4.1).
create function public.save_voice_knowledge(
  p_account_id uuid, p_actor text, p_parts jsonb, p_payload jsonb, p_base_version integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_latest integer;
  v_latest_payload jsonb;
  v_version integer;
  v_fields text[] := array[]::text[];
begin
  if p_account_id is null or p_parts is null or p_payload is null or p_base_version is null then
    raise exception 'save_voice_knowledge: a required argument is null' using errcode = '22004';
  end if;
  if p_actor is null or length(btrim(p_actor)) = 0 then
    raise exception 'save_voice_knowledge: an actor is required' using errcode = '22004';
  end if;
  perform 1 from public.accounts where id = p_account_id for no key update;
  if not found then return jsonb_build_object('status', 'no_profile'); end if;
  perform 1 from public.voice_profiles where account_id = p_account_id;
  if not found then return jsonb_build_object('status', 'no_profile'); end if;
  select s.version, s.payload into v_latest, v_latest_payload
    from public.voice_knowledge_snapshots s
   where s.account_id = p_account_id
   order by s.version desc
   limit 1;
  if coalesce(v_latest, 0) <> p_base_version then
    return jsonb_build_object('status', 'stale');
  end if;
  if jsonb_typeof(p_parts) <> 'object' or jsonb_typeof(p_payload) <> 'object' then
    return jsonb_build_object('status', 'invalid');
  end if;
  if not (p_parts ?| array['facts', 'services_text', 'business_hours', 'services'])
     or exists (select 1 from jsonb_object_keys(p_parts) as k(key)
                 where k.key not in ('facts', 'services_text', 'business_hours', 'services')) then
    return jsonb_build_object('status', 'invalid');
  end if;
  if (p_parts ? 'facts' and jsonb_typeof(p_parts -> 'facts') <> 'string')
     or (p_parts ? 'services_text' and jsonb_typeof(p_parts -> 'services_text') <> 'string')
     or (p_parts ? 'services' and jsonb_typeof(p_parts -> 'services') <> 'array') then
    return jsonb_build_object('status', 'invalid');
  end if;
  if p_parts ? 'business_hours' and jsonb_typeof(p_parts -> 'business_hours') <> 'null'
     and not app.voice_business_hours_valid(p_parts -> 'business_hours') then
    return jsonb_build_object('status', 'invalid');
  end if;

  -- Every write is inside this block: a refusal by any CHECK, key or cast rolls back what the block
  -- already wrote (a subtransaction) and answers invalid.
  begin
    if p_parts ?| array['facts', 'services_text', 'business_hours'] then
      update public.voice_profiles
         set facts = case when p_parts ? 'facts' then p_parts ->> 'facts' else facts end,
             services = case when p_parts ? 'services_text' then p_parts ->> 'services_text' else services end,
             business_hours = case
               when not (p_parts ? 'business_hours') then business_hours
               when jsonb_typeof(p_parts -> 'business_hours') = 'null' then null
               else p_parts -> 'business_hours' end,
             updated_at = pg_catalog.now()
       where account_id = p_account_id;
    end if;
    if p_parts ? 'services' then
      delete from public.voice_services where account_id = p_account_id;
      insert into public.voice_services (account_id, position, name_en, name_es, description_en, description_es,
                                         price_kind, amount_cents, amount_max_cents, unit_en, unit_es)
      select p_account_id, e.ord::integer, e.v ->> 'name_en', e.v ->> 'name_es', e.v ->> 'description_en',
             e.v ->> 'description_es', e.v ->> 'price_kind', (e.v ->> 'amount_cents')::integer,
             (e.v ->> 'amount_max_cents')::integer, e.v ->> 'unit_en', e.v ->> 'unit_es'
        from jsonb_array_elements(p_parts -> 'services') with ordinality as e(v, ord);
    end if;
    if p_parts ? 'facts' then v_fields := array_append(v_fields, 'facts'); end if;
    if p_parts ? 'services_text' then v_fields := array_append(v_fields, 'services'); end if;
    if p_parts ? 'business_hours' then v_fields := array_append(v_fields, 'business_hours'); end if;
    if p_parts ? 'services' then v_fields := array_append(v_fields, 'voice_services'); end if;
    insert into public.events (account_id, type, actor_type, actor_id, payload)
    values (p_account_id, 'voice_profile.updated', 'user', p_actor,
            pg_catalog.jsonb_build_object('fields', pg_catalog.to_jsonb(v_fields)));
    if v_latest is not null and v_latest_payload = p_payload then
      v_version := v_latest;
    else
      v_version := coalesce(v_latest, 0) + 1;
      insert into public.voice_knowledge_snapshots (account_id, version, payload, created_by)
      values (p_account_id, v_version, p_payload, p_actor);
    end if;
  exception
    when check_violation or not_null_violation or unique_violation or invalid_text_representation
      or numeric_value_out_of_range or string_data_right_truncation then
      return jsonb_build_object('status', 'invalid');
  end;
  return jsonb_build_object('status', 'ok', 'version', v_version);
end $$;
revoke all on function public.save_voice_knowledge(uuid, text, jsonb, jsonb, integer) from public, anon, authenticated, service_role;
grant execute on function public.save_voice_knowledge(uuid, text, jsonb, jsonb, integer) to service_role;
comment on function public.save_voice_knowledge(uuid, text, jsonb, jsonb, integer) is
  'Every Voice page knowledge save (0095, decision C9). Under a lock on the account row: answers no_profile (no account or no voice profile), stale (p_base_version is not the latest snapshot version, 0 for none) or invalid (a malformed part, or any row a CHECK or key refuses), writing nothing; otherwise, in one transaction, writes the named parts (facts, services_text into voice_profiles.services, business_hours, and services, which replaces the whole list at positions 1..n), records voice_profile.updated naming them, and appends a snapshot of p_payload by p_actor unless the latest payload already equals it. Raises 22004 on a null argument or a blank actor. EXECUTE: service_role only, through serviceDb behind the app agency check.';

-- 8. The call and chat start snapshot (spec 4.1, 5.6). The usual case (nothing changed since the latest
--    snapshot) takes no lock at all: it reads the latest and answers it. Only an append locks the account row,
--    then reads again, because another start may have appended the same payload meanwhile. The function-level
--    lock_timeout of 2s bounds the wait on a held row; the callers treat the resulting error as unstamped.
create function public.ensure_knowledge_snapshot(p_account_id uuid, p_payload jsonb)
returns integer language plpgsql security definer set search_path = '' set lock_timeout = '2s' as $$
declare
  v_latest integer;
  v_latest_payload jsonb;
begin
  if p_account_id is null or p_payload is null then
    raise exception 'ensure_knowledge_snapshot: a required argument is null' using errcode = '22004';
  end if;
  select s.version, s.payload into v_latest, v_latest_payload
    from public.voice_knowledge_snapshots s
   where s.account_id = p_account_id
   order by s.version desc
   limit 1;
  if v_latest is not null and v_latest_payload = p_payload then
    return v_latest;
  end if;
  perform 1 from public.accounts where id = p_account_id for no key update;
  if not found then
    raise exception 'ensure_knowledge_snapshot: no such account' using errcode = 'P0002';
  end if;
  select s.version, s.payload into v_latest, v_latest_payload
    from public.voice_knowledge_snapshots s
   where s.account_id = p_account_id
   order by s.version desc
   limit 1;
  if v_latest is not null and v_latest_payload = p_payload then
    return v_latest;
  end if;
  insert into public.voice_knowledge_snapshots (account_id, version, payload, created_by)
  values (p_account_id, coalesce(v_latest, 0) + 1, p_payload, 'system');
  return coalesce(v_latest, 0) + 1;
end $$;
revoke all on function public.ensure_knowledge_snapshot(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.ensure_knowledge_snapshot(uuid, jsonb) to service_role;
comment on function public.ensure_knowledge_snapshot(uuid, jsonb) is
  'At call and chat start (0095, spec 5.6): answers the latest snapshot version when its payload equals p_payload, taking no lock; otherwise locks the account row (lock_timeout 2s), reads again, and appends p_payload as the next version by system unless it is now equal. Raises 22004 on a null argument, P0002 when the account does not exist, 55P03 when the row stays held past 2s; a payload that is not an object is refused by the table CHECK. The callers fail open (the call or chat goes on unstamped). EXECUTE: service_role only.';
