# The CI Supabase project (`bis-ci`)

CI does not run on production's database. Both CI jobs (`verify` and `e2e` in
`.github/workflows/ci.yml`) create and delete rows, and e2e creates Clerk
users, so since 2026-09-24 they ran on a separate project that exists only
for tests. **Since 2026-10-08 neither does:** each starts a throwaway
Supabase stack inside its own runner (section 11), so neither shares a
database with any other run or waits in a repo-wide queue, and e2e starts
beside verify instead of after it. What CI still does with this project is
READ it, once per e2e run: the check that it holds every migration of the
branch (section 6). Vercel Preview and the demo screenshot capture
(`screenshots.yml`) still run on it, and so do local runs on danlo's machine
(section 9). This runbook covers creating the CI project, bringing its schema
up to date, seeding it, checking it matches production, restoring it after a
pause, rebuilding it from nothing, and the jobs' local stacks.

Audience: danlo (dashboard steps) and the orchestrator (workflow dispatches,
MCP reads of production).

## Facts

| | CI project | Production |
|---|---|---|
| Name / org | `bis-ci`, moved into the paid organization (owner, 2026-10-08; it began in the Free organization `bis-ci`, and the move kept its ref and URL) | the paid organization |
| Ref | `odnobiodsftffphuuosz` | `tlbkbmlrfafquucsmsmm` |
| Region | us-east-1 (same as production, so runner latency matches) | us-east-1 |
| Schema from | `supabase db push` of the migration files (`db:push:ci`) | the Supabase MCP `apply_migration`, one file at a time |
| Clerk it trusts | the **development** instance, `topical-redfish-40.clerk.accounts.dev` | production's instance only. **DONE 2026-10-07:** the development entry was removed (`production-isolation.md` Part D) |
| Vercel Preview | the target: Preview's three runtime Supabase values name this project, with a secret key of its own named `preview`, and `SUPABASE_DB_URL` is not on Preview at all (`production-isolation.md` Part C) | never. **DONE 2026-10-07:** Preview's URL and publishable key are this project's, its secret key is this project's `preview` key, and its `SUPABASE_DB_URL` was deleted (`production-isolation.md` Part C) |
| URL, ref | literals in `screenshots.yml` and `ci-project-setup.yml`; the ref alone in `ci.yml`, in the e2e migration check step's own env | Vercel Production |
| Publishable key | a literal in `screenshots.yml` (`ci.yml` and `ci-project-setup.yml` do not use it) | Vercel Production |
| Secret key, DB URL | repository secrets `CI_SUPABASE_SECRET_KEY` (read by `screenshots.yml` and `ci-project-setup.yml`'s `seed` step; never by `ci.yml` since 2026-10-08), `CI_SUPABASE_DB_URL` (also by `ci.yml`, in the e2e migration check step only, as `BIS_CI_SUPABASE_DB_URL`) | Vercel Production (the secret key only; its `SUPABASE_DB_URL` was deleted on 2026-10-07, since the app never reads it); repository secrets `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL` (read only by `seed-demo.yml`, which refreshes the demo tenant production keeps for live demos; `screenshots.yml` has captured on THIS project since 2026-10-08, #197); any local env file not yet switched (section 9). The `*.prod-backup` copies section 9 kept on danlo's machine hold the values revoked on 2026-10-07 (`production-isolation.md` Part E1) |

Never edit the three non-`CI_` secrets to point at the CI project. The demo
seeder (`seed-demo.yml`) would then "succeed" against the wrong database.

`CI_SUPABASE_DB_URL` is always the **Session pooler** URI (Supabase dashboard >
Connect > Session pooler; host `aws-0-us-east-1.pooler.supabase.com:5432`,
user `postgres.odnobiodsftffphuuosz`). The direct `db.<ref>.supabase.co` host
is IPv6-only, and GitHub's runners have no IPv6.

### What protects production

In CI, and in the CI-only tools, a check names the CI project by
`BIS_CI_SUPABASE_REF` and refuses anything else before anything connects:

- `.github/scripts/ci-target-guard.sh`. With no argument (what
  `screenshots.yml` runs on this project) it refuses production's ref
  anywhere, an API URL that is not exactly `https://<ref>.supabase.co`, a DB
  URL whose user is not `postgres.<ref>`, a `pk_live_`/`sk_live_` Clerk key,
  and a secret key that does not open the project's REST API. In BOTH CI
  jobs it runs twice instead (section 11): `--before-local-stack` refuses
  any Supabase value at all before the job's stack exists, and
  `--local-stack` refuses an API or DB URL that is not on the runner's
  loopback; both refuse the migration check's `BIS_CI_SUPABASE_REF` and
  `BIS_CI_SUPABASE_DB_URL` anywhere in job scope. Tested by
  `apps/web/ci/ci-target-guard.test.ts`.
- `.github/scripts/ci-migrations-applied.sh` (e2e's read of this project):
  refuses production's ref anywhere, and any DB URL that is not
  `postgres.<ref>` on a `*.pooler.supabase.com` host, before psql sees it,
  then reads in one read-only transaction sent as one command (safe through
  the 6543 transaction pooler too).
- `packages/db/src/ci/target.ts` (`assertCiTarget`), inside `db:push:ci`,
  `db:migrations:ci`, `ci:sql` and `ci:seed`: a narrower check of the ref, the
  API URL and the DB URL only (refuses production's ref, a URL or DB user for
  any other project). No Clerk check and no REST probe. Its sibling
  `assertLocalStackTarget` is the whole check for `ci:seed:local` (e2e's
  seed of its own stack): the runner's loopback, and nothing else.
- `apps/web/ci/ci-workflow.test.ts`: fails `pnpm check` if `ci.yml` ever reads a
  production secret, drops or weakens a guard step, gives either job a cloud
  Supabase value, reads `CI_SUPABASE_DB_URL` anywhere but the migration check
  step, or names a different project from `ci-project-setup.yml`.

**Local runs refuse production too (since #135).** Every live local entry
point checks the same env before connecting and throws, naming the variable
(never its value), when any Supabase/PG* value names production's ref:

- `packages/db`: the db suite's global setup (`src/test/global-setup.ts`,
  before any sweep, fixture or connection) and the integration suite's own
  guard-only global setup (`vitest.integration.config.ts`).
- `apps/web` e2e: `playwright.config.ts` (the one place `--no-deps` and
  `--project=teardown` cannot skip it), `e2e/auth.setup.ts` and
  `e2e/sweep.setup.ts`.
- `apps/web` unit: the two tests that load `.env.local` and write through
  the real `serviceDb` (call proposals, returning lead), plus a scan that
  fails `pnpm check` if a live test ever skips the guard.

A local `pnpm check` or e2e run on a machine whose `apps/web/.env.local` or
`packages/db/.env` still points at production is refused, not run; switching
both files to the CI project (section 9) is what lets it run.

### How the steps are run

Every step below that touches the CI project is a dispatch of the setup
workflow, one step at a time, reading each result before starting the next:

```
gh workflow run ci-project-setup.yml --ref main -f step=<step>
```

Steps: `bootstrap`, `push-dry-run`, `push`, `migrations`, `fingerprint`,
`fingerprint-detail`, `migration-history`, `seed`. Only `bootstrap`, `push` and
`seed` write. The three SQL reads upload their rows as an artifact
(`ci-project-<step>`), so a fingerprint can be diffed as a plain file.

The same commands run from a machine whose `packages/db/.env` holds the CI
project's values and `BIS_CI_SUPABASE_REF=odnobiodsftffphuuosz`, e.g.
`pnpm --filter @bis/db db:push:ci --dry-run`. The workflow exists so this never
depends on the laptop that holds the credentials.

## 1. Create (danlo, dashboard)

1. Supabase: a **Free** organization (a paid organization cannot hold free
   projects), and in it a project in **us-east-1** with a database password of
   **letters and digits only** (the password travels inside a URI).
2. The new project > Authentication > Third-Party Auth > add **Clerk** with
   the **development** instance domain `topical-redfish-40.clerk.accounts.dev`.
   Not the production domain. Without it, every in-account page is empty or
   500s, because `userDb()` hands Supabase a Clerk token it does not trust.
3. API keys: create a secret key named `ci`. Connect > Session pooler: copy the
   URI.
4. GitHub > Settings > Secrets and variables > Actions: put the key in
   `CI_SUPABASE_SECRET_KEY` and the URI in `CI_SUPABASE_DB_URL` (Remove, then
   add, if they already exist). Paste them straight into GitHub, never into a
   chat.
5. Hand the orchestrator the project ref and the project's **publishable** key
   (API keys page; `sb_publishable_…`, not a secret).
6. Optional: if production has Supabase Auth sign-ups disabled, disable them
   here too. Parity, not invention.

## 2. Bootstrap (before the first push, never after)

`-f step=bootstrap` runs `packages/db/supabase/bootstrap/ci-project.sql`. It
does two things production got by hand or by age:

- **Default privileges equal to production's.** Migrations 0001–0017 (and
  0033) create tables without a single GRANT. Production works only because it
  was created under Supabase's older defaults, which granted every new table to
  `anon`, `authenticated` and `service_role`. A project created today does not,
  and grants attach when a table is CREATED, so this must run before the push.
  Skipping it shows up later as "permission denied" everywhere, or as the
  guard's 403.
- **The `brand-logos` bucket**, public, 512 KiB, png/jpeg/webp: production's
  settings. No migration creates it; the db suite uploads to it live.

Then `-f step=fingerprint-detail` and compare its `default_acl` and `bucket`
rows with production's (section 5). If Supabase refused the bucket insert,
create it in the dashboard with the settings above and re-run the bootstrap
without that statement.

## 3. Push the migrations

1. `-f step=push-dry-run`. It must list exactly the migration files on the ref
   you dispatched, and nothing else. Stop if it lists fewer or skips a file.
2. `-f step=push`. Applies them in one run and records each in
   `supabase_migrations.schema_migrations`.
3. `-f step=migrations`. Every file shows as applied on both sides.

The CLI sends each file's bytes as written, so the migrations with backslash
escapes (0019, 0033–0037, 0048) arrive exactly as the repo holds them. This is
the class of error the MCP path got wrong on production's 0048.

## 4. Seed

`-f step=seed` runs `pnpm --filter @bis/db ci:seed`: the account every e2e run
shares, **Test Client One** (the development Clerk instance's org
`org_3H2aweJ6b2GRZghk3DCrNDmrMXU`), its contact Maria Garcia, the "Sales"
pipeline with the "Deck build" card, the `referral_source` field and one inert
number (`+12105550100`). It adds only what is missing, never updates or
deletes, then verifies every row the suites assume and fails naming what is
absent.

Since 2026-10-08 the `e2e` job no longer seeds this project: it seeds the
stack in its own runner with `ci:seed:local` (the same baseline, the same
verification, refused anywhere but the runner's loopback), so this project's
seed is for Vercel Preview and local runs on danlo's machine, and is
re-made only by this step. Run it after a rebuild (section 8), or when a
local run fails naming `ci:seed`.

Test Client One is still read-only for specs: on this project it is shared
by every local run and by Preview, and mutating specs belong on the per-run
fixture account.

## 5. Parity with production

Run the same read on both projects and diff:

- CI: `-f step=fingerprint` (and `migration-history`), from the artifact.
- Production: the orchestrator pastes `packages/db/supabase/parity/fingerprint.sql`
  (and `migration-history.sql`) into the Supabase MCP `execute_sql` on
  `tlbkbmlrfafquucsmsmm`. Read only.

A kind whose digest differs is drilled into with `fingerprint-detail.sql` on
both sides.

**Allowed differences** (first parity run, 2026-09-24): `extension_version(info)`,
and three cosmetic differences on production's side in the `column` and
`function` kinds, each an artefact of how the MCP applied a file rather than a
difference in what the database does: `public.contacts.email_key`'s generation
expression stores a raw non-breaking space where the file has the regex escape;
`app.current_account_id()`'s body is re-indented; `public.concierge_enable(...)`
lacks 0045's three-line comment. They stay allowed until production is
re-aligned from the files (optional). **Anything else is a finding:**
either production drifted from the files (a new migration records the truth) or
an apply went wrong. The CI project, pushed byte for byte from the files, is the
reference for what the files say.

## 6. Every new migration, from now on

CI first, then production.

1. bis-db-schema writes `NNNN_*.sql` and its tests, as always.
2. On the migration's branch, with main merged in: `-f step=push-dry-run`
   dispatched with `--ref <branch>` must list exactly the one new file; then
   `-f step=push` on the same ref.
3. Post-apply checks of the new objects on the CI project (`ci:sql` with a
   read-only file); for a constraint or function with a backslash escape, the
   md5 of its stored definition against the file's.
4. The branch's CI green on its head SHA (both jobs, read from the check runs).
5. Production: the existing MCP procedure (pre-flight read by `name`,
   `apply_migration`, post-apply verification, md5 compare for anything with a
   backslash escape).
6. Parity (section 5).
7. Ledger: `NNNN APPLIED — CI odnobiodsftffphuuosz (db push) <date> — PROD tlbkbmlrfafquucsmsmm (MCP) <date> — NEVER RE-APPLY`.
8. Merge.

Append-only applies here too: a migration changed after its CI push is a new
migration, not a re-push. Push to CI only when the branch is otherwise ready:
Vercel Preview and local runs on danlo's machine run on this project, so a
pushed migration is live for them at once. (No CI gate runs on it since
2026-10-08, so a push here no longer changes another branch's CI result.)

What changed on 2026-10-08: `verify` (the db suite, including every
grant-pinning test) builds its own database from the branch's migration
files on every run (section 11), so it tests a new migration before step 2,
and a migration pushed to the CI project no longer turns other branches'
`verify` red.

**What enforces step 2 now.** Until that date, skipping step 2 turned
`verify` red, because its db suite ran here. Neither job runs here any more,
so the `e2e` job carries the gate, as a step of a required check: "Check
that the CI project has every migration in this branch"
(`.github/scripts/ci-migrations-applied.sh`), the first step after the
docs-only decision. It compares every
`packages/db/supabase/migrations/<version>_<name>.sql` in the branch with this
project's `supabase_migrations.schema_migrations` by version, and fails
naming each file that is missing, with this section as the fix. A version
this project holds that the branch lacks (another branch pushed first) is
reported as a notice, never a failure. It is the ONLY place `ci.yml` reads
this project: `BIS_CI_SUPABASE_REF` and `BIS_CI_SUPABASE_DB_URL` (from
`CI_SUPABASE_DB_URL`) are set on that step alone, the script checks the URL
is this project's Session pooler user before psql sees it, and it reads in
one read-only transaction sent as one command. It does not check production (e2e holds no production
credential, and must not): steps 5 and 6 are still the orchestrator's.

## 7. Restore from a pause

**Applies only while the project sits in a Free organization.** Since
2026-10-08 it is in the paid one, where projects do not pause. Kept for the
day it moves back. Free projects pause after about a week without traffic
[assumption: Supabase's published Free-plan behaviour]. Every CI push is traffic, so this bites only
after a quiet week. Since 2026-10-08 the symptom in CI is the e2e job's step
"Check that the CI project has every migration in this branch" failing with
"Could not read the CI project's migration history" (psql's own message
above it); `screenshots.yml`'s guard says "the project is paused". Nothing
else in CI touches the CI project, so the rest of e2e and all of verify
would pass through a pause.

1. Supabase dashboard > project `bis-ci` > **Restore project**. Wait until it
   reports healthy.
2. Re-run the failed CI run from the Actions tab.
3. If the guard now answers **404** (no `agencies` table) the schema did not
   survive: rebuild (section 8). If it answers **403**, the grants are missing:
   re-run the bootstrap, then compare `default_acl` (section 2).

A project paused for too long cannot be restored [assumption: about 90 days].
Then rebuild.

## 8. Rebuild from scratch

The project is disposable: nothing in it is kept, and every row is made by the
steps above. A lost project is about half an hour.

1. Section 1, a new project. It gets a new ref.
2. If the ref changed, one PR changes it everywhere it is a literal:
   - `.github/workflows/ci.yml`, the e2e migration check step's env:
     `BIS_CI_SUPABASE_REF`;
   - `.github/workflows/ci-project-setup.yml` env: `BIS_CI_SUPABASE_REF`,
     `NEXT_PUBLIC_SUPABASE_URL`;
   - `.github/workflows/screenshots.yml`'s capture job env:
     `BIS_CI_SUPABASE_REF`, `NEXT_PUBLIC_SUPABASE_URL` and
     `NEXT_PUBLIC_SUPABASE_ANON_KEY` (the new project's publishable key);
   - `.env.example`, this runbook, `CLAUDE.md`, and the comments that name the
     old ref (`git grep odnobiodsftffphuuosz`);
   - once Preview is on this project (`production-isolation.md` Part C):
     Vercel Preview's `NEXT_PUBLIC_SUPABASE_URL`,
     `NEXT_PUBLIC_SUPABASE_ANON_KEY` and a new `preview` secret key in
     `SUPABASE_SERVICE_ROLE_KEY`, then a new preview build. Vercel is not in
     the repository, so the PR cannot do this part.
   `apps/web/ci/ci-workflow.test.ts` fails if the three workflows disagree.
   Merge it before step 3, since the setup workflow runs from the ref you
   dispatch.
3. Sections 2, 3, 5 and 4, in that order: bootstrap, push, parity, seed.
4. Push any branch; e2e's migration check green on its head SHA proves the
   history (nothing else in CI uses this project). A capture
   (`screenshots.yml`) or a Preview sign-in proves the seed and the Clerk
   trust.

## 9. Local development

**Status, 2026-10-04: DONE on danlo's machine** (plan step D7). Both env
files hold the CI project's four Supabase values, and `packages/db/.env`
holds `BIS_CI_SUPABASE_REF`. It was proven live that day: the db suite's
`voice-schema.test.ts` (5/5, through the session-pooler DB URL) and
`opportunities.test.ts` (8/8, through the secret key). The production values
were kept beside each file as `*.prod-backup`, which the `.env*` ignore rule
covers. Any other machine is still refused until it is switched the same way;
see "Local runs refuse production too" above.

Local runs of `pnpm check` and `pnpm --filter web test:e2e` create and delete
rows exactly as CI does, so they belong on the CI project too (CI's own
`pnpm check` and e2e run on local stacks since 2026-10-08, section 11, but this
machine has no Docker to start one): the four
Supabase values in BOTH `apps/web/.env.local` and `packages/db/.env` (one
switched and the other not puts the db suite and the web suite on different
databases), plus `BIS_CI_SUPABASE_REF` in `packages/db/.env` for the CI-only
tools. A local e2e run no longer shares its seeded account with CI (CI's e2e
seeds its own stack), but it still shares this project with other local
runs, Vercel Preview and a screenshot capture: before a local e2e run, check
`gh run list --workflow screenshots.yml --status in_progress`.

## 10. Reading a red e2e run

CI publishes **no Playwright traces** (since 2026-10-07). This repository is
public, so its Actions artifacts can be downloaded by any signed-in GitHub
user, and a trace can contain session cookies. The `playwright-traces` and
`screenshot-traces` artifacts no longer exist, and
`apps/web/ci/ci-workflow.test.ts` fails `pnpm check` if a workflow uploads
`test-results/`, a trace, a Playwright report or a `.auth` state again.

1. Read the e2e job's **Playwright** step log. The list reporter prints each
   failing test, its assertion and the spec line.
2. To step through it, reproduce locally (section 9's env, and the
   in-progress check above): `pnpm --filter web test:e2e`, or one spec with
   `pnpm --filter web exec playwright test e2e/<name>.spec.ts`. A failed
   spec's trace stays on your machine in `apps/web/test-results/` (gitignored);
   open it with `pnpm --filter web exec playwright show-trace <path>/trace.zip`.
3. Never attach a trace to an issue, a PR or a chat. It is a session.

## 11. The jobs' local stacks (verify since #200, e2e since the change after it; both 2026-10-08)

Neither CI job uses this project for its run. Every verify run and every e2e
run starts its own Supabase stack inside its runner, runs against it, and the
stack is gone with the runner. Nothing is shared between runs, so neither
job has a repo-wide concurrency group, branches' runs go in parallel, and e2e
starts beside verify rather than after it. (Until this date every verify
waited in one line, `verify-ci-supabase`, for this project: with three or
four runs queued, the last waited about 45 minutes before starting; and
every e2e waited in another, `e2e-ci-supabase`, because all of them shared
Test Client One here.) A red verify still blocks a merge without `needs`:
the ruleset requires both checks green on the head commit.

What runs in verify, in order (each script's header has the reasons):

1. `ci-target-guard.sh --before-local-stack`: no Supabase value may be in
   scope yet, so verify never holds this project's secret key.
2. `.github/scripts/ci-supabase-cli.sh`: the Supabase CLI at the version
   `pnpm-lock.yaml` pins for `packages/db` (2.109.1), from its release
   tarball, refused unless its sha256 matches the one pinned in the script.
   Bumping it means changing both; `ci-local-supabase.test.ts` fails if they
   disagree.
3. `.github/scripts/ci-local-supabase.sh`: `supabase start` from a temporary
   workdir holding `packages/db/supabase/config.toml` and **no migrations**,
   excluding the services no suite reaches (realtime, studio, edge
   functions, analytics and the rest; the database, gateway, PostgREST,
   Storage and auth stay — auth only because the CLI prints no API keys
   without it). Then section 2's bootstrap, in one transaction, then the
   branch's migrations by `supabase db push --local`: the same order this
   project was built in, because grants attach when a table is created and
   the CLI starts a stack whose default privileges grant the API roles
   nothing. It refuses a Postgres major other than `config.toml`'s
   `major_version` (17, production's), and only then writes the stack's
   URL, keys and DB URL to `GITHUB_ENV`.
4. `ci-target-guard.sh --local-stack`: the API and DB URL must be on the
   runner's loopback, and the stack's REST API must answer.

e2e runs the same steps, with three differences:

- Its first step after the docs-only decision is the migration check on
  this project (section 6), the one read of it in `ci.yml`.
- Its stack is started with `--trust-clerk-dev-instance`. e2e signs in
  through the Clerk development instance, and every in-account page reads
  through `userDb()`, which hands PostgREST the Clerk session token. The
  script takes the instance's Frontend API domain from
  `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (base64 of `<domain>$`; it must be a
  `*.clerk.accounts.dev` development domain, today
  `topical-redfish-40.clerk.accounts.dev`, the same one this project trusts
  through section 1 step 2) and enables `[auth.third_party.clerk]` for it in
  the workdir's COPY of `config.toml`. CLI 2.109.1 then fetches the
  instance's JWKS at `supabase start` and hands it to PostgREST alongside the
  stack's own secret [read from the CLI's source at that tag]. The script
  reads PostgREST's running JWKS back with `docker inspect` and refuses the
  stack unless it holds an RSA key (the stack's own secret is an `oct` key,
  so an RSA key can only be the issuer's).
- It seeds that stack with `ci:seed:local` (section 4's baseline, refused
  anywhere but the runner's loopback), before Playwright, which builds the
  app with the stack's URL baked in.

Reading a red one:

- **Install the Supabase CLI** red on the checksum: re-run once (a truncated
  download). Red again means the release asset changed after it was pinned;
  that is a finding, not something to re-pin without looking.
- **Start a local Supabase stack** red: its log shows which part failed.
  `supabase start` failing is Docker or an image pull on the runner; the
  bootstrap or a migration failing names the SQL error, and since the stack
  is built from the branch's own files, that error is the branch's.
- **Check that verify (or e2e) targets its local Supabase stack** red with
  404: the migrations did not reach PostgREST; with 403, the bootstrap's
  default privileges did not take effect before the migrations.
- e2e's **Start a local Supabase stack that trusts the Clerk development
  instance** red on "PostgREST … holds no RSA key": the trust did not reach
  PostgREST, and every signed-in page would have come back empty. Red inside
  `supabase start` on an OIDC or JWKS URL: Clerk's discovery endpoint did not
  answer; re-run once.
- e2e's **Playwright** red with in-account pages empty or 500 while
  `/dashboard/accounts` renders: the classic "Clerk token not trusted"
  shape (`clerk-setup.md`). Check the stack step's notice names the domain
  and an RSA key.
- **pnpm check** red: as before, except that a db test can no longer fail
  from another branch's run, so a failure that moves between re-runs is not
  contention any more. Read it as a real one.

What stays on this project: Vercel Preview, `screenshots.yml`, local runs on
danlo's machine, `ci:seed`, the parity checks, and section 6's rule that
every new migration comes here before production, which e2e's migration
check enforces (section 6).
