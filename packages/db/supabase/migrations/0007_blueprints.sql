-- M1d blueprints + activation checklist.
--
-- `blueprints` is AGENCY-scoped, not account-scoped: a blueprint belongs to the
-- agency and is applied *to* accounts. That is why its RLS policy is
-- app.is_agency() alone rather than the account_id comparison every other table
-- uses — there is no account_id column here to compare.

create table public.blueprints (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id),
  name text not null,
  -- Counts recaptures of this blueprint's contents. Distinct from the bundle's
  -- own `schemaVersion`, which describes the shape of the jsonb.
  version int not null default 1,
  source_account_id uuid references public.accounts(id) on delete set null,
  assets jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id, name)
);

alter table public.blueprints enable row level security;
create policy blueprints_agency_all on public.blueprints for all to authenticated
  using (app.is_agency()) with check (app.is_agency());

-- State only. The catalogue of items lives in application code, so a catalogue
-- item has no row here until someone ticks it or writes a note, and adding a
-- new catalogue item later needs no backfill.
create table public.checklist_items (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id),
  -- A catalogue key ('phone_number') or 'custom:<uuid>' for a free-text item.
  item_key text not null,
  -- Null for catalogue items, whose title comes from code. Set for custom
  -- items so their title survives independently of any catalogue.
  title text,
  done_at timestamptz,
  done_by text,
  note text,
  position int not null default 0,
  created_at timestamptz not null default now(),
  unique (account_id, item_key)
);

alter table public.checklist_items enable row level security;
create policy checklist_items_member_all on public.checklist_items for all to authenticated
  using (app.is_agency() or account_id = app.current_account_id())
  with check (app.is_agency() or account_id = app.current_account_id());

-- Provenance on every cloneable table. The partial unique index IS the
-- idempotency mechanism: apply upserts against it, so applying a blueprint
-- twice creates nothing twice. `origin` is written but read by nothing in v0 —
-- it exists so the deferred three-way merge needs no migration.
do $$
declare t text;
begin
  foreach t in array array['pipelines','pipeline_stages','custom_fields','tags','forms'] loop
    execute format('alter table public.%I add column blueprint_key text', t);
    execute format($f$alter table public.%I add column origin text not null default 'user'
                      check (origin in ('user','blueprint'))$f$, t);
    execute format('create unique index %I_blueprint_key_unique on public.%I (account_id, blueprint_key)
                      where blueprint_key is not null', t, t);
  end loop;
end $$;
