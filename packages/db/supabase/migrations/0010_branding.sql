-- Both nullable: null means "not branded", every surface falls back, and
-- shipping this changes nothing for existing accounts.
--
-- brand_name is deliberately separate from accounts.name. accounts.name is
-- the agency's internal label ("Rio Roofing - trial"); brand_name is what
-- that company's own customers see on their lead form.
--
-- brand_logo_path stores the object path within the brand-logos bucket, not a
-- URL: URLs change with project or CDN configuration, paths do not.
--
-- No new policy is needed. accounts_agency_all (0001) already covers the
-- agency's writes, and accounts_member_read (0009) returns the whole row to a
-- client's own users -- which is exactly who should see their own brand. The
-- anonymous public form reads these through serviceDb(), which bypasses RLS.
alter table public.accounts
  add column brand_name text,
  add column brand_logo_path text;
