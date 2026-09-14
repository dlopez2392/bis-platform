-- 0033_contact_dedupe_keys
--
-- findDuplicate's phone fallback pulled EVERY non-null phone on the account
-- into memory and compared in JS — once per inserted contact, whenever the two
-- sides disagreed on formatting, which is the common case. At ten contacts that
-- is free; at five thousand it is five thousand full scans against the one
-- Supabase project production runs on, and the CSV import walks into it in
-- 200-row batches. These columns turn that into an indexed lookup.
--
-- Generated and STORED rather than maintained by the application, for the same
-- reason 0030 gave for sort_name: the database computes it, so the comparison
-- key cannot drift away from the value it is derived from. The source columns
-- are NOT reshaped — phone and email keep whatever shape they were entered in.
--
-- phone_key mirrors phoneDigits() in packages/db/src/contacts.ts exactly:
-- digits only, and a leading NANP 1 folded off when the result is 11 digits.
-- Two implementations of one rule drift silently, and a drifted key does not
-- throw — it just stops matching. contact-dedupe-keys.test.ts compares this
-- column against that function input by input, which is what pays for the
-- duplication.
alter table public.contacts
  add column phone_key text
  generated always as (
    case
      when length(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')) = 11
       and left(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 1) = '1'
      then substr(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 2)
      else nullif(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), '')
    end
  ) stored;

-- email_key mirrors emailKey(): lowercased, trimmed, and `+suffix` stripped
-- from the local part. Plus-addressing is near-universal, so folding it is safe.
-- Gmail's dot-folding is deliberately NOT applied: john.smith@ and johnsmith@
-- are one mailbox AT GMAIL ONLY, and folding dots globally would match distinct
-- people at every other provider.
alter table public.contacts
  add column email_key text
  generated always as (
    nullif(regexp_replace(lower(trim(both ' ' from coalesce(email, ''))), '\+[^@]*@', '@'), '')
  ) stored;

-- Account scope first in both, matching how findDuplicate queries: every lookup
-- is `account_id = ? and <key> = ?`, never a bare key scan across tenants.
create index contacts_account_phone_key on public.contacts (account_id, phone_key);
create index contacts_account_email_key on public.contacts (account_id, email_key);

-- The work queue a merge tool will consume on the day it is built, already
-- populated — rather than having to go find duplicates itself. Written when an
-- incoming contact's email matches one record and its phone matches ANOTHER,
-- which is precisely how a duplicate gets created quietly today.
create table public.contact_duplicate_flags (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  contact_a uuid not null references public.contacts(id) on delete cascade,
  contact_b uuid not null references public.contacts(id) on delete cascade,
  reason text not null,
  created_at timestamptz not null default now(),
  -- Ordering is enforced, not merely conventional: without it a caller could
  -- write the mirror image of an existing pair and defeat the unique index
  -- below, and the queue would show the same duplicate twice.
  constraint contact_duplicate_flags_ordered check (contact_a < contact_b)
);

create unique index contact_duplicate_flags_pair
  on public.contact_duplicate_flags (account_id, contact_a, contact_b);

-- Access control on these tables is RLS, not column grants. 0030's own trailing
-- note is worth re-reading here: public.contacts carries TABLE-level grants, so
-- the two new columns above need no grant of their own, and
-- information_schema.column_privileges EXPANDS a table-level grant into one
-- row per column — which is exactly how that was misread once before.
alter table public.contact_duplicate_flags enable row level security;

-- Mirrors notes_member_all exactly (0003_crm_core.sql's uniform RLS loop,
-- confirmed live via pg_policy before writing this): same account-scoping
-- predicate, same `for all to authenticated`, renamed for this table.
create policy contact_duplicate_flags_member_all on public.contact_duplicate_flags
  for all to authenticated
  using (app.is_agency() or account_id = app.current_account_id())
  with check (app.is_agency() or account_id = app.current_account_id());
