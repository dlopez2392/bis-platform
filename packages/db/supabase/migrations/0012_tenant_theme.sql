-- The four inputs that turn brand_color from an accent into a theme. All
-- nullable, like every branding column before them: null means unset, every
-- surface falls back, and applying this changes nothing for existing accounts.
--
-- Check constraints here, unlike 0011_brand_color.sql which deliberately kept
-- validation app-side. The difference is not a change of heart: brand_color is
-- a FORMAT (#rrggbb) that a future milestone might widen, while these four are
-- CLOSED SETS. A closed set in the column is the strongest available answer to
-- the finding in 2026-08-08-brand-color-design.md -- a tenant-controlled string
-- reaching a serialized style attribute can append arbitrary CSS declarations,
-- and migration 0006 grants a client `for all` on their own forms. For these
-- four inputs the database itself refuses to store the hostile value, so the
-- injection class is dead at the source rather than mitigated downstream.
alter table public.accounts
  add column brand_neutral text check (brand_neutral in ('warm','cool','slate')),
  add column brand_corners text check (brand_corners in ('sharp','soft','round')),
  add column brand_type    text check (brand_type    in ('geist','inter','serif')),
  add column brand_mode    text check (brand_mode    in ('light','dark','follow'));
