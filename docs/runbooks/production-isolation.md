# Production isolation: Preview and the development Clerk issuer

**Status, 2026-10-07: DONE.** Parts A, B, C, D and E1 were done on
2026-10-07. The owner declined E2. Both paths described below are closed.
Every step below changes a setting in Vercel, Supabase or Clerk, and nothing
in this repository changes those settings. The parts stay written out for a
rebuild, an audit or a rollback.

- **Part A, executed 2026-10-07 by the orchestrator:**
  - `ssoProtection` was off, and previews answered 200 in public, carrying
    `pk_test_`.
  - Production served `pk_live_` only.
  - The code names no `vercel.app` webhook target.
  - There were no fork deployments.
- **Part B, executed 2026-10-07 by the orchestrator:**
  - `ssoProtection.deploymentType` is now `preview`, and `gitForkProtection`
    is `true`.
  - A preview's `/sign-in` now answers 302 to `vercel.com/sso-api`, while
    production answers 200.
  - `ops-health.yml` run 37647811804 was green afterwards.
- **Part C, done 2026-10-07:**
  - Preview's `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
    are now the CI project's.
  - Preview's `SUPABASE_SERVICE_ROLE_KEY` is a `bis-ci` secret key named
    `preview`.
  - Preview's `SUPABASE_DB_URL` was deleted.
  - `VERCEL_API_TOKEN` is on Production only.
  - Verified: a fresh preview read the CI project (the `bis-ci` edge log
    shows a request with a `sb_secret_` key, answered 200), and every
    Production row matched the baseline.
- **Part D, done 2026-10-07:**
  - Production Supabase's Third-Party Auth entry for
    `topical-redfish-40.clerk.accounts.dev` was removed, and
    `clerk.app.bis-rgv.com` was kept.
  - Production was verified working, with no runtime errors.
  - `screenshots.yml` is broken from this point, as Part D accepts, until it
    moves to the CI project. **Moved 2026-10-08 (#197):** it now captures on
    the CI project with the `CI_*` secrets and ci.yml's target guard, and
    reads no production secret.
- **Part E1, done 2026-10-07:**
  - The production Supabase secret key was rotated. The new key is in Vercel
    Production and the GitHub repository secret, and the old key was
    deleted. Verified by the edge logs, `ops-health.yml` and a booking page.
  - The production database password was reset. The GitHub repository
    secret `SUPABASE_DB_URL` was updated, and Vercel Production's
    `SUPABASE_DB_URL` was deleted, because the app never reads it.
  - `VERCEL_API_TOKEN` was rotated to a new team-scoped token, and the old
    one was deleted. Verified by the token's last-active time after the
    Settings page's project list loaded.
  - The D7 `*.prod-backup` files on danlo's machine now hold revoked values.
- **Part E2, declined by the owner on 2026-10-07.** After Part D, the
  development Clerk secret key reaches only the development instance and the
  CI project, so the stakes are low. It stays in the repository secret
  `CLERK_SECRET_KEY`, on Preview and in the local env files.

Before the work, the Vercel API on 2026-10-06 (names only, no values) listed
these on Preview: `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`SUPABASE_DB_URL`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`,
`NEXT_PUBLIC_CLERK_SIGN_IN_URL`, `VERCEL_TEAM_ID` and `VERCEL_API_TOKEN`. The
last two had Production ticked as well. The sections below describe the
state before the work, with the dates they were measured. When re-running
any part, its Skip line and Part A's checks say whether it is needed. Write
down a skip and its reason.

Who runs this: the owner (danlo), or an agent with Vercel API access, and
only with the owner's go-ahead for each part. Read the whole runbook before
starting, because the order matters. Keep the notes from Part A until Part F
is done: later parts, the rotations and the rollbacks all read them.

## The two paths (both closed 2026-10-07)

Both let a credential that is not production's reach production's client
data. What follows is the state before Parts C to E. Path 1 was closed by
Part D. Path 2 was closed by Parts B, C and E1.

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

**2. Vercel Preview may hold production credentials, and it had no
Deployment Protection until Part B on 2026-10-07.** On 2026-09-25, Preview's
Supabase values were recorded as naming production's project, in the M7a
billing spec
(`docs/superpowers/specs/2026-09-24-m7a-client-billing-design.md:73`; #140,
`5dac86ac`). That was true by construction before #133, when production's
project was the only one. Nobody has read the values since. Measured from
outside on 2026-09-26, and again in Part A on 2026-10-07: a preview
deployment answered `/sign-in` with 200 and no Vercel login, and its sign-in
page carried a `pk_test_` key, which is the development instance. `clerk-setup.md` Part G keeps Preview on the development Clerk pair.
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
| `screenshots.yml` | development (`CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`) | production (`NEXT_PUBLIC_SUPABASE_URL` and the other production repository secrets) | **Yes.** It signs in as the development agency user and reads the demo tenant through `dbForRequest()`. Broken since Part D (2026-10-07) until it moves |
| Local `pnpm check`, e2e, integration suite | development | refused on production since #135; danlo's machine on `bis-ci` since 2026-10-04 (D7) | **No** |
| Local `pnpm dev`, `pnpm start`, `pnpm --filter web screenshots` | development | whatever `apps/web/.env.local` names. On danlo's machine that has been `bis-ci` since D7. None of these commands has a production guard | **Only on a machine whose env still names production** |
| Vercel Preview | development (`pk_test_`, measured 2026-10-07) | `bis-ci` since Part C (2026-10-07) | **No**, since Part C |
| Vercel Production | production (`pk_live_` only, measured 2026-10-07 in A6) | production | **No** |

CI and e2e no longer need it. Since #133 they run on `bis-ci`, whose only
Third-Party Auth entry is the development instance (`ci-supabase-project.md`,
section 1 step 2). (Since 2026-10-08 both CI jobs run on a stack inside their
own runner instead; e2e's stack trusts the same development instance,
`ci-supabase-project.md` section 11. Neither needs the dev issuer on
production. The table above is the 2026-10-07 reading.) Nothing in CI fetches a Vercel URL: no workflow names
`vercel.app` or a preview, and Playwright starts its own server on
`localhost:3000` (`apps/web/playwright.config.ts`, `webServer`). The ruleset on
`main` requires only `verify` and `e2e`, not a Vercel check. Before the work,
two consumers still needed the dev issuer. Preview stopped needing it at Part
C. `screenshots.yml` still needs it, and Part D accepted it as broken until
it moves. It is a manual button, so moving it onto the CI project is a
separate change.

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
  without that login is redirected to a Vercel login (302 to
  `vercel.com/sso-api`, measured 2026-10-07).
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
# keep(): print only the named top-level fields of a JSON response. A create
# answers {created, failed}: each created row prints on its own line, each
# failure prints its error code only, and an empty or failed create exits 1.
keep() { node -e '
  let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
    let j; try { j = JSON.parse(s) } catch { console.error("response was not JSON; nothing printed"); process.exit(1) }
    if (j === null || typeof j !== "object") { console.error("unexpected response; nothing printed"); process.exit(1) }
    if (j.error) { console.error("API error:", j.error.code ?? "unknown"); process.exit(1) }
    const pick = o => Object.fromEntries(process.argv.slice(1).map(k => [k, o?.[k] ?? null]));
    const rows = "created" in j ? [].concat(j.created ?? []) : [j];
    for (const o of rows) console.log(JSON.stringify(pick(o)));
    const failed = [].concat(j.failed ?? []);
    for (const f of failed) console.error("failed:", f?.error?.code ?? "unknown", f?.error?.key ?? "");
    if (failed.length || rows.length === 0) { if (!failed.length) console.error("nothing created"); process.exit(1) }
  })' "$@"; }
# envs(): one line per env row: KEY, targets, type, id, branch. Never a value.
envs() { api "$V/v10/projects/$P/env?teamId=$T" | node -e '
  let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
    let j; try { j = JSON.parse(s) } catch { console.error("response was not JSON; nothing printed"); process.exit(1) }
    if (j?.error) { console.error("API error:", j.error.code ?? "unknown"); process.exit(1) }
    for (const e of j?.envs ?? []) console.log([e.key, [].concat(e.target ?? []).sort().join("+"), e.type, e.id, e.gitBranch ?? ""].join("\t"));
  })'; }
# row ID: re-read one row's KEY, targets, type and id, from the LIST. Never
# use GET /v1/projects/.../env/<id>: that endpoint returns the decrypted value.
row() { envs | awk -F'\t' -v id="$1" '$4 == id'; }
```

A1 saves the full `envs` listing as the baseline. It holds names, targets,
types and ids, never a value. Keep it outside the repository anyway; it is a
map of where the secrets live.

[assumption: the endpoint versions, the deployments list's `target` filter
and the field names (`envs[].target`, `type`, `id`; the project's
`ssoProtection`, `gitForkProtection`) are as Vercel's REST documentation
describes them. If one answers 404 or a field reads `null`
where a value is expected, use the dashboard path given beside each step.]

## Part A — pre-flight (read only; keep the notes)

**Done 2026-10-07** (see the status block). On a re-run, take A1 (the
baseline), A4, A5 and A7 immediately before Part C, because Part C changes
what they read.

1. **Env rows, saved as the baseline.**

   ```bash
   B="$HOME/isolation-baseline-$(date +%F).tsv"
   envs | sort > "$B"; wc -l < "$B"; cat "$B"
   ```

   The file holds every row: key, targets, type, id and branch, never a
   value. Part C checks each change against it, and Part C's Verify compares
   every row whose targets include `production` against it. Dashboard
   equivalent: bis-platform → Settings → Environment Variables, but the
   dashboard cannot save a baseline, so Part C's comparison would then be by
   eye. Compare the Preview rows with the 2026-10-06 list in the status
   block. A name that has appeared since then is checked against "What may
   live on Preview" below.

   Every row with `preview` in its targets is one of two cases. The case is
   decided by the targets alone:
   - **(a) includes `production`.** One value is used in both, so Preview
     holds Production's value. That is proved without reading it.
   - **(b) includes `preview` but not `production`.** This is a separate
     value. It may also include `development`: a `development+preview` row
     belongs to this case. Deleting such a row also removes it from
     Development, so Part C drops `preview` from that row's targets instead
     of deleting it.

   For `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_DB_URL`, also note what can
   be learned about a case (b) value. Part C deletes the evidence, and Part E
   needs it:
   - (b1) a row that is not Sensitive, whose value the owner can reveal in
     the dashboard. Note the first 14 characters of the key (`sb_secret_`
     plus four), or the project ref inside the DB URL, nothing more. An agent
     does not reveal values; it records "(b1), unread".
   - (b2) a Sensitive row, whose value cannot be read back.
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
   | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch{console.error("not JSON; nothing printed");process.exit(1)}if(j?.error){console.error("API error:",j.error.code??"unknown");process.exit(1)}for(const d of j?.deployments??[])console.log(d.url,d.state??d.readyState,new Date(d.created).toISOString(),d.meta?.githubCommitRef??"")})'
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
8. **Where the providers' webhooks point, and `APP_ORIGIN`.** This step is
   needed only if Part B ends up on Standard Protection, which also covers
   production's generated `*.vercel.app` URLs. Each provider must name
   `https://app.bis-rgv.com/...`:
   - OpenAI (the `realtime.call.incoming` endpoint) and Telnyx (the TeXML
     app and the messaging profile), as `voice-setup.md` and
     `a2p-registration.md` set them up;
   - Stripe, as `stripe-billing.md` sets it up;
   - Resend, whose webhook was registered during M1b (2026-07-29,
     `docs/superpowers/plans/2026-07-29-m1b-messaging.md`) and is not in any
     runbook, so read its URL in Resend's dashboard.

   The original voice plan used `bis-platform-six.vercel.app`
   (`docs/superpowers/plans/2026-08-24-voice-core.md:2614-2616`), so any
   endpoint still on that host would be blocked. Move it to
   `app.bis-rgv.com` before Part B.

   Also confirm, by name in A1's baseline, that `APP_ORIGIN` has `production`
   in its targets. Without it, these fall back to the deployment's own
   `vercel.app` origin, which Standard Protection blocks:
   - the TeXML `<Dial action>` and status callbacks Telnyx calls back on
     (`apps/web/src/app/api/voice/texml/route.ts:541-543`);
   - the cron's links (`apps/web/src/app/api/cron/reminders/route.ts:54`);
   - the voice webhook's email links
     (`apps/web/src/app/api/voice/incoming/route.ts:999`).

   With either check failing, use only "Only Preview Deployments".

## Part B — Deployment Protection for Preview

**Done 2026-10-07** (see the status block). Kept for a rebuild or a
rollback.

**Skip if** A2 already shows `ssoProtection.deploymentType` of `preview`,
`prod_deployment_urls_and_all_previews` or `all_except_custom_domains`
[assumption: the last is the API's name for a scope covering every
deployment URL except custom domains; treat it like Standard Protection and
do A8], and A3's preview answered 401 or redirected to a Vercel login.

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
also confirm, in Vercel's runtime logs, that each provider A8 covered has
landed a request since the change and was not answered 401:
- OpenAI on `/api/voice/incoming`;
- Telnyx on `/api/voice/texml` (and its `<Dial action>` callbacks under
  `/api/voice/texml/`) and on `/api/sms/inbound`;
- Resend on `/api/webhooks/resend`;
- Stripe on `/api/webhooks/stripe`.

A provider that has sent nothing since the change is not yet verified. Say
so in the notes rather than counting it as passed.

**Roll back.**

```bash
printf '%s' '{"ssoProtection":null}' | api -X PATCH -H 'content-type: application/json' --data-binary @- "$V/v9/projects/$P?teamId=$T" | keep ssoProtection
```

[assumption: the change applies at once, without a redeploy; the Verify
`curl` shows which.]

## Part C — Preview onto the CI project, and no production credential on Preview

**Done 2026-10-07** (see the status block).

**Skipping step 4.** Step 4 adds Preview's CI values. It is not needed if A1
shows `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
`SUPABASE_SERVICE_ROLE_KEY` as case (b) and A4 shows only CI accounts.
**Never skip these:**
- taking `SUPABASE_DB_URL` off Preview and recording its case. A4 cannot see
  it, because the app never reads it, so only A1's targets say what it was;
- the rest of steps 2 and 3, for every other name that does not belong on
  Preview.

**Before every PATCH or DELETE below,** re-read the row and compare it with
its baseline line:

```bash
row <id>; grep -F "<id>" "$B"
```

The two lines must name the same key and the same targets, and that key must
be the one you mean to change. If anything differs, STOP. A mis-copied id
changes some other variable, and a DELETE cannot be undone from the notes.

The CI project (`bis-ci`, ref `odnobiodsftffphuuosz`) already exists. It is
kept in parity with production (`ci-supabase-project.md` section 5), and it
already trusts the development Clerk instance, which is what Preview signs
in with. A separate staging project would work the same way. It would cost a
second project, and a third apply for every migration. Use the CI project
unless that changes.

1. **Supabase → `bis-ci` → Settings → API Keys →** create a secret key named
   `preview`. Give Preview a key of its own, not the `ci` key, so that either
   can be revoked without breaking the other.
2. **Rows that must leave Preview but have another target: drop `preview`
   from their targets.** Production, and Development, keep their value. This
   covers every case (a) row that must leave Preview, and every case (b) row
   that also targets `development`. The names that must leave Preview are:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
     `SUPABASE_SERVICE_ROLE_KEY`, unless step 4 is skipped;
   - `SUPABASE_DB_URL` and `VERCEL_API_TOKEN`, always;
   - the Clerk pair, if A3 printed `pk_live_`;
   - every name in "Never on Preview" and "Leave unset on Preview" below
     (for example `APP_ORIGIN`).

   Send the row's baseline targets minus `preview`:

   ```bash
   printf '%s' '{"target":["production"]}' \
   | api -X PATCH -H 'content-type: application/json' --data-binary @- "$V/v9/projects/$P/env/<id>?teamId=$T" \
   | keep key target type
   ```

   For a `development+preview+production` row, the body is
   `["development","production"]`; for `development+preview`, it is
   `["development"]`.
   [assumption: a PATCH may carry `target` without `value`, Sensitive rows
   included. If it refuses, first add a row with the same value and the
   remaining targets, then delete the old one, so that Production is never
   without it. Only the owner can do that, because it needs the value.]
   `VERCEL_TEAM_ID` may stay shared: it is an id, not a credential.
3. **Rows whose targets are exactly `preview`: delete them,** for the same
   list of names as step 2.

   ```bash
   api -X DELETE "$V/v9/projects/$P/env/<id>?teamId=$T" | keep key target
   ```

   Never DELETE a row whose targets include anything besides `preview`:
   that removes it from Production or Development too. Use step 2 for it.
   `SUPABASE_DB_URL` leaves Preview whatever it names: no running code reads
   it, only the test suites and the CI tools do.

   Write down which rows held production values:
   - every case (a) row;
   - a case (b1) row the owner revealed as production's;
   - a case (b1) or (b2) row that cannot be told apart. Part E treats
     "cannot tell" as production's.

   Part E rotates exactly those.
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

- **No row was lost from Production or Development.** Compare every name
  that had a `production` (then `development`) row in the baseline against
  the listing now:

  ```bash
  envs | sort > "$B.after"
  lost() { awk -F'\t' -v t="$1" '
    function has(s) { return ("+" s "+") ~ ("\\+" t "\\+") }
    NR == FNR { if (has($2)) { want[$1] = 1; id[$4] = $1 } ; next }
    has($2) { have[$1] = 1; still[$4] = 1 }
    END {
      for (k in want) if (!(k in have)) { print "LOST from " t ": " k; bad = 1 }
      for (i in id) if (!(i in still)) print "note: " t " row " id[i] " (" i ") changed id"
      exit bad }' "$B" "$B.after"; }
  lost production && lost development && echo "baseline Production and Development names all still present"
  ```

  Any `LOST` line is a variable that a mis-copied id took away. Restore it
  before the next push to main, because a lost Production row breaks nothing
  until the next production build. A `changed id` note is expected only
  where step 2's add-then-delete fallback was used.
- `awk -F'\t' '("+" $2 "+") ~ /\+preview\+/' "$B.after"` lists the rows
  that are still on Preview. Every one of them is in the first three rows of "What may
  live on Preview" below, and none is in "Never on Preview" or "Leave unset
  on Preview". The three Supabase rows and `CLERK_SECRET_KEY` are `preview`
  only, and no `SUPABASE_DB_URL` row has `preview`.
- On the new preview, sign in and open `/dashboard/accounts`. It lists Test
  Client One and any e2e fixture accounts, and none of the real clients'
  accounts. It has no row named Bespoke Intelligent Solutions, a production
  account that the CI seed never creates. (The same words appear in the app's
  own tagline, which is not an account row.) That list reads through
  `serviceDb()`, so it proves the URL and the secret key. Then open Test
  Client One → Contacts: Maria Garcia is listed (the CI seed's contact). That
  page reads through `dbForRequest()`, so it proves the publishable key and
  the CI project's trust of the development instance.

**While Preview is on the CI project,** it shares Test Client One with local
e2e runs on danlo's machine and with the screenshot capture. (CI's own e2e
seeds its own copy in a per-run stack since 2026-10-08,
`ci-supabase-project.md` section 11, so it no longer shares this one.)
Browse freely. Mutate only an account you create yourself, never Test
Client One (the same rule `CLAUDE.md` sets for specs), and check
`gh run list --workflow screenshots.yml --status in_progress` first. The CI
project is disposable (`ci-supabase-project.md` section 8): a rebuild drops
anything created from a preview.

**Roll back.** PATCH the step-2 rows back to their targets in the baseline
file, delete the step-4 rows, and build a new preview. Rows deleted in step 3
cannot be restored from the baseline, because it holds no values. Rolling back re-opens path 2, so treat it
as a stopgap.

## Part D — remove the development Clerk provider from production Supabase

**Done 2026-10-07** (see the status block).

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
`curl` straight after minting the token. Hand the token over through a
variable read with `read -rs`. Never paste the token into a chat or a log:
until it expires, it is a working session.

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

**Done 2026-10-07:** the Supabase secret key, the database password and
`VERCEL_API_TOKEN` (see the status block).

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

**Single-value secrets are an outage window.** Six of the credentials above
have one live value on each side: `OPENAI_WEBHOOK_SECRET`,
`RESEND_WEBHOOK_SECRET`, `STRIPE_WEBHOOK_SECRET`, `SOFIA_WEB_SECRET`,
`CRON_SECRET` and `OPS_HEALTH_SECRET`. For those, the time between the
change on the other side and the production redeploy is an outage for that
path. Do them outside business hours, one at a time, with the redeploy ready
before the change.
- With `OPENAI_WEBHOOK_SECRET` stale, every inbound call is refused with 400
  (`apps/web/src/app/api/voice/incoming/route.ts:731-736`). [assumption: an
  OpenAI project can hold a second webhook endpoint for the same URL. If so,
  add the new endpoint, deploy its secret, then delete the old endpoint, and
  there is no window.]
- Stripe retries a refused event for up to three days, so the cost there is
  only delay.
- `SOFIA_WEB_SECRET` fails the website's "Talk to Sofía" until BOTH projects
  are redeployed.
- With `CRON_SECRET` mismatched, `/api/cron/reminders` answers 401 and that
  tick's passes do not run. The next tick, 15 minutes later, recovers once
  both sides agree. [assumption: Vercel's cron sends the project's current
  `CRON_SECRET`, which can differ from the one the running deployment checks
  until the redeploy.]
- With `OPS_HEALTH_SECRET` mismatched, the hourly `ops-health.yml` run goes
  red with a 401. Nothing breaks for clients, but the alarm is wrong. Update
  the repository secret straight after the redeploy, then run
  `gh workflow run ops-health.yml`.

**Rotating the Supabase secret key has three more effects.** Two keys are
derived from it:
- The render-token key is derived from it while `FORM_TOKEN_SECRET` is unset
  (`apps/web/src/lib/forms/guards.ts:36-42`).
- The voice fallback ticket's key is ALWAYS derived from it, with no override
  (`apps/web/src/lib/voice/fallback-ticket.ts:37-40`).

Changing the Supabase secret key therefore has these effects:
- Unless `FORM_TOKEN_SECRET` is set, every render token issued before the
  redeploy becomes invalid. Tokens live
  30 minutes (`guards.ts:19`), and they fail silently. A form submitted from
  an old page is filed as spam behind a success message. A booking returns
  the same fake success and books nothing
  (`apps/web/src/app/b/[publicId]/actions.ts:222-236`). A website chat
  refuses to start
  (`apps/web/src/app/api/concierge/[publicId]/turn/route.ts:206-244`).
- Unless `FORM_TOKEN_SECRET` is set, the IP-hash rate-limit counts restart
  (`guards.ts:128-130`).
- Always: a model-down fallback ticket minted in the 10 minutes before the
  redeploy stops verifying (`fallback-ticket.ts:35`).

Rotate outside business hours. Which Supabase key to replace: only in A1's
case (b1), with a prefix matching a key in A7's list that is not
Production's, delete that key, and you are done. In every other case, including "cannot
tell", treat the key as Production's. Create a new key and switch Production
to it (`sensitive`, Production only). Redeploy, verify the smoke and one
`ops-health.yml` run. Reload every tab that was open before the redeploy, or
wait for those tabs to close (see "Old tabs" below), and only then delete
the old key. [assumption: Supabase lists
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
- For `VERCEL_API_TOKEN`: on the redeployed production, open the Website
  page of an account with a linked site. It still shows visitor numbers. If
  instead it shows no projects, the new token is missing or lacks the team
  scope (`website-setup.md` Part A). Check this BEFORE revoking the old
  token.

Only after every check passes, revoke the old value. Then confirm it is gone
from the provider's list.

**Old tabs keep the old build (learned 2026-10-07).** Vercel's skew
protection pins a tab that was already open to the deployment it loaded
from. That previous build still carries the OLD key. So after the old
Supabase key is deleted, every tab opened before the redeploy fails, with
"Unregistered API key", until it is reloaded. New tabs and reloaded tabs are
fine. Before deleting an old key, reload the tabs you have open, or wait,
and expect a client's long-open tab to need one reload.

### E2. The development Clerk secret key

**Declined by the owner on 2026-10-07.** After Part D, this key reaches only
the development instance and the CI project, so the stakes are low. The steps
below stay here for whenever it is rotated.

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
   - Vercel Preview's `CLERK_SECRET_KEY`: re-read the row with `row <id>`
     as Part C requires, delete it only if its targets are exactly
     `preview`, then `add CLERK_SECRET_KEY sensitive`.
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

**Done 2026-10-07.** The status lines in these places were flipped to DONE:
- this file;
- the "Clerk it trusts" and "Vercel Preview" rows in
  `ci-supabase-project.md` ("Facts");
- the production-isolation bullet in `CLAUDE.md`;
- the superseded note in `clerk-setup.md` Part E;
- the Vercel bullet in `.claude/agents/bis-platform.md`.

On a future re-run, mark the same places "not confirmed done" while the work
is open, and flip them back when it is done.

1. Change each status line to the date each part was done, or skipped with
   its reason.
2. Ledger line: `ISOLATION DONE <date> — protection on, Preview on bis-ci,
   dev issuer off production, rotated: <names>`. For 2026-10-07 the names
   are: the Supabase secret key, the database password and
   `VERCEL_API_TOKEN`. E2 was declined.

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

- **`screenshots.yml`** has not worked since Part D (2026-10-07). Moving it, and the demo seed
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
