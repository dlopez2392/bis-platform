-- 0029: website traffic in the CRM (docs/superpowers/specs/2026-09-07-
-- website-traffic-design.md). Three tables:
--
-- 1. sites — one row per client website, linking the account to its Vercel
--    project. One per account for now (unique account_id); a table rather
--    than columns on accounts so a second site is a row, not a migration.
-- 2. site_traffic_daily — visitors/pageviews per site per LOCAL day (the
--    account's timezone). The chart and the tiles.
-- 3. site_traffic_breakdown — top-20 per dimension per day (page, source,
--    place, device), visitors + pageviews each.
--
-- account_id is carried on the two traffic tables as well as on sites so the
-- member policy is one indexed predicate per table, not a join through
-- sites on every read; the pass writes it from the site row it holds.
--
-- Grants copy 0025 (automations): `authenticated` SELECT under RLS and
-- nothing else; every write is the cron's through serviceDb(). Supabase
-- default privileges auto-grant ALL on a new table (the 0020 lesson), so the
-- revokes are here. Aggregates only — no IP, no visitor id, ever.
--
-- FKs are `on delete restrict` like every account_id FK since 0017: a
-- linked site with history is never dropped by accident; unlinking is an
-- explicit delete of the traffic rows first (the fixture cleanup order).

create table public.sites (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete restrict unique,
  vercel_project_id text not null unique,
  domain text not null,
  analytics_enabled_at timestamptz,
  last_synced_day date,
  created_at timestamptz not null default now()
);
alter table public.sites enable row level security;
create policy sites_tenant on public.sites for select to authenticated
  using (app.is_agency() or account_id = app.current_account_id());
grant select on public.sites to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.sites from authenticated;
revoke all on public.sites from anon;

create table public.site_traffic_daily (
  site_id uuid not null references public.sites(id) on delete restrict,
  account_id uuid not null references public.accounts(id) on delete restrict,
  day date not null,
  visitors integer not null check (visitors >= 0),
  pageviews integer not null check (pageviews >= 0),
  primary key (site_id, day)
);
create index site_traffic_daily_account_day on public.site_traffic_daily (account_id, day desc);
alter table public.site_traffic_daily enable row level security;
create policy site_traffic_daily_tenant on public.site_traffic_daily for select to authenticated
  using (app.is_agency() or account_id = app.current_account_id());
grant select on public.site_traffic_daily to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.site_traffic_daily from authenticated;
revoke all on public.site_traffic_daily from anon;

create table public.site_traffic_breakdown (
  site_id uuid not null references public.sites(id) on delete restrict,
  account_id uuid not null references public.accounts(id) on delete restrict,
  day date not null,
  dimension text not null check (dimension in ('page', 'source', 'place', 'device')),
  value text not null,
  visitors integer not null check (visitors >= 0),
  pageviews integer not null check (pageviews >= 0),
  primary key (site_id, day, dimension, value)
);
create index site_traffic_breakdown_account_day on public.site_traffic_breakdown (account_id, day desc, dimension);
alter table public.site_traffic_breakdown enable row level security;
create policy site_traffic_breakdown_tenant on public.site_traffic_breakdown for select to authenticated
  using (app.is_agency() or account_id = app.current_account_id());
grant select on public.site_traffic_breakdown to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.site_traffic_breakdown from authenticated;
revoke all on public.site_traffic_breakdown from anon;
