-- Accounts that must never send outbound mail or SMS.
--
-- The cron tick (apps/web/api/cron/reminders) runs every registered pass
-- against serviceDb() with NO account filter, by design: every real account
-- wants its reminders. That is exactly wrong for an account whose rows are
-- illustrative rather than real — a seeded demo company, or a client being
-- set up before go-live — where a reminder is a message to someone who never
-- asked for one, on the client's number, costing their money.
--
-- DEFAULT FALSE, so every account that exists today behaves byte-identically.
-- The flag only ever removes sends; it never adds one.
--
-- serviceDb-only by inheritance: `authenticated` has no update grant on
-- public.accounts (0020 established that posture for voice_profiles and the
-- accounts table has never granted it), so a client cannot unsuppress
-- themselves or suppress a rival.
alter table public.accounts
  add column outbound_suppressed boolean not null default false;

comment on column public.accounts.outbound_suppressed is
  'When true, every automation pass skips this account''s due work. Set on demo and pre-go-live accounts.';
