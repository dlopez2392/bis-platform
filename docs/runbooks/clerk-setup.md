# Clerk — moving to a production instance

Production runs on a Clerk **development** instance. That is why the sign-in
page says "(dev)", carries an orange Development-mode banner that cannot be
turned off, and shows "Secured by Clerk". No amount of styling reaches any of
those three: they are properties of the instance, not of this repo.

This runbook is the migration. Read the whole thing before starting — the
order matters, and two of the steps fail **silently** rather than loudly.

## Findings (2026-09-14, read off the live instance and the live database)

- The publishable key in `apps/web/.env.local` is `pk_test_dG9waWNhbC1y…`,
  which decodes to `topical-redfish-40` — the development instance
  `topical-redfish-40.clerk.accounts.dev`.
- **`public.users` and `public.memberships` are EMPTY** (0 rows each).
  Authorization does not read them. It runs entirely off Clerk session claims
  matched against `public.accounts.clerk_org_id`. This makes the migration far
  smaller than it looks: there are no user rows to re-point.
- `public.accounts` holds **5 rows, 2 of which are real**:

  | Account | `clerk_org_id` | `client_access_enabled` |
  |---|---|---|
  | Test Client One | `org_3H2aweJ6b2GRZghk3DCrNDmrMXU` | **true** |
  | Bespoke Intelligent Solutions | `org_3IejCERXojXO4BGgiKSHL34lT5O` | false |
  | Fixture Co ×3 | `org_test_qw1pzpmp`, `org_test_2znb5z38`, `org_test_19olu5ei` | false |

  The three `Fixture Co` rows are stranded `packages/db` test fixtures. Their
  `org_test_*` ids are synthetic — they were never Clerk orgs — so they are
  irrelevant here. Sweep them separately; they are also why the Monday
  roll-up email reports extra zero rows.

## The two failures that are silent

Both have already happened once on this project, and both are recorded.

**1. The session token.** `app.is_agency()` reads `app.jwt()->>'app_role'` and
`app.current_account_id()` reads `app.jwt()->>'org_id'` (`0001_tenancy.sql:9`
and `0008_client_access.sql:13`). Those are **customized** claims, not Clerk
defaults. A fresh instance issues a default token, and then:

- `app_role` is absent → `is_agency()` is false → you are redirected to `/`
  and locked out of the agency side.
- `org_id` is absent → `current_account_id()` returns NULL → RLS matches
  nothing → **every query succeeds and returns zero rows.**

The last one is the trap, and the ledger says so in as many words: it "reads
as *the client has no data* instead of *the integration is broken*." The third
claim, `role`, is the one easiest to miss entirely — PostgREST needs it to
assign the Postgres role at all.

**2. Supabase's trust.** `dbForRequest()` passes the Clerk session token
straight to Supabase as the Bearer (`apps/web/src/lib/db.ts:12-15`). Supabase
trusts it because the project has Clerk registered as a third-party auth
provider — currently pinned to
`https://topical-redfish-40.clerk.accounts.dev`. A production instance has a
different domain. Until Supabase is told, every authenticated read fails.

`packages/db/supabase/config.toml` shows `[auth.third_party.clerk] enabled =
false`, which is only the LOCAL template. The remote project is configured in
the dashboard, and that is the copy that matters.

## Part A — pre-flight reads (do these first, keep the output)

```sql
-- what the accounts currently point at
select name, clerk_org_id, client_access_enabled from public.accounts order by created_at;
```

In the Clerk dashboard, on the **development** instance, record:

- Configure → Sessions → **Customize session token**. Copy the JSON verbatim.
  It should be exactly:
  `{"org_id":"{{org.id}}", "role":"authenticated", "app_role":"{{user.public_metadata.app_role}}"}`
- Your own user's `public_metadata` (it carries `app_role: "agency_admin"`).
- Which sign-in methods are enabled: `oauth_google`, `email_code`, `password`.

## Part B — create the production instance

In the Clerk dashboard, create the production instance for this application.
Do **not** switch any keys yet. Set the application name to **BIS Platform** —
without "(dev)"; that suffix is the app name, and the instance being a
production one is what removes the banner.

## Part C — the session token (the step that cannot be skipped)

On the **production** instance: Configure → Sessions → Customize session
token, and paste the JSON from Part A verbatim:

```json
{"org_id":"{{org.id}}", "role":"authenticated", "app_role":"{{user.public_metadata.app_role}}"}
```

Enable Organizations on the production instance as well, or `{{org.id}}`
resolves to nothing and every client lands on `/no-access`.

## Part D — DNS

Clerk gives the production instance a set of CNAME records for
`clerk.app.bis-rgv.com` and friends (it is several records, not one). Add them
all at the registrar and wait for Clerk to report them verified. Nothing below
works until it does.

## Part E — tell Supabase about the new domain

Supabase dashboard → Authentication → Third-Party Auth. Add a Clerk provider
whose domain is the new production domain.

> **Decide here:** whether Supabase will hold **both** domains at once
> determines whether e2e can stay where it is (Part H). Check this before you
> remove the development entry — and do not remove it until Part H is settled.

## Part F — your user, and the two accounts

The production instance starts empty. Recreate, in this order:

1. **Your own user** (`danlopez508@gmail.com`), then set its `public_metadata`
   to `{"app_role": "agency_admin"}`. Without this you cannot reach anything.
2. **An organization per real account.** Two matter: Bespoke Intelligent
   Solutions and Test Client One. Record each new `org_…` id.
3. **Re-point the account rows.** This is the data half of the migration, and
   it is two rows:

```sql
-- Run as a SEPARATE statement per row, and read the table back afterwards.
update public.accounts set clerk_org_id = '<new prod org id>'
 where clerk_org_id = 'org_3IejCERXojXO4BGgiKSHL34lT5O';  -- Bespoke
update public.accounts set clerk_org_id = '<new prod org id>'
 where clerk_org_id = 'org_3H2aweJ6b2GRZghk3DCrNDmrMXU';  -- Test Client One
```

Test Client One is the only row with `client_access_enabled = true`, so it is
the only one where a client signing in is even possible. Bespoke has client
access off; re-point it anyway so the agency side stays coherent.

## Part G — Vercel env

Set `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (now `pk_live_…`) and
`CLERK_SECRET_KEY` on **Production and Preview**, plus `apps/web/.env.local`
for local dev. `NEXT_PUBLIC_CLERK_SIGN_IN_URL` stays `/sign-in`.

Redeploy. The keys are read at build time.

## Part H — e2e (a decision, not a step)

`apps/web/e2e/auth.setup.ts` signs in as the one real Clerk user
(`danlopez508@gmail.com`, overridable via `E2E_ADMIN_EMAIL`) and then creates
its **own** per-run client user and org through the Clerk Backend API. It only
ever reads `Test Client One` through the agency path, which matches on
`is_agency()` and never on `org_id` — so the suite does not depend on Test
Client One's org id at all.

That means either option works:

- **e2e stays on the development instance.** The CI secrets do not change, and
  the suite stops sharing an instance with production — the split the design
  artifact wanted, for free. **Requires Supabase to trust both Clerk domains
  at once (Part E).** The e2e-created fixture orgs would be dev-instance orgs
  writing rows into the shared production database, which is already true
  today.
- **e2e moves with production.** Update the two CI secrets to the `pk_live_` /
  production pair. One instance, one trust entry, nothing to verify about
  multi-domain support — but the suite then creates and deletes real users in
  the production instance on every run.

Recommendation: **keep e2e on the development instance** if Part E confirms
two domains are supported, because it also removes a standing hazard. If it
does not, move e2e and accept the fixture churn.

## Part I — verify, in this order, and stop at the first failure

1. `/sign-in` renders with **no** Development-mode banner and no "(dev)".
2. Sign in as yourself → you reach the agency dashboard, not `/`. (Proves
   `app_role` survived into the token.)
3. On any in-account screen, a list that reads through `dbForRequest()`
   returns **rows**. Zero rows here is the silent failure from Part C/E, not
   an empty account — check the token claims before assuming data is missing.
4. Mint a token and read its claims directly; confirm all three of `org_id`,
   `role=authenticated`, `app_role` are present.
5. Smoke production: `/` 200 · `/sign-in` 200 · `/api/cron/reminders` 401 ·
   `/b/bogus` 404.
6. Run the e2e suite once, alone.

## When something is wrong

- **Every list is empty, nothing errors.** The session token is missing
  `org_id` or `role`, or Supabase is still pinned to the old domain. Read the
  minted token's claims; do not start reading application code.
- **You are redirected to `/` after signing in.** `app_role` is missing from
  the token, or your user's `public_metadata` was not set on the *production*
  instance.
- **A client lands on `/no-access`.** Their org id does not match any
  `accounts.clerk_org_id` (Part F step 3 not done for that account), or
  `client_access_enabled` is false for it.
- **Sign-in itself fails.** DNS not verified yet (Part D), or the keys are a
  mismatched pair — the publishable and secret keys must come from the same
  instance.

## Rollback

Every step is reversible until Part F step 3. Put the old `pk_test_` /
`sk_test_` pair back in Vercel, redeploy, and the app is on the development
instance again.

After Part F step 3 it is no longer reversible by env alone: the account rows
now hold production org ids, so a rollback also means running the two `update`
statements back to the ids recorded in Part A. **Keep that pre-flight output
until the migration is verified.**
