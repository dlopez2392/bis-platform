-- 0070_contact_relationships.sql - relationships between customers
-- (docs/superpowers/specs/2026-10-11-contact-relationships-design.md section 5)
--
-- One row per pair, read "contact_id is related_contact_id's label_key". Each record shows a chip
-- naming the OTHER person, in the reader's language, from a typed registry in apps/web; the
-- database holds the key only (label_key CHECK = @bis/db/relationship-keys RELATIONSHIP_KEYS,
-- pinned by contact-relationships-schema.test.ts). Each side has its own grammatical form
-- (contact_form, related_form; null = neutral word) and its own two flags.
--
-- Both people belong to the row's own account: composite keys to contacts (account_id, id),
-- 0050's shape. Uniqueness (owner, 2026-10-11) depends on the label: family and symmetric labels
-- are one row per UNORDERED pair (least/greatest), support labels one row per DIRECTION (Ana may
-- be Sofia's emergency contact and Sofia Ana's); the two key sets are UNDIRECTED_KEYS and
-- DIRECTIONAL_KEYS in @bis/db/relationship-keys, pinned by the same test. Client-written under RLS
-- (operator-entered state, like notes and contact_tags), with 0068-style restrictive fences:
-- a Technician reads a row when EITHER person is theirs and writes only when BOTH are.
--
-- Two foreign keys to contacts: an unhinted PostgREST embed contacts(...) on this table is
-- ambiguous (0050's note). @bis/db/relationships.ts never embeds.
--
-- APPLY ORDER: CI project (ci-project-setup.yml: push-dry-run, then push), then production (MCP
-- apply_migration), then the parity check, then merge. The number is settled with Lane A's 0069
-- BEFORE the CI-project apply.
--
-- ROLLBACK (revert the app first; this drops what operators typed, so only on an owner decision):
--   drop table public.contact_relationships;
--
-- ASCII only, no backslash anywhere.

set local lock_timeout = '5s';

create table public.contact_relationships (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  contact_id uuid not null,
  related_contact_id uuid not null,
  label_key text not null,
  custom_label text,
  contact_form text,
  related_form text,
  contact_can_pick_up boolean not null default false,
  contact_is_emergency boolean not null default false,
  related_can_pick_up boolean not null default false,
  related_is_emergency boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contact_relationships_contact_fkey foreign key (account_id, contact_id)
    references public.contacts (account_id, id) on delete cascade,
  constraint contact_relationships_related_fkey foreign key (account_id, related_contact_id)
    references public.contacts (account_id, id) on delete cascade,
  constraint contact_relationships_label_key check (label_key in (
    'parent', 'spouse', 'sibling', 'godparent', 'compadre', 'emergency_contact',
    'authorized_pickup', 'responsible_party', 'caregiver', 'landlord', 'referred', 'other')),
  constraint contact_relationships_forms check (
    (contact_form is null or contact_form in ('f', 'm')) and (related_form is null or related_form in ('f', 'm'))),
  constraint contact_relationships_not_self check (contact_id <> related_contact_id),
  constraint contact_relationships_custom check (
    (label_key = 'other') = (custom_label is not null)
    and (custom_label is null or char_length(custom_label) between 1 and 60)),
  -- Stored trimmed, never blank. A POSIX class (no backslash, see the header): under production's
  -- ICU en_US.UTF-8 it is 09-0D, 1C-1F, 20, 85, A0, 1680, 2000-200A, 2028, 2029, 202F, 205F, 3000,
  -- measured 2026-10-11; the app trims a superset before it writes (relationship-input.ts).
  constraint contact_relationships_custom_trimmed check (custom_label ~ '^[^[:space:]](.*[^[:space:]])?$'),
  -- These two labels ARE the flag on side A, so "who can pick X up" is always a flag read.
  constraint contact_relationships_emergency check (label_key <> 'emergency_contact' or contact_is_emergency),
  constraint contact_relationships_pickup check (label_key <> 'authorized_pickup' or contact_can_pick_up)
);

-- Family and symmetric labels (UNDIRECTED_KEYS), order-free: the same label twice for a pair is
-- refused whichever way round it was written, and "Other" compares its text case-insensitively.
create unique index contact_relationships_pair on public.contact_relationships (
  account_id, least(contact_id, related_contact_id), greatest(contact_id, related_contact_id),
  label_key, lower(coalesce(custom_label, '')))
  where label_key in ('parent', 'spouse', 'sibling', 'godparent', 'compadre', 'referred', 'other');
-- Support labels (DIRECTIONAL_KEYS), one row per direction: refused twice the same way round only.
-- Between them the two predicates cover every key in contact_relationships_label_key.
create unique index contact_relationships_directed on public.contact_relationships (
  account_id, contact_id, related_contact_id, label_key)
  where label_key in ('emergency_contact', 'authorized_pickup', 'responsible_party', 'caregiver', 'landlord');
-- "Relationships of X" reads both columns (a BitmapOr); both also serve the cascades.
create index contact_relationships_by_contact on public.contact_relationships (account_id, contact_id);
create index contact_relationships_by_related on public.contact_relationships (account_id, related_contact_id);

alter table public.contact_relationships enable row level security;

revoke all on public.contact_relationships from anon, authenticated;
grant select, insert, delete on public.contact_relationships to authenticated;
grant update (contact_form, related_form, contact_can_pick_up, contact_is_emergency,
              related_can_pick_up, related_is_emergency, updated_at)
  on public.contact_relationships to authenticated;
grant select, insert, update, delete on public.contact_relationships to service_role;

-- The tenant policy, 0003's uniform shape (0003_crm_core.sql:126-128, 0033:78-81).
create policy contact_relationships_member_all on public.contact_relationships
  for all to authenticated
  using (app.is_agency() or account_id = app.current_account_id())
  with check (app.is_agency() or account_id = app.current_account_id());

-- 0068's fences. sees_all_customers is coalesced (never NULL) and my_contact_ids() is empty for
-- anyone not a current Technician here, so an unknown role reads and writes nothing.
create policy contact_relationships_technician_read on public.contact_relationships
  as restrictive for select to authenticated
  using ((select app.sees_all_customers(app.current_account_id()))
         or contact_id in (select app.my_contact_ids())
         or related_contact_id in (select app.my_contact_ids()));
create policy contact_relationships_technician_insert on public.contact_relationships
  as restrictive for insert to authenticated
  with check ((select app.sees_all_customers(app.current_account_id()))
              or (contact_id in (select app.my_contact_ids())
                  and related_contact_id in (select app.my_contact_ids())));
create policy contact_relationships_technician_update on public.contact_relationships
  as restrictive for update to authenticated
  using ((select app.sees_all_customers(app.current_account_id()))
         or (contact_id in (select app.my_contact_ids())
             and related_contact_id in (select app.my_contact_ids())))
  with check ((select app.sees_all_customers(app.current_account_id()))
              or (contact_id in (select app.my_contact_ids())
                  and related_contact_id in (select app.my_contact_ids())));
create policy contact_relationships_technician_delete on public.contact_relationships
  as restrictive for delete to authenticated
  using ((select app.sees_all_customers(app.current_account_id()))
         or (contact_id in (select app.my_contact_ids())
             and related_contact_id in (select app.my_contact_ids())));
