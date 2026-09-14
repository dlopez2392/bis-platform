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

## Part C2 — primary or secondary application

The Change-domain dialog asks this, and the answer is **Secondary**.

|  | Primary | **Secondary** |
|---|---|---|
| Clerk's API | `clerk.bis-rgv.com` | `clerk.app.bis-rgv.com` |
| Verification mail from | `@bis-rgv.com` | `@app.bis-rgv.com` |

`bis-rgv.com` is where Resend sends client mail from (`crm@bis-rgv.com`), and
its DKIM/SPF records live in that zone. Primary would put Clerk's own DKIM
keys — and possibly a DMARC policy — on top of them. Secondary nests
everything under `app.bis-rgv.com`, which carries no email. The cost is that
Clerk's sign-in codes then come from a subdomain with no sending reputation;
that is the better trade, because the alternative risks the weekly reports.

## Part D — DNS

Clerk gives the production instance five CNAMEs under `app.bis-rgv.com`:
`clerk.app`, `accounts.app`, `clkmail.app`, `clk._domainkey.app`,
`clk2._domainkey.app`. `bis-rgv.com` runs on Vercel's nameservers
(`ns1/ns2.vercel-dns.com`), so Clerk's **Configure automatically** button
(Domain Connect) places all five for you.

Before approving in Vercel, check that every record is under **`app`**.
Anything at the bare `bis-rgv.com` level — especially `_dmarc` or
`_domainkey` — means Part C2 was answered Primary; cancel and fix that first.

> ### 🔴 This step took production down, on 2026-09-14. Read it.
>
> **Adding those records removed the `app` record itself**, and
> `app.bis-rgv.com` stopped resolving entirely — no A, no AAAA, no CNAME.
> `curl` reported `Could not resolve host`. The deployment was healthy the
> whole time; only DNS was broken, which is why the Vercel deployment list
> looks reassuring and tells you nothing.
>
> **The cause is that `app` was a CNAME.** A CNAME is an alias for everything
> at and below its name, so it cannot coexist with `clerk.app`,
> `accounts.app` and the rest. Something in the Domain Connect flow resolved
> the conflict by dropping `app`.
>
> **The fix, and the way to avoid it:** `app.bis-rgv.com` must be an **A
> record**, not a CNAME.
>
> ```
> Name: app     Type: A     Value: 76.76.21.21     TTL: 60
> ```
>
> Vercel's Domains page will recommend a CNAME
> (`<hash>.vercel-dns-017.com`). **Do not use it here** — it re-creates the
> conflict. Vercel's own note on that page says the legacy `76.76.21.21`
> continues to work, and an A record has no restriction on names beneath it.
> Add it under **Domains → bis-rgv.com → DNS Records** (team level, not the
> project). The Name field takes the subdomain only — `app`, not
> `app.bis-rgv.com` — and the greyed `76.76.21.21` in the Value box is
> placeholder text that must actually be typed.
>
> **Check `app.bis-rgv.com` resolves before and after this part**, e.g.
> `nslookup app.bis-rgv.com 8.8.8.8`. Clerk's own DNS screen reports 5/5
> Verified while the app is down, because it only checks its own records.

## Part E — tell Supabase about the new domain

Supabase dashboard → Authentication → Third-Party Auth → **Add provider** →
Clerk → `https://clerk.app.bis-rgv.com`.

Take the domain from the instance itself rather than assembling it by hand:

```
curl -s https://clerk.app.bis-rgv.com/.well-known/openid-configuration
```

The `issuer` field is the value Supabase wants, and a 200 here also proves the
SSL certificate has finished issuing.

**Leave the development entry in place.** Settled 2026-09-14: **Supabase holds
two Clerk providers at once** — both show ENABLED side by side. That is what
lets e2e stay on the development instance (Part H), and removing the dev entry
before the key swap would take production down immediately.

## Part F — your user, and the two accounts

The production instance starts empty. Recreate, in this order:

1. **Your own user** (`danlopez508@gmail.com`), then set its `public_metadata`
   to `{"app_role": "agency_admin"}`. Without this you cannot reach anything.
2. **An organization per real account.** Two matter: Bespoke Intelligent
   Solutions and Test Client One. Record each new `org_…` id — Clerk's ids
   differ only well into the string, so copy rather than retype.

**Do NOT re-point the account rows yet.** That step moved after the key swap
— see Part I — so that the whole migration stays reversible by environment
variable until you have proved sign-in works.

### What the copy-from-development option does and does not carry

Creating the production instance offers to copy settings from development.
Take it: organization settings, sign-in methods and customization all come
across, **including the session-token customization in Part C** (verify it
anyway; it is the one setting where "probably" is not good enough).

It does **not** carry: users, organizations, or **Google's OAuth credentials**.
Development instances borrow Clerk's shared Google credentials and production
instances may not, so `oauth_google` arrives enabled but non-functional and
the setup checklist will keep asking for it. Nothing in this repo references
Google sign-in — no `oauth_google`, no provider strategy, and e2e signs in
through the Backend API — so you may either supply your own credentials (a
Google Cloud project, consent screen, and a redirect URI pointing at
`clerk.app.bis-rgv.com`) or switch it off and rely on email code and password.
Neither blocks the migration.

## Part G — Vercel env

Take the keys from **Instance → API keys**, not Configure → Developers → API
keys; the latter is an unrelated product feature for minting your users' own
keys.

Set both on **Production ONLY**:

| Variable | Value | Type |
|---|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `pk_live_…` | **Config** |
| `CLERK_SECRET_KEY` | `sk_live_…` | Secret |

**Not Preview.** A Clerk production instance is bound to `app.bis-rgv.com`;
preview deployments run on `*.vercel.app`, where the session cookie does not
apply. Leave Preview on the `pk_test_` pair. `NEXT_PUBLIC_CLERK_SIGN_IN_URL`
stays `/sign-in`.

`NEXT_PUBLIC_` variables cannot be Vercel "Secret" type — Vercel rejects them
with *"Environment variables with a public framework prefix cannot use
`visibility: secret`"* — and a variable already saved as Secret cannot be
converted. Delete that row and re-add it as **Config**.

**Then redeploy, uncached.** `NEXT_PUBLIC_` values are compiled into the
browser bundle at build time, so changing them in Vercel does nothing until a
new build runs.

Verify the swap from outside the dashboard:

```
curl -s https://app.bis-rgv.com/sign-in | grep -oE "pk_(live|test)_[A-Za-z0-9]{6,24}"
```

The `pk_live_` value base64-decodes to the Frontend API host, so it also
confirms which instance is being served.

## Part H2 — re-point the account rows (the irreversible step)

Only now, after sign-in is proven in Part I steps 1–3. Two rows, run one at a
time in the Supabase SQL editor:

```sql
update public.accounts set clerk_org_id = '<new prod org id>'
 where clerk_org_id = 'org_3IejCERXojXO4BGgiKSHL34lT5O';  -- Bespoke
update public.accounts set clerk_org_id = '<new prod org id>'
 where clerk_org_id = 'org_3H2aweJ6b2GRZghk3DCrNDmrMXU';  -- Test Client One
```

The editor reports **"Success. No rows returned"** for both — an `UPDATE`
without `RETURNING` never returns rows, so that message says nothing about
whether anything changed. Read the table back to confirm:

```sql
select name, clerk_org_id, client_access_enabled from public.accounts order by created_at;
```

Test Client One is the only row with `client_access_enabled = true`, so it is
the only one where a client signing in is even possible. Bespoke has client
access off; re-point it anyway so the agency side stays coherent. The
`Fixture Co` rows are test residue with synthetic `org_test_*` ids — leave
them.

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

**Steps 1–3 gate Part H2.** Do not touch the database until all three pass;
everything up to here is undone by putting the old keys back and redeploying.

1. `app.bis-rgv.com` **resolves**, and `/` 200 · `/sign-in` 200 ·
   `/api/cron/reminders` 401 · `/b/bogus` 404.
2. `/sign-in` renders with **no** Development-mode banner. Sign in as
   yourself → you reach the agency dashboard, not `/`. That proves `app_role`
   survived into the token.
   🔑 **Type the email; do not let autofill choose it.** The production
   instance holds exactly one user. An unknown address sends you down
   `/sign-in/**create**/…`, which signs up a second user with no `app_role`
   — which then bounces to `/` and reads exactly like a failed migration.
3. On any in-account screen, a list that reads through `dbForRequest()`
   returns **rows**. Zero rows here is the silent failure from Part C/E, not
   an empty account — check the token claims before assuming data is missing.
4. Run Part H2.
5. Sign in as a client user of Test Client One and confirm they reach their
   own account rather than `/no-access`. This is the only thing Part H2
   buys: the agency path never reads `org_id`, because `app.is_agency()`
   short-circuits every policy ahead of it.
6. Run the e2e suite once, alone. It still authenticates against the
   development instance and needs no changes.

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

## When something is wrong — one more

- **`app.bis-rgv.com` will not resolve at all.** DNS, not the deployment. See
  the boxed warning in Part D; the `app` A record is missing.

## Rollback

Every step is reversible until **Part H2**. Put the old `pk_test_` /
`sk_test_` pair back in Vercel, redeploy, and the app is on the development
instance again. Nothing else needs undoing: the production instance, its DNS
records and the second Supabase provider are all additive and harmless while
unused.

After Part H2 it is no longer reversible by env alone: the account rows now
hold production org ids, so a rollback also means running the two `update`
statements back to the ids recorded in Part A. **Keep that pre-flight output
until the migration is verified.**

## Done — 2026-09-14

Executed on this date. Production serves `pk_live_…` against
`clerk.app.bis-rgv.com`; the agency dashboard renders live data, which proves
both silent failures clear; both account rows re-pointed and read back.
Outstanding afterwards: the application is still named "BIS Platform (dev)"
(Application → Settings — the instance move removed the banner, not the
name), and Google sign-in still has no production credentials.
