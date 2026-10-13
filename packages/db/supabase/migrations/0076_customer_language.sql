-- 0076_customer_language.sql
--
-- A LANGUAGE ON EVERY CUSTOMER (S-09, spec docs/superpowers/specs/2026-10-13-customer-language-design.md).
--
-- WHAT
--   contacts.language / language_source / language_set_at: the customer's language ('en' or 'es'),
--     how it was set ('booking', 'form', 'call' from the customer's own first clear sign, or 'staff'),
--     and when. All three NULL (not set) or all three set.
--   contacts.last_language_signal / _source / _at: the NEWEST sign the customer gave, kept even when it
--     disagrees with the language; never 'staff'. The record's hint is computed from these on read.
--   contacts.language_hint_kept_at: when someone pressed Keep on that hint.
--   public.record_language_signal(): the ONE automatic writer, service_role only. It records a sign and
--     sets the language only when the language is NULL, so it never overwrites a staff choice.
--   app.contacts_language_server_only(): a client-role INSERT stores none of the seven columns.
--   PR 2's Spanish boxes (inert until PR 2 ships): automations.body_es/_basis,
--     calendars.followup_body_es/_basis (client-editable like followup_body),
--     voice_profiles.textback_body_es/_basis. NULL means "our written Spanish default"; '' means
--     "emptied: Spanish customers get the English".
--
-- WHO WRITES WHAT (the 0053 convention). The client role gets no UPDATE on any contacts language column
-- (a column added after 0053 is not client-updatable until granted by name), and contacts keep their
-- table-level INSERT, hence the trigger. Staff edits run in server actions on the service client after
-- getContact on the request client found the contact.
--
-- DATA (owner decision Q1, 2026-10-13). An account that already rewrote an English body keeps sending
-- that English to Spanish customers: its Spanish is set to '' (emptied). Rows still on our default keep
-- NULL. The instant reply's row is skipped: it keeps its own Spanish in config (spec C15).
--
-- APPLY ORDER. Additive; the build before this PR reads none of it, so it applies before the merge.
-- bis-ci first (ci-project-setup.yml), then production, then the parity check.
--
-- ROLLBACK (roll the app back first):
--   drop function public.record_language_signal(uuid, uuid, text, text, timestamptz);
--   drop trigger contacts_language_server_only on public.contacts;
--   drop function app.contacts_language_server_only();
--   alter table public.contacts drop column language, drop column language_source,
--     drop column language_set_at, drop column last_language_signal,
--     drop column last_language_signal_source, drop column last_language_signal_at,
--     drop column language_hint_kept_at;
--   alter table public.automations drop column body_es, drop column body_es_basis;
--   alter table public.calendars drop column followup_body_es, drop column followup_body_es_basis;
--   alter table public.voice_profiles drop column textback_body_es, drop column textback_body_es_basis;
--   then restore 0065's comment on accounts.language:
--     comment on column public.accounts.language is
--       'UI language for this account''s CLIENT-role sessions. NULL = no preference recorded; '
--       'resolveLocale() falls through to the default (en). Agency-operator sessions do not read '
--       'this column (decision 1, 2026-10-10 Spanish-runtime owner decisions) until the parallel '
--       'staff-and-roles lane''s users.language exists.';
--   The Q1 data is lost with the columns; nothing reads it before PR 2.
--
-- ASCII only, no backslash anywhere (the MCP apply rule).

set local lock_timeout = '5s';

-- 1. The contact's language and its newest sign.
alter table public.contacts
  add column language text null,
  add column language_source text null,
  add column language_set_at timestamptz null,
  add column last_language_signal text null,
  add column last_language_signal_source text null,
  add column last_language_signal_at timestamptz null,
  add column language_hint_kept_at timestamptz null,
  add constraint contacts_language_check check (language in ('en', 'es')),
  add constraint contacts_language_source_check check (language_source in ('booking', 'form', 'call', 'staff')),
  add constraint contacts_last_language_signal_check check (last_language_signal in ('en', 'es')),
  add constraint contacts_last_language_signal_source_check check (last_language_signal_source in ('booking', 'form', 'call')),
  add constraint contacts_language_coherent check (
    (language is null and language_source is null and language_set_at is null)
    or (language is not null and language_source is not null and language_set_at is not null)),
  add constraint contacts_language_signal_coherent check (
    (last_language_signal is null and last_language_signal_source is null and last_language_signal_at is null)
    or (last_language_signal is not null and last_language_signal_source is not null and last_language_signal_at is not null));

-- 2. The one automatic writer. Locks the row, then writes: the caller learns whether THIS call set the
--    language, and a racing second caller waits on the lock and then sees it set (first wins).
create function public.record_language_signal(
  p_account uuid, p_contact uuid, p_language text, p_source text, p_at timestamptz
) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare
  v_found boolean;
  v_prior text;
  v_last_at timestamptz;
begin
  if p_account is null or p_contact is null or p_language is null or p_source is null or p_at is null then
    raise exception 'record_language_signal: every argument is required' using errcode = '22004';
  end if;
  if p_language not in ('en', 'es') then
    raise exception 'record_language_signal: language must be en or es' using errcode = '22023';
  end if;
  if p_source not in ('booking', 'form', 'call') then
    raise exception 'record_language_signal: source must be booking, form or call' using errcode = '22023';
  end if;
  if not isfinite(p_at) or p_at > now() + interval '1 day' then
    raise exception 'record_language_signal: p_at must be a real, roughly-current moment' using errcode = '22023';
  end if;

  select true, c.language, c.last_language_signal_at into v_found, v_prior, v_last_at
    from public.contacts c
   where c.account_id = p_account and c.id = p_contact
   for update;
  if not coalesce(v_found, false) then
    return false;
  end if;

  update public.contacts c set
    last_language_signal = case when v_last_at is null or p_at >= v_last_at then p_language else c.last_language_signal end,
    last_language_signal_source = case when v_last_at is null or p_at >= v_last_at then p_source else c.last_language_signal_source end,
    last_language_signal_at = case when v_last_at is null or p_at >= v_last_at then p_at else c.last_language_signal_at end,
    language = case when c.language is null then p_language else c.language end,
    language_source = case when c.language is null then p_source else c.language_source end,
    language_set_at = case when c.language is null then p_at else c.language_set_at end
   where c.account_id = p_account and c.id = p_contact;

  return v_prior is null;
end $$;

revoke all on function public.record_language_signal(uuid, uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.record_language_signal(uuid, uuid, text, text, timestamptz) to service_role;

-- 3. A client-role INSERT stores no language. Plain, not definer, so current_user is the caller
--    (0071's app.stamp_created_by). No UPDATE trigger: no UPDATE grant exists.
create function app.contacts_language_server_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' then
    new.language := null;
    new.language_source := null;
    new.language_set_at := null;
    new.last_language_signal := null;
    new.last_language_signal_source := null;
    new.last_language_signal_at := null;
    new.language_hint_kept_at := null;
  end if;
  return new;
end $$;
create trigger contacts_language_server_only before insert on public.contacts
  for each row execute function app.contacts_language_server_only();

-- 4. PR 2's Spanish boxes (spec 6.4). Inert until PR 2.
alter table public.automations
  add column body_es text null,
  add column body_es_basis text null,
  add constraint automations_body_es_length check (body_es is null or char_length(body_es) <= 1000);
alter table public.calendars
  add column followup_body_es text null,
  add column followup_body_es_basis text null;
grant update (followup_body_es, followup_body_es_basis) on public.calendars to authenticated;
alter table public.voice_profiles
  add column textback_body_es text null,
  add column textback_body_es_basis text null;

-- 5. Q1: an account's already-customised English keeps going to its Spanish customers. A whitespace-only
--    body is the senders' own "use the default" (bookingFollowupEmail's `.trim()`, prepareTextback's
--    `.trim() ||`, automation's own trim before send): the regex requires one real, non-whitespace
--    character, not merely a non-empty string.
update public.automations set body_es = '' where body ~ '[^[:space:]]' and recipe_key <> 'instant_reply';
update public.calendars set followup_body_es = '' where followup_body ~ '[^[:space:]]';
update public.voice_profiles set textback_body_es = '' where textback_body ~ '[^[:space:]]';

-- 6. Comments: each column names its one writer.
comment on column public.contacts.language is
  'The customer''s language, en or es (0076, S-09). NULL = not set. Written by public.record_language_signal (only while NULL) and by staff through setContactLanguage on the service client.';
comment on column public.contacts.language_source is
  'How contacts.language was set (0076): booking, form or call (record_language_signal) or staff (setContactLanguage / restoreContactLanguage).';
comment on column public.contacts.language_set_at is
  'When contacts.language was set (0076): the evidence''s own time for a sign (public.record_language_signal) or the moment of the choice for staff (setContactLanguage).';
comment on column public.contacts.last_language_signal is
  'The newest language sign the customer gave, en or es (0076). Written only by public.record_language_signal; read for the record''s hint.';
comment on column public.contacts.last_language_signal_source is
  'Where the newest sign came from: booking, form or call, never staff (0076). Written only by public.record_language_signal.';
comment on column public.contacts.last_language_signal_at is
  'When the newest sign was given (0076). An older sign never replaces a newer one. Written only by public.record_language_signal.';
comment on column public.contacts.language_hint_kept_at is
  'When someone pressed Keep on the language hint (0076); the hint stays away until a newer sign. Written only by keepContactLanguageHint on the service client.';
comment on column public.automations.body_es is
  'PR 2 Spanish box (0076, S-09): NULL = our written Spanish default, empty = Spanish customers get the English, else theirs. Service-role writes only.';
comment on column public.automations.body_es_basis is
  'The English body the Spanish was written beside (0076, S-09 C14); the staleness warning compares it with body.';
comment on column public.calendars.followup_body_es is
  'PR 2 Spanish box for the calendar follow-up (0076, S-09): NULL = our Spanish default, empty = the English. Client-editable like followup_body.';
comment on column public.calendars.followup_body_es_basis is
  'The followup_body the Spanish was written beside (0076, S-09 C14).';
comment on column public.voice_profiles.textback_body_es is
  'PR 2 Spanish box for the missed-call text-back (0076, S-09): NULL = our Spanish default, empty = the English. Service-role writes only.';
comment on column public.voice_profiles.textback_body_es_basis is
  'The textback_body the Spanish was written beside (0076, S-09 C14).';
comment on column public.accounts.language is
  'Two readers: the client-role dashboard default (0065) and, since 0076, the language of scheduled customer messages to a contact with no language (S-09 L3). NULL = no preference; resolveLocale() falls through to en.';
