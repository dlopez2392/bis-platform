-- A2P 10DLC registration state, per client company.
--
-- Deliberately NOT granted to `authenticated`. 0013 revoked UPDATE on accounts
-- and re-granted only branding columns, and client-branding-grants.test.ts
-- asserts that set exactly. A2P entry is agency operator work performed with
-- serviceDb(); a client never writes it, and a client reading it is harmless
-- (the existing row-level select policy already covers their own row).
--
-- One campaign per account: a brand belongs to a business and a campaign to a
-- use case, and this product has one use case per client. Numbers inherit
-- eligibility from their account, so there is no per-number A2P state.
--
-- The default is honest rather than a backfill guess: for every account that
-- exists today the platform genuinely does not know, so 'not_started' is true.
alter table public.accounts
  add column a2p_brand_id text,
  add column a2p_campaign_id text,
  add column a2p_status text not null default 'not_started'
    check (a2p_status in ('not_started','pending','approved','rejected')),
  add column a2p_updated_at timestamptz;
