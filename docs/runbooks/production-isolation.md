# Production isolation: Preview and the development Clerk issuer

**Status, 2026-10-07: NOT CONFIRMED DONE.** Every step below changes a
setting in Vercel, Supabase or Clerk. Nothing in this repository changes
those settings. Until Part F records a date for each part, assume both paths
described below are open.

What is known, and from where:

- **Read through the Vercel API on 2026-10-06 (names only, no values).** These
  variables have Preview ticked: `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
  `SUPABASE_DB_URL`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`,
  `NEXT_PUBLIC_CLERK_SIGN_IN_URL`, and `VERCEL_TEAM_ID` and
  `VERCEL_API_TOKEN`. The last two have Production ticked as well.
- **Not known:** whether the Supabase and Clerk values on Preview name
  production or the CI project, whether Deployment Protection is on, and
  whether production's Supabase still trusts the development Clerk instance.
  Part A's checks answer each of these without printing a value. A part whose
  check already passes is skipped. Write down that it was skipped and why.

Who runs this: the owner (danlo), or an agent with Vercel API access, and
only with the owner's go-ahead for each part. Read the whole runbook before
starting, because the order matters. Keep the notes from Part A until Part F
is done: later parts, the rotations and the rollbacks all read them.

## The two paths

Both let a credential that is not production's reach production's client data.

**1. Production's Supabase trusts the development Clerk instance.**
Production's project (`tlbkbmlrfafquucsmsmm`) held two Clerk entries under
Third-Party Auth: the production instance, `https://clerk.app.bis-rgv.com`, and
the development instance, `https://topical-redfish-40.clerk.accounts.dev`
(recorded 2026-09-14, `clerk-setup.md` Part E; A5 re-reads them). The second
was kept so e2e could stay on the development instance. Supabase accepts a
session token from either one.

RLS admits every row to a token whose `app_role` claim is `agency_admin`
(`app.is_agency()`, `packages/db/supabase/migrations/0001_tenancy.sql:9-12`).
The development instance's own agency user already carries that claim
(`packages/db/src/test/user-client.integration.test.ts:7`), and the
development secret key can mint a session token for any of that instance's
users. So whoever holds the development secret key holds agency access to
every tenant's production data. That key is held by the repository secret
`CLERK_SECRET_KEY` (read by `ci.yml` and `screenshots.yml`), by Vercel Preview
(`CLERK_SECRET_KEY` is on Preview per the 2026-10-06 read), and by the local
env files `apps/web/.env.local` and `packages/db/.env`.

**2. Vercel Preview may hold production credentials, and may have no
Deployment Protection.** On 2026-09-26, Preview's Supabase values were taken
to name production's project. That is recorded in the M7a billing spec,
`docs/superpowers/specs/2026-09-24-m7a-client-billing-design.md:73`, and it
was true by construction before #133, when production's project was the only
one. Nobody has read the values since. On 2026-09-26, measured from outside,
a preview deployment answered `/` and `/sign-in` with 200 and no Vercel login,
and its sign-in page carried a `pk_test_` key, which is the development
instance. `clerk-setup.md` Part G keeps Preview on the development Clerk pair.
That is why Preview needs path 1 for as long as it reads production's
database.

Vercel builds a preview deployment for every pushed branch, and agents push
branches daily. Each preview runs that branch's code with whatever Preview
holds. If that includes production's service-role key, the branch's code
bypasses RLS entirely. One credential is a production credential on Preview
whatever the Supabase answer turns out to be: `VERCEL_API_TOKEN`, a
team-scoped token, has Preview ticked on the same row as Production (the
2026-10-06 read). `website-setup.md` Part A step 2 already says it never
belongs there.

## What still needs the development issuer on production

Read off the repository on 2026-10-07 (main at `1e4f0dd2`):

| Consumer | Clerk instance | Supabase project | Needs the dev issuer on production? |
|---|---|---|---|
| CI `verify` | development (repository secrets) | `bis-ci`, enforced by `.github/scripts/ci-target-guard.sh` | **No** |
| CI `e2e` | development | `bis-ci`, same guard | **No** |
| `ci-project-setup.yml` | none | `bis-ci` | **No** |
| `ops-health.yml` (hourly) | none (bearer `OPS_HEALTH_SECRET`) | production, through `https://app.bis-rgv.com/api/ops/health` | **No** |
| `seed-demo.yml` | none (service role only) | production | **No** |
| `screenshots.yml` | development (`CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`) | production (`NEXT_PUBLIC_SUPABASE_URL` and the other production repository secrets) | **Yes.** It signs in as the development agency user and reads the demo tenant through `dbForRequest()` |
| Local `pnpm check`, e2e, integration suite | development | refused on production since #135; danlo's machine on `bis-ci` since 2026-10-04 (D7) | **No** |
| Local `pnpm dev`, `pnpm start`, `pnpm --filter web screenshots` | development | whatever `apps/web/.env.local` names. On danlo's machine that has been `bis-ci` since D7. None of these commands has a production guard | **Only on a machine whose env still names production** |
| Vercel Preview | development (`pk_test_`, measured 2026-09-26) | unknown (A1, A4) | **Yes, if** Preview reads production; no once Part C is done |
| Vercel Production | production (`pk_live_`, measured 2026-09-26; A6 re-measures) | production | **No** |

CI and e2e no longer need it. Since #133 they run on `bis-ci`, whose only
Third-Party Auth entry is the development instance (`ci-supabase-project.md`,
section 1 step 2). Nothing in CI fetches a Vercel URL: no workflow names
`vercel.app` or a preview, and Playwright starts its own server on
`localhost:3000` (`apps/web/playwright.config.ts`, `webServer`). The ruleset on
`main` requires only `verify` and `e2e`, not a Vercel check. What still needs
the dev issuer: Preview, until Part C; and `screenshots.yml`, which Part D
accepts as broken until it moves (a manual button, so moving it onto the CI
project is a separate change).

## The order, and why

A pre-flight → B Deployment Protection → C Preview onto the CI project →
D remove the development issuer from production → E rotate → F record.

- **B first.** It depends on nothing, it is undone with one setting, and it
  closes the outside door on every preview at once, including old ones. A
  deployment keeps the environment it was built with, so a preview built
  before Part C keeps any production value it received until it is deleted or
  that value is rotated.
- **C before D.** Consumers move before the thing they depend on is removed.
  `clerk-setup.md` Part E followed the same rule for this very entry. A
  preview that still reads production's database with a development token
  loses every in-account page the moment D lands.
- **E last.** A production key rotated while Preview still receives production
  values lands on Preview again. A development key rotated while production
  still trusts that instance is still a production key.

What this breaks, on purpose:

- **B:** a preview URL now needs a Vercel login. danlo is a team member, so
  the links in Vercel's PR comments still open for him. An agent's browser
  without that login gets 401.
- **C:** a preview now shows the CI project's fixtures (Test Client One and
  e2e accounts), not real clients. A design review on a preview reviews CI
  data.
- **D:** `screenshots.yml` stops working.

## Tools for running it through the API

Run these in Git Bash, not PowerShell. Use the owner's own Vercel token, the
same kind the Vercel MCP connection uses. Never use the app's
`VERCEL_API_TOKEN`. Never use `gh api` either: it sends GitHub credentials and
gets 403. The token is pasted into a prompt that does not echo it, and nothing
below prints a value. A Vercel API response can carry values, and for `plain`
rows the value is plaintext. So every response goes through a filter that
prints named fields only, and it says nothing more than "not JSON" if parsing
fails. A parse error message can quote its input, and that is how a
production key was once echoed.

```bash
read -rs VERCEL_TOKEN; export VERCEL_TOKEN    # paste, Enter; nothing echoes
T=team_8zjV46sJxQDsVzikNQa1JaO2               # danlopez508-8452s-projects
P=bis-platform
V=https://api.vercel.com
api() { curl -sS -H "Authorization: Bearer $VERCEL_TOKEN" "$@"; }
# keep(): print only the named top-level fields of a JSON response.
keep() { node -e '
  let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
    let j; try { j = JSON.parse(s) } catch { console.error("response was not JSON; nothing printed"); process.exit(1) }
    if (j.error) { console.error("API error:", j.error.code ?? "unknown"); process.exit(1) }
    const pick = o => Object.fromEntries(process.argv.slice(1).map(k => [k, o?.[k] ?? null]));
    console.log(JSON.stringify(pick(j.created ?? j)));
  })' "$@"; }
# envs(): one line per env row: KEY, targets, type, id. Never a value.
envs() { api "$V/v10/projects/$P/env?teamId=$T" | node -e '
  let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
    let j; try { j = JSON.parse(s) } catch { console.error("response was not JSON; nothing printed"); process.exit(1) }
    if (j.error) { console.error("API error:", j.error.code ?? "unknown"); process.exit(1) }
    for (const e of j.envs ?? []) console.log([e.key, [...(e.target ?? [])].sort().join("+"), e.type, e.id, e.gitBranch ?? ""].join("\t"));
  })'; }
```

[assumption: the endpoint versions, the deployments list's `target` filter
and the field names (`envs[].target`, `type`, `id`; the project's
`ssoProtection`, `gitForkProtection`) are as Vercel's REST documentation
describes them. If one answers 404 or a field reads `null`
where a value is expected, use the dashboard path given beside each step.]

## Part A — pre-flight (read only; keep the notes)

1. **Env rows.** Run `envs | sort`, or use the dashboard (bis-platform →
   Settings → Environment Variables, filtered to Preview, then Development).
   Note, for every row with `preview` in its targets: the name, its full
   target list, its type and its id. **A row whose targets include both
   `production` and `preview` is one value used in both. That alone proves
   Preview holds Production's value, without reading it.** Compare with the
   2026-10-06 list in the status block. A name that has appeared since then
   is checked against "What may live on Preview" below.

   For `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_DB_URL`, also note which case
   applies. Part C deletes the evidence, and Part E needs it:
   (a) one row shared with Production, so Preview held Production's value;
   (b) a Preview-only row that is not Sensitive, whose value the owner can
   reveal in the dashboard. Note the first 14 characters of the key
   (`sb_secret_` plus four), or the project ref inside the DB URL, nothing
   more. An agent does not reveal values; it records "(b), unread";
   (c) a Preview-only Sensitive row, whose value cannot be read back.
2. **Deployment Protection and fork protection.**

   ```bash
   api "$V/v9/projects/$P?teamId=$T" | keep id ssoProtection gitForkProtection
   ```

   `ssoProtection: null` means Vercel Authentication is off. Note the
   project `id`, because A3 uses it. `gitForkProtection` should be `true`: the
   repository is public, and without that setting a stranger's fork PR builds
   a preview with Preview's environment. If it is `false`, turn it on first
   (Settings → Git → Git Fork Protection). Dashboard equivalent: Settings →
   Deployment Protection.
3. **The latest previews, and what they serve.**

   ```bash
   api "$V/v6/deployments?projectId=<id from A2>&target=preview&limit=3&teamId=$T" \
   | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch{console.error("not JSON");process.exit(1)}for(const d of j.deployments??[])console.log(d.url,d.state??d.readyState,new Date(d.created).toISOString(),d.meta?.githubCommitRef??"")})'
   curl -s -o /dev/null -w '%{http_code}\n' https://<a preview url>/sign-in
   curl -s https://<a preview url>/sign-in | grep -oE "pk_(live|test)_" | sort -u
   ```

   A 401 or a redirect to vercel.com means protection is already on, which
   should agree with A2. A 200 that prints `pk_test_` means a public preview
   on the development instance, the 2026-09-26 state. `pk_live_` on a
   preview means the production Clerk pair is on Preview, a production
   credential. Add `CLERK_SECRET_KEY` to Part E's list.
4. **Which database Preview reads.** A1's case (a) for
   `NEXT_PUBLIC_SUPABASE_URL` already answers this: production. Otherwise
   check behaviourally on a preview built after the last change to Preview's
   env (A3 dates). Sign in as the development agency user and open
   `/dashboard/accounts`. Production shows the real clients' accounts and the
   agency's own `Bespoke Intelligent Solutions` account. The CI project shows
   only Test Client One and e2e fixture accounts (the CI seed creates nothing
   else, `packages/db/src/ci-seed/config.ts`). That page reads through
   `serviceDb()`, so it proves the URL and the secret key. It says nothing
   about `SUPABASE_DB_URL`, which the app never reads. For that, only A1's
   case tells.
5. **Is production's Supabase still trusting the development instance?**
   Supabase → production project → Authentication → Third-Party Auth. Record
   each Clerk entry and whether it is enabled. On 2026-09-14 there were two,
   both enabled. Then run the dev-token check from Part D's "The check", in a
   tab signed in through the development instance. A preview works, and so
   does `pnpm dev` on danlo's machine (`localhost:3000`, development instance
   since D7). 200 means path 1 is open. Any 4xx means it is already closed,
   provided the check itself is sound (see Part D).
6. **Production does not use the development entry.**

   ```bash
   curl -s https://app.bis-rgv.com/sign-in | grep -oE "pk_(live|test)_" | sort -u
   ```

   Expect `pk_live_` only (it was, on 2026-09-26). If it prints `pk_test_`,
   STOP: production is on the development instance, and Part D would take it
   down.
7. **Supabase → production project → Settings → API Keys.** Record the NAMES
   of the secret keys and their masked prefixes. Part E uses them to tell
   which key Preview held.
8. **Where the providers' webhooks point.** Needed only if Part B ends up on
   Standard Protection, which also covers production's generated
   `*.vercel.app` URLs. OpenAI (the `realtime.call.incoming` endpoint),
   Telnyx (TeXML app and messaging profile), Resend and Stripe must each name
   `https://app.bis-rgv.com/...`, as the runbooks set them up
   (`voice-setup.md`, `a2p-registration.md`, `stripe-billing.md`). The
   original voice plan used `bis-platform-six.vercel.app`
   (`docs/superpowers/plans/2026-08-24-voice-core.md:2614-2616`), so any
   endpoint still on that host would be blocked. Move it to `app.bis-rgv.com` before
   Part B.

## Part B — Deployment Protection for Preview

**Skip if** A2 already shows `ssoProtection.deploymentType` of `preview` or
`prod_deployment_urls_and_all_previews`, and A3's preview answered 401.

1. Turn on Vercel Authentication, scope **Only Preview Deployments**.

   ```bash
   printf '%s' '{"ssoProtection":{"deploymentType":"preview"}}' \
   | api -X PATCH -H 'content-type: application/json' --data-binary @- "$V/v9/projects/$P?teamId=$T" \
   | keep ssoProtection
   ```

   Dashboard: Settings → Deployment Protection → Vercel Authentication → on,
   scope "Only Preview Deployments".
   - If only **Standard Protection** (`prod_deployment_urls_and_all_previews`)
     is accepted, it also covers production's generated `*.vercel.app` URLs.
     `app.bis-rgv.com` stays public either way. Do A8 first, then watch the
     cron lines in Verify.
   - **Never "All Deployments"** (`all`). It would put `app.bis-rgv.com`
     behind a Vercel login and break the booking pages, public forms,
     webhooks, the cron and `ops-health.yml`.
   - [assumption: the scopes and what each covers are as Vercel's API
     documentation describes `ssoProtection.deploymentType`; the dashboard's
     wording may differ]
2. No bypass secret is needed. Nothing automated fetches a preview URL (see
   the consumers table). Do not create "Protection Bypass for Automation"
   unless something does: it would be one more credential.

**Verify.**

```bash
api "$V/v9/projects/$P?teamId=$T" | keep ssoProtection
curl -s -o /dev/null -w '%{http_code}\n' https://<a preview url from A3>/
for p in / /sign-in /api/cron/reminders /api/ops/health /b/bogus; do printf '%s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' https://app.bis-rgv.com$p)"; done
```

Expect, in order: the scope you set; 401 or a redirect to a Vercel login on
the preview; then `/ 200`, `/sign-in 200`, `/api/cron/reminders 401`,
`/api/ops/health 401`, `/b/bogus 404` on production. Production must be
unchanged. Then, at least 45 minutes after the change, read the next hourly
`ops-health.yml` run, or start one with `gh workflow run ops-health.yml`. It
is green only if a cron tick has completed in the last 45 minutes, so green
proves that Vercel's cron still reaches the app. With Standard Protection,
also confirm that a Telnyx, Resend or Stripe webhook has landed since the
change (Vercel's runtime logs for `/api/sms/inbound`, `/api/webhooks/resend`,
`/api/webhooks/stripe`).

**Roll back.**

```bash
printf '%s' '{"ssoProtection":null}' | api -X PATCH -H 'content-type: application/json' --data-binary @- "$V/v9/projects/$P?teamId=$T" | keep ssoProtection
```

[assumption: the change applies at once, without a redeploy; the Verify
`curl` shows which.]

## Part C — Preview onto the CI project, and no production credential on Preview

**Skip the Supabase half if** A1 shows the three Supabase rows as
Preview-only, and A4 shows only CI accounts. Do the rest anyway.

The CI project (`bis-ci`, ref `odnobiodsftffphuuosz`) already exists. It is
kept in parity with production (`ci-supabase-project.md` section 5), and it
already trusts the development Clerk instance, which is what Preview signs
in with. A separate staging project would work the same way. It would cost a
second project, and a third apply for every migration. Use the CI project
unless that changes.

1. **Supabase → `bis-ci` → Settings → API Keys →** create a secret key named
   `preview`. Give Preview a key of its own, not the `ci` key, so that either
   can be revoked without breaking the other.
2. **Shared rows: take Preview off, and Production keeps its value.** For
   each row A1 found shared with Production that must leave Preview
   (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`, `VERCEL_API_TOKEN`, and
   the Clerk pair if A3 printed `pk_live_`), set its targets to Production
   only:

   ```bash
   printf '%s' '{"target":["production"]}' \
   | api -X PATCH -H 'content-type: application/json' --data-binary @- "$V/v9/projects/$P/env/<id>?teamId=$T" \
   | keep key target type
   ```

   [assumption: a PATCH may carry `target` without `value`, Sensitive rows
   included. If it refuses, add a Production-only row with the same value
   BEFORE deleting the shared one, so that Production is never without it.
   Only the owner can do that, because it needs the value.]
   `VERCEL_TEAM_ID` may stay shared: it is an id, not a credential.
3. **Preview-only rows that name production: delete them.**

   ```bash
   api -X DELETE "$V/v9/projects/$P/env/<id>?teamId=$T" | keep key target
   ```

   Do this for `SUPABASE_DB_URL` whatever it names: no running code reads it.
   Only the test suites and the CI tools do. Do it for every name in "Never
   on Preview" below. Write down which rows held production values (from A1:
   case (a), or a case (b) the owner revealed as production's, or a case (c)
   that cannot be told apart). Part E rotates exactly those, and treats
   "cannot tell" as production's.
4. **Add Preview's CI values.** Vercel refuses a second row with the same
   name and target (`ENV_ALREADY_EXISTS`). The dashboard's "Add New" fails
   silently in the same case, so the old row comes out first (steps 2 and 3).

   | Variable | Preview value | Type |
   |---|---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://odnobiodsftffphuuosz.supabase.co` | `plain` (a `NEXT_PUBLIC_` value cannot be secret, `clerk-setup.md` Part G) |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the CI project's publishable key, the literal in `ci.yml` and `.env.example` | `plain` |
   | `SUPABASE_SERVICE_ROLE_KEY` | the `preview` key from step 1 | `sensitive` |
   | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | the development pair (`pk_test_` / `sk_test_`); add only if step 2 took a shared `pk_live_` pair off Preview | `plain` / `sensitive` |

   The two public literals can be posted as they are. The secret key goes in
   through a prompt that does not echo, and it is never typed into a command
   line:

   ```bash
   add() { # add KEY TYPE ; value is read from the prompt, never echoed
     local v; read -rs v
     K="$1" TY="$2" VAL="$v" node -e 'process.stdout.write(JSON.stringify({key:process.env.K,value:process.env.VAL,type:process.env.TY,target:["preview"]}))' \
     | api -X POST -H 'content-type: application/json' --data-binary @- "$V/v10/projects/$P/env?teamId=$T" \
     | keep key target type id
   }
   add SUPABASE_SERVICE_ROLE_KEY sensitive    # paste the bis-ci `preview` key, Enter
   ```

5. **Build a new preview** (push any branch, or Deployments → the latest
   preview → Redeploy with the build cache off). A deployment keeps the
   environment it was built with. So every preview built before this step
   still runs with whatever Preview held, until it is deleted or Part E
   revokes those values. Part B has put them behind a login. Part E makes
   them harmless.

**Verify.**

- `envs | sort`: every row with `preview` in its targets is in the first
  three rows of "What may live on Preview" below. None is in "Never on
  Preview". The three Supabase rows and `CLERK_SECRET_KEY` are `preview` only.
- Every row A1 recorded as shared still has `production` in its targets. A
  lost Production row breaks nothing until the next push to main, which is
  why it is checked now.
- On the new preview, sign in and open `/dashboard/accounts`. It lists Test
  Client One and any e2e fixture accounts, and none of the real clients'
  accounts. It has no row named Bespoke Intelligent Solutions, a production
  account that the CI seed never creates. (The same words appear in the app's
  own tagline, which is not an account row.) That list reads through
  `serviceDb()`, so it proves the URL and the secret key. Then open Test
  Client One → Contacts: Maria Garcia is listed (the CI seed's contact). That
  page reads through `dbForRequest()`, so it proves the publishable key and
  the CI project's trust of the development instance.

**While Preview is on the CI project,** it shares the account that every e2e
run uses. Browse freely. Mutate only an account you create yourself, never
Test Client One (the same rule `CLAUDE.md` sets for specs), and check
`gh run list --workflow ci.yml --status in_progress` first. The CI project is
disposable (`ci-supabase-project.md` section 8): a rebuild drops anything
created from a preview.

**Roll back.** PATCH the step-2 rows back to
`{"target":["production","preview"]}`, delete the step-4 rows, and build a
new preview. Rows deleted in step 3 cannot be restored from the notes,
because the notes hold names only. Rolling back re-opens path 2, so treat it
as a stopgap.

## Part D — remove the development Clerk provider from production Supabase

**Skip if** A5 found no development entry and the dev-token check answered
4xx.

Prerequisite: Part C verified. Otherwise, any preview that still reads
production fails its in-account pages after this. Accepted: `screenshots.yml`
fails the same way until it moves. So does `pnpm dev` on any machine whose
env still names production (not danlo's since D7).

**The check, before and after.** It needs two browser tabs, each signed in as
the agency user. The first is signed in through the development instance: a
preview (Vercel login first, after Part B) or `pnpm dev` on `localhost:3000`.
The second is `app.bis-rgv.com`, signed in through the production instance.
In each tab's DevTools console, run:

```js
const t = await window.Clerk.session.getToken();
(await fetch("https://tlbkbmlrfafquucsmsmm.supabase.co/rest/v1/accounts?select=id&limit=1", {
  headers: { apikey: "sb_publishable_h2GmSCjLzD74RotkQAvMbA_BL6FAI4k", Authorization: `Bearer ${t}` },
})).status
```

The `apikey` is production's publishable key. It is public by design, and it
is the same literal that `screenshots.yml` uses. The request reads one
account id and prints only the status. The token is minted and spent in one
line because Clerk session tokens are short-lived [assumption: about 60
seconds]. If the console reports a CORS error, run the same request with
`curl` straight after minting the token.

| | Development tab | Production tab |
|---|---|---|
| Before Part D | **200**: path 1 is open | 200 |
| After Part D | **401** (any 4xx; what matters is that it is no longer 200) | **200** |

If the development tab answers anything but 200 BEFORE the change, either the
check is broken (most likely the `apikey`) or the entry is already gone. A5's
dashboard read tells which. The production tab's 200 after the change is what
proves the refusal is about the issuer and not the request. [assumption:
Supabase stops accepting a removed issuer within minutes. If the development
tab still answers 200 right after the change, wait five minutes and run it
again.]

**Do.** Supabase → production project → Authentication → Third-Party Auth →
the Clerk entry for `https://topical-redfish-40.clerk.accounts.dev` → remove
it. Read the domain twice. Removing `https://clerk.app.bis-rgv.com` instead
takes production down, and it fails quietly: every in-account page errors or
reads empty (`clerk-setup.md`, "The two failures that are silent").
[assumption: the Supabase Management API exposes the same list at
`GET /v1/projects/tlbkbmlrfafquucsmsmm/config/auth/third-party-auth`, with a
`DELETE` by entry id. The dashboard is the path this runbook relies on.]

**Verify.**

1. The check table's "After" row: 401 in the development tab, 200 in the
   production tab.
2. Production still works. Sign in at `app.bis-rgv.com` and open an
   in-account list, such as a client's Contacts. It returns rows
   (`clerk-setup.md` Part I, step 3). That list reads through
   `dbForRequest()`, so it is the one that fails if the wrong entry went. The
   agency accounts list reads through `serviceDb()` and would look fine either
   way. Part B's smoke `curl` is unchanged.
3. The next CI run on any branch is green on its head SHA. CI never used this
   entry, and this proves it.

**Roll back.** Add the provider back: Third-Party Auth → Add provider → Clerk
→ `https://topical-redfish-40.clerk.accounts.dev`. Take the value from
`curl -s https://topical-redfish-40.clerk.accounts.dev/.well-known/openid-configuration`,
field `issuer`, as `clerk-setup.md` Part E does. If the wrong entry was
removed, add `https://clerk.app.bis-rgv.com` back the same way, at once.

## Part E — rotate

### E1. The production credentials Preview held

Rotate only the rows that Part C step 3 recorded. Going by the 2026-10-06
read, expect:
- `VERCEL_API_TOKEN` (a shared row, so certainly);
- the Supabase secret key and the database password, if A1 or A4 showed
  production's, or could not tell;
- the production Clerk secret key, only if A3 printed `pk_live_` on a
  preview.

For each credential, make a new value at the provider and put it everywhere
the table below says. Then redeploy production, verify, and only then revoke
the old value. Never put the new value on Preview.

| Credential | Where to rotate | Where the new value goes |
|---|---|---|
| `VERCEL_API_TOKEN` | Vercel → Account → Tokens: a new `bis-platform-analytics` token (`website-setup.md` Part A) | Vercel Production only, Sensitive |
| Supabase secret key (`SUPABASE_SERVICE_ROLE_KEY`) | production → Settings → API Keys | Vercel Production; the repository secret `SUPABASE_SERVICE_ROLE_KEY` (`seed-demo.yml`, `screenshots.yml`). On danlo's machine, the D7 backups `apps/web/.env.local.prod-backup` and `packages/db/.env.prod-backup` hold the OLD value: delete them or leave them stale, never update them to the new one |
| Database password (only if Preview held production's `SUPABASE_DB_URL`) | production → Database → Settings → reset the password | the repository secret `SUPABASE_DB_URL`; Vercel Production only if the variable exists there (the app does not read it). The same note on the `*.prod-backup` files applies |
| `CLERK_SECRET_KEY` `sk_live_` (only if it was on Preview) | Clerk → production instance → API keys | Vercel Production only |
| `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` | Resend → API Keys; the webhook's signing secret [assumption: dashboard paths] | Vercel Production |
| `TELNYX_API_KEY` | Telnyx portal → API Keys | Vercel Production |
| `OPENAI_API_KEY`, `OPENAI_WEBHOOK_SECRET` | the "BIS Platform Voice" OpenAI project: API keys; Webhooks → the `realtime.call.incoming` endpoint | Vercel Production (`voice-setup.md`) |
| `DAILY_API_KEY` | Daily → Developers [assumption: dashboard path] | Vercel Production |
| `CRON_SECRET`, `FORM_TOKEN_SECRET` | any new long random string | Vercel Production |
| `OPS_HEALTH_SECRET` | any new random value | Vercel Production AND the repository secret `OPS_HEALTH_SECRET`, the same value (`.env.example`) |
| `CONSENT_TOKEN_SECRET` | 32 random bytes, base64url | Vercel Production. Move the old value to `CONSENT_TOKEN_SECRET_PREVIOUS` first, so links already sent keep working. It is one slot: never rotate twice within 30 days (`.env.example`) |
| `SOFIA_WEB_SECRET` | any new long random string | Vercel Production AND the bis-website project, byte-identical |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe → Developers → API keys; the `/api/webhooks/stripe` endpoint → roll its signing secret | Vercel Production (`stripe-billing.md`) |

The first four rows are the ones the 2026-10-06 read makes likely. The rest
were not on Preview then, and are listed in case A1 finds otherwise. `LEAD_INTAKE_SECRET`
was retired with the shared-secret intake route (#156). If A1 finds it
anywhere, delete it, from Production too, and from the bis-website project.
Nothing reads it, so there is nothing to rotate.

**Single-value secrets are an outage window.** Four of the credentials above
have one live value on each side: `OPENAI_WEBHOOK_SECRET`,
`RESEND_WEBHOOK_SECRET`, `STRIPE_WEBHOOK_SECRET` and `SOFIA_WEB_SECRET`. For
those, the time between the provider change and the production redeploy is
an outage for that path. Do them outside business hours, one at a time, with
the redeploy ready before the provider change.
- With `OPENAI_WEBHOOK_SECRET` stale, every inbound call is refused with 400
  (`apps/web/src/app/api/voice/incoming/route.ts:731-736`). [assumption: an
  OpenAI project can hold a second webhook endpoint for the same URL. If so,
  add the new endpoint, deploy its secret, then delete the old endpoint, and
  there is no window.]
- Stripe retries a refused event for up to three days, so the cost there is
  only delay.
- `SOFIA_WEB_SECRET` fails the website's "Talk to Sofía" until BOTH projects
  are redeployed.

**Rotating the Supabase secret key has three more effects.** While
`FORM_TOKEN_SECRET` is unset, the render-token key is derived from that key
(`apps/web/src/lib/forms/guards.ts:36-42`), and so is the voice fallback
ticket's key (`apps/web/src/lib/voice/fallback-ticket.ts:38`). Changing
the key therefore has these effects:
- Every render token issued before the redeploy becomes invalid. Tokens live
  30 minutes (`guards.ts:19`), and they fail silently. A form submitted from
  an old page is filed as spam behind a success message. A booking returns
  the same fake success and books nothing
  (`apps/web/src/app/b/[publicId]/actions.ts:222-236`). A website chat
  refuses to start
  (`apps/web/src/app/api/concierge/[publicId]/turn/route.ts:206-244`).
- The IP-hash rate-limit counts restart (`guards.ts:128-130`).
- A model-down fallback ticket minted in the 10 minutes before the redeploy
  stops verifying.

Rotate outside business hours. Which Supabase key to replace: only in A1's
case (b), with a prefix matching a key in A7's list that is not Production's,
delete that key, and you are done. In every other case, including "cannot
tell", treat the key as Production's. Create a new key and switch Production
to it (`sensitive`, Production only). Redeploy, verify the smoke and one
`ops-health.yml` run, then delete the old key. [assumption: Supabase lists
secret keys by name with a masked prefix, and a `sb_secret_` key can be
deleted without touching the others. A legacy `eyJ…` service-role key cannot
be rotated that way, because rotating the JWT secret also changes the anon
key. If Preview held a legacy key, move Production to a `sb_secret_` key
first, then disable the legacy keys.]

**Verify** each rotation where it is used:
- Part B's production smoke.
- One `ops-health.yml` run green (proves the cron and the database).
- For a Supabase or form-key change: one form submission and one booking from
  a freshly loaded page, on an account made for the purpose, never a live
  client's.
- For a voice or SMS credential: one test call or text.

Then confirm the old value is gone from the provider's list.

### E2. The development Clerk secret key

After Part D this key no longer reaches production. It still opens the
development instance and, through it, the CI project. It has sat in the
repository secret, on Preview and in local env files, so it is rotated too.

1. Clerk → the development instance (`topical-redfish-40`) → API keys →
   create a new secret key. [assumption: the instance allows a second secret
   key alongside the first. If it only offers to roll the key, the old one
   stops at once, so do step 2 immediately.]
2. Put the new key in these places:
   - The repository secret `CLERK_SECRET_KEY`: Remove, then add. Paste it
     straight into GitHub, never into a chat.
   - Vercel Preview's `CLERK_SECRET_KEY`: delete the Preview row, then
     `add CLERK_SECRET_KEY sensitive`.
   - Vercel's Development environment, if A1 found the key there.
   - The local `apps/web/.env.local` and `packages/db/.env` (the integration
     suite reads the key from the latter). That is owner work: no agent
     edits `.env*` files.
3. Push any branch and read `verify` and `e2e` for its head SHA. `e2e`
   creates and deletes a Clerk user with this key, so green proves that the
   key works.
4. Delete the old key in Clerk.

**Verify.** Step 3's two green checks; a sign-in on a new preview; and the
Clerk API keys page lists only the new key.

**Roll back.** There is nothing to undo while the old key still exists. After
it is deleted, a red run means that the new key is missing from somewhere
step 2 names.

## Part F — record

1. Change this file's status line to the date each part was done, or skipped
   with its reason. Do the same everywhere else that a dated "not confirmed
   done" stands:
   - the "Clerk it trusts" and "Vercel Preview" rows in
     `ci-supabase-project.md` ("Facts");
   - the production-isolation bullet in `CLAUDE.md`;
   - the superseded note in `clerk-setup.md` Part E;
   - the Vercel bullet in `.claude/agents/bis-platform.md`.

   `git grep -n -i "not confirmed done" -- CLAUDE.md docs/runbooks .claude/agents`
   lists them.
2. Ledger line: `ISOLATION DONE <date> — protection on, Preview on bis-ci,
   dev issuer off production, rotated: <names>`.

## What may live on Preview

The rule: **Preview may hold the development Clerk instance, the CI project,
and non-secret configuration. Nothing that opens a production system.**

| Class | Variables |
|---|---|
| CI project values | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (the `preview` key) |
| Development Clerk instance | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (`pk_test_`), `CLERK_SECRET_KEY` (`sk_test_`), `NEXT_PUBLIC_CLERK_SIGN_IN_URL` |
| Non-secret configuration, fine on Preview | `EMAIL_FROM`, `AGENCY_SUPPORT_EMAIL`, `VERCEL_TEAM_ID`, `VOICE_OPENAI_PROJECT_ID`, `TELNYX_PUBLIC_KEY` (a public key), `TELNYX_VOICE_CONNECTION_ID`, `SOFIA_WEB_ORIGINS`, `SOFIA_WEB_NUMBER`, `SOFIA_WEB_DISPLAY_NUMBER`, `REALTIME_MODEL`, every `PHONE_*` knob |
| **Never on Preview** (production credentials) | `SUPABASE_DB_URL` (any project; unused by the app), `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `TELNYX_API_KEY`, `OPENAI_API_KEY`, `OPENAI_WEBHOOK_SECRET`, `DAILY_API_KEY`, `VERCEL_API_TOKEN`, `CRON_SECRET`, `FORM_TOKEN_SECRET`, `OPS_HEALTH_SECRET`, `CONSENT_TOKEN_SECRET`, `CONSENT_TOKEN_SECRET_PREVIOUS`, `SOFIA_WEB_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and any webhook signing secret added later |
| Leave unset on Preview | `EMAIL_DEV_REDIRECT_TO`, `SMS_DEV_REDIRECT_TO`, `VOICE_FORWARD_TO`, `VOICE_FALLBACK_DRILL_TO`, `VOICE_FALLBACK_DRILL_FROM`: inert without the provider keys, and nothing on a preview should send or call. `APP_ORIGIN`: if it is set to production's domain, every link a preview builds points at production. Unset, most links derive from the preview's own host (the web voice session still falls back to `app.bis-rgv.com`, `apps/web/src/app/api/voice/web/session/route.ts:204`) |

Without the provider keys, a preview's sending, calling, billing and
site-traffic features report themselves unconfigured. That is the intended
state: Preview is for looking at screens.

## Not covered here

- **`screenshots.yml`** stops working at Part D. Moving it, and the demo seed
  it runs, onto the CI project is its own change.
- **Local development on another machine.** D7 is done on danlo's machine
  (`ci-supabase-project.md` section 9). Local tests refuse production
  everywhere. `pnpm dev` does not.
- **The repository secrets `NEXT_PUBLIC_SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_DB_URL`** still hold production's
  values for `seed-demo.yml` and `screenshots.yml`. A workflow run on any
  branch of this repository can read repository secrets [assumption:
  GitHub's behaviour for push-triggered workflows; forks do not receive
  them], so they are the same kind of path. `OPS_HEALTH_SECRET` is in the
  same place, but it opens only the health route. The usual fix is a GitHub
  Environment limited to `main`, with the two workflows declaring it. That
  is a separate change.
