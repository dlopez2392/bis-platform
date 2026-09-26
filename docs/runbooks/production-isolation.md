# Production isolation: Preview and the development Clerk issuer

**Status, 2026-09-26: NOT DONE.** Every step below is an owner action in the
Vercel, Supabase or Clerk dashboard. Nothing in this repository changes those
settings, and until the steps are done both paths described next are open.

Audience: danlo. Read the whole runbook before starting; the order matters.
Keep the notes from Part A until Part F is done: Part B's checks, Part E's
choices and the rollbacks all read them.

## The two paths

Both let a credential that is not production's reach production's client data.

**1. Production's Supabase trusts the development Clerk instance.**
Production's project (`tlbkbmlrfafquucsmsmm`) holds two Clerk entries under
Third-Party Auth: the production instance, `https://clerk.app.bis-rgv.com`, and
the development instance, `https://topical-redfish-40.clerk.accounts.dev`
(recorded 2026-09-14, `clerk-setup.md` Part E; A2 re-reads them). The second
was kept so e2e could stay on the development instance. Supabase accepts a
session token from either one.

RLS admits every row to a token whose `app_role` claim is `agency_admin`
(`app.is_agency()`, `packages/db/supabase/migrations/0001_tenancy.sql:9-12`).
The development instance's own agency user already carries that claim
(`packages/db/src/test/user-client.integration.test.ts:7`), and the
development secret key can mint a session token for any of that instance's
users. So whoever holds the development secret key holds agency access to
every tenant's production data. That key is held by the repository secret
`CLERK_SECRET_KEY` (read by `ci.yml` and `screenshots.yml`), by Vercel Preview,
and by local env files.

**2. Vercel Preview holds production's database credentials and has no
Deployment Protection.** Preview's Supabase values point at production's
project (recorded in the M7a billing spec,
`docs/superpowers/specs/2026-09-24-m7a-client-billing-design.md:73`, and true
by construction before #133, when production's was the only project; this
runbook did not read the values, and A1 confirms them), while
`clerk-setup.md` Part G keeps Preview on the development Clerk pair — which is
why Preview needs path 1. Vercel builds a preview
deployment for pushed branches — on 2026-09-26 the three most recent were all
built from an agent's docs branch — and each one runs that branch's code with
production's service-role key, which bypasses RLS entirely. Measured
2026-09-26, from outside: a preview deployment answers `/` and `/sign-in` with
200 and no Vercel login, and its sign-in page carries a `pk_test_` key (the
development instance).

## What still needs the development issuer on production

Read off the repository on 2026-09-26 (main at `7cd7b481`):

| Consumer | Clerk instance | Supabase project | Needs the dev issuer on production? |
|---|---|---|---|
| CI `verify` | development (repository secrets) | `bis-ci`, enforced by `.github/scripts/ci-target-guard.sh` | **No** |
| CI `e2e` | development | `bis-ci`, same guard | **No** |
| `ci-project-setup.yml` | none | `bis-ci` | **No** |
| `seed-demo.yml` | none (service role only) | production | **No** |
| `screenshots.yml` | development (`CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`) | production (`NEXT_PUBLIC_SUPABASE_URL` and the other production repository secrets) | **Yes.** It signs in as the development agency user and reads the demo tenant through `dbForRequest()` |
| Local `pnpm check`, e2e, integration suite | development | refused on production since #135 | **No** |
| Local `pnpm dev`, `pnpm start` or `pnpm --filter web screenshots` while `apps/web/.env.local` still names production (plan step D7) | development | production (none of these has a production guard) | **Yes** |
| Vercel Preview | development (`pk_test_`) | production | **Yes**, until Part B |
| Vercel Production | production (`pk_live_`, measured 2026-09-26) | production | **No** |

CI and e2e no longer need it: since #133 they run on `bis-ci`, whose only
Third-Party Auth entry is the development instance
(`ci-supabase-project.md`, section 1 step 2). Three things still do.
Part B moves Preview. The other two are accepted as broken by Part D until
they move: `screenshots.yml` (a manual button; moving it onto the CI project is
a separate change) and local runs of the app against production (fixed by D7,
`ci-supabase-project.md` section 9).

## The order, and why

A pre-flight → B Preview onto the CI project → C Deployment Protection →
D remove the development issuer from production → E rotate → F record.

Consumers move before the thing they depend on is removed, the same rule
`clerk-setup.md` Part E followed for this very entry. D closes path 1. Path 2
takes three parts: B stops new previews receiving production's values, C puts
every preview, old and new, behind a login, and E revokes what the old ones
still hold (a deployment keeps the environment it was built with). Rotation
comes last on purpose: a production key
rotated while Preview still receives production's values lands on Preview
again, and a development key rotated while production still trusts that
instance is still a production key.

## Part A — pre-flight (read only; keep the notes)

1. **Vercel → bis-platform → Settings → Environment Variables.** Filter to
   **Preview** and write down every variable NAME that has Preview ticked, and
   whether that row is shared with Production (one row ticked for both is one
   value used in both). Names only; do not copy values. Do the same for the
   **Development** environment.

   For `SUPABASE_SERVICE_ROLE_KEY` alone, also note which case it is, because
   Part B deletes the evidence and Part E needs it:
   (a) one row shared with Production, so Preview held Production's key;
   (b) a Preview-only row whose value Vercel will reveal: note its first 14
   characters (`sb_secret_` plus four), nothing more;
   (c) a Preview-only Sensitive row: its value cannot be read back.
2. **Supabase → production project → Authentication → Third-Party Auth.**
   Record both Clerk entries and their state. Expected:
   `https://clerk.app.bis-rgv.com` and
   `https://topical-redfish-40.clerk.accounts.dev`, both enabled.
3. **Supabase → production project → Settings → API Keys.** Record the NAMES of
   the secret keys and their masked prefixes. Part E uses them to tell which
   key Preview held.
4. Confirm production does not use the development entry:

   ```bash
   curl -s https://app.bis-rgv.com/sign-in | grep -oE "pk_(live|test)_" | sort -u
   ```

   Expect `pk_live_` only (it was, on 2026-09-26). If it prints `pk_test_`,
   STOP: production is on the development instance and Part D would take it
   down.

## Part B — point Preview at the CI project

The CI project (`bis-ci`, ref `odnobiodsftffphuuosz`) already exists, is kept
in parity with production (`ci-supabase-project.md` section 5), and already
trusts the development Clerk instance, which is what Preview signs in with.
A separate staging project would work the same way but costs a second project
and a third apply for every migration; use the CI project unless that changes.

1. **Supabase → `bis-ci` → Settings → API Keys →** create a secret key named
   `preview`. A key of its own, not the `ci` key, so either can be revoked
   without breaking the other.
2. **Vercel → Environment Variables, Preview only.** Where a row is shared with
   Production, edit it to untick Preview (Production keeps its value), then add
   a Preview-only row. [assumption: Vercel lets a shared row's environments be
   edited, Sensitive rows included; if it does not, add the Production-only
   row BEFORE deleting the shared one, so Production is never without it.]
   Vercel silently ignores "Add New" on a name that already exists for that
   environment, so remove first, then add.

   | Variable | Preview value | Type |
   |---|---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://odnobiodsftffphuuosz.supabase.co` | Config (Vercel refused a `NEXT_PUBLIC_` value as a secret in `clerk-setup.md` Part G) |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the CI project's publishable key, the literal in `ci.yml` and `.env.example` | Config |
   | `SUPABASE_SERVICE_ROLE_KEY` | the `preview` key from step 1 | Sensitive |
   | `SUPABASE_DB_URL` | **remove from Preview.** Nothing in the app reads it at runtime; only the test suites and the CI tools do | — |
   | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | keep the development pair (`pk_test_` / `sk_test_`) | as today |

3. **Remove every production credential from Preview**, using the list from
   A1 and the table in "What may live on Preview" below. Write down which ones
   were there: Part E rotates exactly those.
4. **Build a new preview** (push any branch, or Redeploy the latest preview
   with the build cache off). A deployment keeps the environment it was built
   with, server-side secrets included, so every preview built before this
   step still runs with production's database and whatever else Preview held,
   until it is deleted or Part E revokes those values. Part C puts them behind
   a login; Part E makes them harmless.

**Verify.**

- Sign in on the new preview and open `/dashboard/accounts`. It lists the CI
  project's accounts (Test Client One, plus any e2e fixture accounts) and none
  of your real clients' accounts, and no account row named Bespoke Intelligent
  Solutions: that is a production account the CI seed never creates. (The
  same words also appear in the app's own tagline, which is not an account
  row.) That list reads through `serviceDb()`, so it proves only the URL and
  the service key. Then open Test Client One → Contacts: Maria Garcia is
  listed. That page reads through `dbForRequest()`, so it proves the
  publishable key and the CI project's trust of the development instance.
- Environment Variables filtered to **Preview**: every name listed is in the
  first three rows of "What may live on Preview" below, and none is in
  "Never on Preview"; the three Supabase rows are Preview only.
- Filtered to **Production**: every name A1 recorded as shared is still listed
  with Production ticked. A Production row lost here breaks nothing until the
  next push to main, which is why it is checked now.

**While Preview is on the CI project,** it shares the account every e2e run
uses. Browse freely, but mutate only on an account you create yourself, never
Test Client One (the same rule as `CLAUDE.md`'s for specs). The CI project is
disposable (`ci-supabase-project.md` section 8): a rebuild drops anything
created from a preview.

**Roll back.** Re-tick Preview on the Production rows and build a new preview.
Preview-only rows removed in step 2 cannot be restored from the notes, which
hold names only. This re-opens path 2, so treat it as a stopgap.

## Part C — Deployment Protection for Preview

1. **Vercel → bis-platform → Settings → Deployment Protection → Vercel
   Authentication →** on, scope **Only Preview Deployments** (the API's
   `ssoProtection.deploymentType: "preview"`).
   - If the dashboard offers only **Standard Protection**
     (`prod_deployment_urls_and_all_previews`): it also covers production's
     generated `*.vercel.app` URLs. `app.bis-rgv.com` stays public either way,
     but cron and webhook requests can arrive on the generated URL
     (`.env.example`'s `APP_ORIGIN` note), so after enabling it check the
     cron and webhook lines below.
   - **Never "All Deployments".** It would put `app.bis-rgv.com` behind a
     Vercel login and break the booking pages, public forms, webhooks and
     the cron.
   - [assumption: the three scopes and what each covers are as Vercel's API
     documentation described `ssoProtection.deploymentType` on 2026-09-26;
     the dashboard's wording may differ]
2. Nothing automated fetches a preview URL today (Playwright runs its own
   server on `localhost:3000`), so no bypass secret is needed.

**Verify.**

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<any preview>.vercel.app/
```

Expect 401 or a redirect to a Vercel login, instead of the 200 measured on
2026-09-26. Then production's smoke must be unchanged:

```bash
for p in / /sign-in /api/cron/reminders /b/bogus; do printf '%s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' https://app.bis-rgv.com$p)"; done
```

Expect `/ 200`, `/sign-in 200`, `/api/cron/reminders 401`, `/b/bogus 404`. With
Standard Protection, also watch the next `/api/cron/reminders` run in Vercel's
logs (every 15 minutes) return 200, and a Resend or Telnyx webhook land.

**Roll back.** Switch Vercel Authentication off. [assumption: it applies at
once, without a redeploy, as switching it on does; the Verify `curl` shows
which.]

## Part D — remove the development Clerk provider from production Supabase

Prerequisite: Part B done, or Preview's in-account pages fail after this.
Accepted: `screenshots.yml` and local runs of the app against production fail
the same way until they move (the table above).

**The check, before and after.** It needs two browser tabs, each signed in as
the agency user: a preview deployment (development instance) and
`app.bis-rgv.com` (production instance). In each tab's DevTools console run:

```js
const t = await window.Clerk.session.getToken();
(await fetch("https://tlbkbmlrfafquucsmsmm.supabase.co/rest/v1/accounts?select=id&limit=1", {
  headers: { apikey: "sb_publishable_h2GmSCjLzD74RotkQAvMbA_BL6FAI4k", Authorization: `Bearer ${t}` },
})).status
```

The `apikey` is production's publishable key: public by design, and the same
literal `screenshots.yml` uses. The token is minted and spent in one line
because Clerk session tokens are short-lived [assumption: about 60 seconds].
If the console reports a CORS error, run the same request with `curl`
straight after minting the token.

| | Preview tab (development token) | Production tab (production token) |
|---|---|---|
| Before Part D | **200**: path 1 is open | 200 |
| After Part D | **401** (any 4xx; what matters is that it is no longer 200) | **200** |

If the preview tab answers anything but 200 BEFORE the change, the check is
broken (most likely the `apikey`), not the path closed. Fix the check first.
The production tab's 200 after the change is what proves the refusal is about
the issuer and not the request. [assumption: Supabase stops accepting a
removed issuer within minutes; if the preview tab still answers 200 right
after the change, wait five minutes and run it again.]

**Do.** Supabase → production project → Authentication → Third-Party Auth →
the Clerk entry for `https://topical-redfish-40.clerk.accounts.dev` → remove
it. Read the domain twice: removing `https://clerk.app.bis-rgv.com` instead
takes production down, and it fails quietly — every in-account page errors
or reads empty (`clerk-setup.md`, "The two failures that are silent").

**Verify.**

1. The check table's "After" row: 401 in the preview tab, 200 in the production
   tab.
2. Production still works: sign in at `app.bis-rgv.com` and open an
   in-account list, e.g. a client's Contacts; it returns rows (`clerk-setup.md`
   Part I, step 3). That list reads through `dbForRequest()`, so it is the
   one that fails if the wrong entry went. The agency accounts list reads
   through `serviceDb()` and would look fine either way. The smoke `curl`
   from Part C is unchanged.
3. The next CI run on any branch is green on its head SHA. CI never used this
   entry; this proves it.

**Roll back.** Add the provider back: Third-Party Auth → Add provider → Clerk →
`https://topical-redfish-40.clerk.accounts.dev` (take the value from
`curl -s https://topical-redfish-40.clerk.accounts.dev/.well-known/openid-configuration`,
field `issuer`, as `clerk-setup.md` Part E does). If the wrong entry was
removed, add `https://clerk.app.bis-rgv.com` back the same way, at once.

## Part E — rotate

### E1. The production credentials Preview held

Only what Part B step 3 recorded. For each: make a new value at the provider,
put it everywhere the table below says, redeploy production, verify, and only
then revoke the old one. Never put the new value on Preview.

**Four of them have one live value on each side**, so the time between the
provider change and the production redeploy is an outage for that path. Do
them outside business hours, one at a time, with the redeploy ready before
the provider change:

- `OPENAI_WEBHOOK_SECRET`: every inbound call is refused with 400 until
  production carries the new value
  (`apps/web/src/app/api/voice/incoming/route.ts:726-732`). [assumption: an
  OpenAI project can hold a second webhook endpoint for the same URL; if so,
  add the new endpoint, deploy its secret, then delete the old endpoint, and
  there is no window.]
- `RESEND_WEBHOOK_SECRET`: delivery events are refused in the same window.
- `SOFIA_WEB_SECRET`, `LEAD_INTAKE_SECRET`: the website's "Talk to Sofía" and
  its lead posts fail until BOTH projects are redeployed.

| Credential | Where to rotate | Where the new value goes |
|---|---|---|
| Supabase secret key (`SUPABASE_SERVICE_ROLE_KEY`) | production → Settings → API Keys | Vercel Production; the repository secret `SUPABASE_SERVICE_ROLE_KEY` (`seed-demo.yml`, `screenshots.yml`); any local env file still on production |
| Database password (only if Preview held `SUPABASE_DB_URL`) | production → Database → Settings → reset the password | the repository secret `SUPABASE_DB_URL`; local `packages/db/.env` while it is on production. Vercel Production only if the variable exists there (the app does not read it) |
| `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` | Resend → API Keys; the webhook's signing secret [assumption: dashboard paths] | Vercel Production |
| `TELNYX_API_KEY` | Telnyx portal → API Keys | Vercel Production |
| `OPENAI_API_KEY`, `OPENAI_WEBHOOK_SECRET` | the "BIS Platform Voice" OpenAI project: API keys; Webhooks → the `realtime.call.incoming` endpoint | Vercel Production (`voice-setup.md`) |
| `DAILY_API_KEY` | Daily → Developers [assumption: dashboard path] | Vercel Production |
| `VERCEL_API_TOKEN` | Vercel → Account → Tokens (`website-setup.md` Part A) | Vercel Production |
| `CRON_SECRET`, `FORM_TOKEN_SECRET` | any new long random string | Vercel Production |
| `SOFIA_WEB_SECRET`, `LEAD_INTAKE_SECRET` | any new long random string | Vercel Production AND the bis-website project, byte-identical |
| `STRIPE_SECRET_KEY` (any mode) | Stripe → Developers → API keys | wherever it belongs per `.env.example`'s Stripe block |

Two more consequences to expect:

- **Which Supabase secret key.** Use A1's note. Only in case (b), with a
  prefix matching a key in A3's list that is not Production's, delete that
  key and you are done. In every other case, including "cannot tell", treat
  it as Production's: create a new key, switch Production to it (Remove, then
  add, Sensitive), redeploy, verify the smoke and one cron run, then delete
  the old key. [assumption: Supabase lists secret keys by name with a masked
  prefix, and a `sb_secret_` key can be deleted without touching the others.
  A legacy `eyJ…` service-role key cannot be rotated that way, because
  rotating the JWT secret also changes the anon key; if Preview held a legacy
  key, move Production to a `sb_secret_` key first, then disable the legacy
  keys.]
- **Public forms, booking pages and the website chat.** All three sign a
  render token with `FORM_TOKEN_SECRET`, or, while that is unset, with a key
  derived from the Supabase secret key
  (`apps/web/src/lib/forms/guards.ts:36-42`). Changing the key in use
  invalidates every token issued before the redeploy (they live 30 minutes,
  `guards.ts:19`), and silently: a form submitted from an old page is filed
  as spam behind a success message, a booking returns the same fake success
  and books nothing (`apps/web/src/app/b/[publicId]/actions.ts:222-236`), and
  a chat refuses to start
  (`apps/web/src/app/api/concierge/[publicId]/turn/route.ts:205-219`). Rotate
  outside business hours.

**Verify** each rotation where it is used: the production smoke, one cron run
returning 200, one form submission and one booking from a freshly loaded
page, one test call or text if a voice or SMS credential moved. Then confirm
the old value is gone from the provider's list.

### E2. The development Clerk secret key

After Part D this key no longer reaches production. It still opens the
development instance and, through it, the CI project, and it has sat in the
repository secret, on Preview and in local env files, so it goes too.

1. Clerk → the development instance (`topical-redfish-40`) → API keys → create
   a new secret key. [assumption: the instance allows a second secret key
   alongside the first; if it only offers to roll the key, the old one stops
   at once, so update step 2 immediately]
2. Put it in: the repository secret `CLERK_SECRET_KEY` (Remove, then add; paste
   it straight into GitHub, never into a chat), Vercel Preview's
   `CLERK_SECRET_KEY` (Preview only), Vercel's Development environment if A1
   found it there, and the local `apps/web/.env.local` and `packages/db/.env`
   (the integration suite reads it from the latter).
3. Push any branch and read `verify` and `e2e` for its head SHA. `e2e` creates
   and deletes a Clerk user with this key, so green proves it works.
4. Delete the old key in Clerk.

**Verify.** Step 3's two green checks; a sign-in on a new preview; the Clerk
API keys page lists only the new key.

**Roll back.** Nothing to undo while the old key still exists. After it is
deleted, a red run means the new key is missing somewhere step 2 names.

## Part F — record

1. Change this file's status line to the date each part was done, and do the
   same everywhere else a dated "not done" stands: the "Clerk it trusts" and
   "Vercel Preview" rows in `ci-supabase-project.md` ("Facts"), the
   production-isolation bullet in `CLAUDE.md`, and the superseded note in
   `clerk-setup.md` Part E. `git grep -n -i "not done" -- CLAUDE.md
   docs/runbooks` lists them among a few unrelated hits (D7's own status,
   troubleshooting notes, this step); change only the ones that name this
   runbook's work.
2. Ledger line: `ISOLATION DONE <date> — Preview on bis-ci, protection on,
   dev issuer off production, rotated: <names>`.

## What may live on Preview

The rule: **Preview may hold the development Clerk instance, the CI project,
and non-secret configuration. Nothing that opens a production system.**

| Class | Variables |
|---|---|
| CI project values | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (the `preview` key) |
| Development Clerk instance | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (`pk_test_`), `CLERK_SECRET_KEY` (`sk_test_`), `NEXT_PUBLIC_CLERK_SIGN_IN_URL` |
| Non-secret configuration, fine on Preview | `EMAIL_FROM`, `AGENCY_SUPPORT_EMAIL`, `VERCEL_TEAM_ID`, `VOICE_OPENAI_PROJECT_ID`, `TELNYX_PUBLIC_KEY`, `TELNYX_VOICE_CONNECTION_ID`, `SOFIA_WEB_ORIGINS`, `SOFIA_WEB_NUMBER`, `SOFIA_WEB_DISPLAY_NUMBER`, `REALTIME_MODEL`, every `PHONE_*` knob |
| **Never on Preview** (production credentials) | `SUPABASE_DB_URL` (any project; unused by the app), `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `TELNYX_API_KEY`, `OPENAI_API_KEY`, `OPENAI_WEBHOOK_SECRET`, `DAILY_API_KEY`, `VERCEL_API_TOKEN`, `CRON_SECRET`, `FORM_TOKEN_SECRET`, `SOFIA_WEB_SECRET`, `LEAD_INTAKE_SECRET`, `STRIPE_SECRET_KEY`, and any webhook signing secret added later |
| Leave unset on Preview | `EMAIL_DEV_REDIRECT_TO`, `SMS_DEV_REDIRECT_TO`, `VOICE_FORWARD_TO`: inert without the provider keys, and nothing on a preview should send. `APP_ORIGIN`: set to production's domain, every link a preview builds points at production; unset, most links derive from the preview's own host (the web voice session still falls back to `app.bis-rgv.com`, `apps/web/src/app/api/voice/web/session/route.ts:204`) |

Without the provider keys, a preview's sending, calling and site-traffic
features report themselves unconfigured. That is the intended state: Preview is
for looking at screens.

## Not covered here

- **`screenshots.yml`** stops working at Part D. Moving it (and the demo seed
  it runs) onto the CI project is its own change.
- **Local development** (D7, `ci-supabase-project.md` section 9). Local tests
  already refuse production; `pnpm dev` does not.
- **The repository secrets named `NEXT_PUBLIC_SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_DB_URL`** still hold production's
  values for `seed-demo.yml` and `screenshots.yml`. A workflow run on any
  branch of this repository can read repository secrets [assumption: GitHub's
  behaviour for push-triggered workflows; forks do not receive them], so they
  are the same kind of path. The usual fix is a GitHub Environment limited to
  `main`, with the two workflows declaring it. A separate change.
