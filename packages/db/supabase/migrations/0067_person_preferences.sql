-- 0067_person_preferences.sql -- a person's own theme (docs/superpowers/specs/2026-10-10-mis-preferencias-design.md section 4)
--
-- users.language (en|es|NULL) already exists (0066). This adds users.theme. NULL = no choice:
-- the bis-theme cookie, then the tenant's brand_mode, then the role default (agency dark, client light).
-- Written only by server code (serviceDb(): the Preferences page's actions and the topbar toggle),
-- only to the caller's own row; 0066 already revoked INSERT/UPDATE/DELETE on public.users from authenticated.
-- Readable exactly as users.language is (users_agency_read, users_member_read). Agency rows have no
-- membership, so no client token can read them.
--
-- APPLY ORDER: CI project (ci-project-setup.yml), then production, then the parity check, then merge.
-- The app's stored-role read selects users.theme: code that ships before this column fails that read
-- CLOSED for every client (no role) until the column exists.
--
-- ROLLBACK: revert the code first (it selects theme), then: alter table public.users drop column theme;

set local lock_timeout = '5s';

alter table public.users
  add column theme text constraint users_theme_check check (theme in ('light', 'dark', 'system'));

comment on column public.users.theme is
  'The person''s own theme: light, dark or system (follow the device). NULL = no choice. Written only by the person''s own Preferences page and topbar toggle, server-side.';
