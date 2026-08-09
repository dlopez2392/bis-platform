-- Nullable like brand_name and brand_logo_path before it: null means "no
-- brand color", every surface falls back, and shipping this changes nothing
-- for existing accounts.
--
-- Stored as a #rrggbb string rather than three smallints because that is the
-- form both consumers want -- a CSS custom property and a color input -- and
-- the form the value is validated in. Validation is app-side; no check
-- constraint here, so a future format change does not need a migration.
alter table public.accounts add column brand_color text;
