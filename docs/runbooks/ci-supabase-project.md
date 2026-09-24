# The CI Supabase project (`bis-ci`)

CI does not run on production's database. Both CI jobs (`verify` and `e2e` in
`.github/workflows/ci.yml`) create and delete rows and Clerk users, so since
2026-09-24 they run on a separate project that exists only for tests. This
runbook covers creating it, bringing its schema up to date, seeding it,
checking it matches production, restoring it after a pause, and rebuilding it
from nothing.

Audience: danlo (dashboard steps) and the orchestrator (workflow dispatches,
MCP reads of production).

## Facts

| | CI project | Production |
|---|---|---|
| Name / org | `bis-ci`, in the Free organization `bis-ci` | the paid organization |
| Ref | `odnobiodsftffphuuosz` | `tlbkbmlrfafquucsmsmm` |
| Region | us-east-1 (same as production, so runner latency matches) | us-east-1 |
| Schema from | `supabase db push` of the migration files (`db:push:ci`) | the Supabase MCP `apply_migration`, one file at a time |
| Clerk it trusts | the **development** instance, `topical-redfish-40.clerk.accounts.dev` | production's instance, and the development one too (`clerk-setup.md`) |
| URL, ref | literals in `ci.yml` and `ci-project-setup.yml` | Vercel env |
| Publishable key | a literal in `ci.yml` (`ci-project-setup.yml` does not use it) | Vercel env |
| Secret key, DB URL | repository secrets `CI_SUPABASE_SECRET_KEY`, `CI_SUPABASE_DB_URL` | Vercel env; repository secrets `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL` (read only by `seed-demo.yml` and `screenshots.yml`); and any local env file not yet switched (section 9) |

Never edit the three non-`CI_` secrets to point at the CI project. The demo
seeder and the screenshot run would then "succeed" against the wrong database.

`CI_SUPABASE_DB_URL` is always the **Session pooler** URI (Supabase dashboard >
Connect > Session pooler; host `aws-0-us-east-1.pooler.supabase.com:5432`,
user `postgres.odnobiodsftffphuuosz`). The direct `db.<ref>.supabase.co` host
is IPv6-only, and GitHub's runners have no IPv6.

### What protects production

In CI, and in the CI-only tools, a check names the CI project by
`BIS_CI_SUPABASE_REF` and refuses anything else before anything connects:

- `.github/scripts/ci-target-guard.sh`: the first step of both CI jobs. It
  refuses production's ref anywhere, an API URL that is not exactly
  `https://<ref>.supabase.co`, a DB URL whose user is not `postgres.<ref>`, a
  `pk_live_`/`sk_live_` Clerk key, and a secret key that does not open the
  project's REST API. Tested by `apps/web/ci/ci-target-guard.test.ts`.
- `packages/db/src/ci/target.ts` (`assertCiTarget`), inside `db:push:ci`,
  `db:migrations:ci`, `ci:sql` and `ci:seed`: a narrower check of the ref, the
  API URL and the DB URL only (refuses production's ref, a URL or DB user for
  any other project). No Clerk check and no REST probe.
- `apps/web/ci/ci-workflow.test.ts`: fails `pnpm check` if `ci.yml` ever reads a
  production secret, drops or weakens the guard step, or names a different
  project from `ci-project-setup.yml`.

**What is NOT protected: local runs.** The db suite, the web suite and the e2e
suite have no target check of their own. They write to whatever
`apps/web/.env.local` and `packages/db/.env` point at. Until both are switched
to the CI project (section 9), a local `pnpm check` or e2e run on a machine
whose env still points at production WRITES PRODUCTION.

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

The `e2e` job runs the same command before Playwright on every push, so a
project that lost its seed heals itself on the next run, and a seed that cannot
be made is a red job rather than a run of specs that skip.

Test Client One is still read-only for specs: it is shared by every run, and
mutating specs belong on the per-run fixture account.

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
migration, not a re-push. And a grant change pushed to the CI project turns
every OTHER branch's grant-pinning tests red until this branch merges, because
the CI project is main's database now. Push to CI only when the branch is
otherwise ready.

## 7. Restore from a pause

Free projects pause after about a week without traffic [assumption: Supabase's
published Free-plan behaviour]. Every CI push is traffic, so this bites only
after a quiet week. The symptom is the guard's first step failing with
"Could not reach … the project is paused" (or another non-200 status).

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
   - `.github/workflows/ci.yml` env: `BIS_CI_SUPABASE_REF`,
     `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (the new
     project's publishable key);
   - `.github/workflows/ci-project-setup.yml` env: `BIS_CI_SUPABASE_REF`,
     `NEXT_PUBLIC_SUPABASE_URL`;
   - `.env.example`, this runbook, `CLAUDE.md`, and the comments that name the
     old ref (`git grep odnobiodsftffphuuosz`).
   `apps/web/ci/ci-workflow.test.ts` fails if the two workflows disagree.
   Merge it before step 3, since the setup workflow runs from the ref you
   dispatch.
3. Sections 2, 3, 5 and 4, in that order: bootstrap, push, parity, seed.
4. Push any branch; both CI jobs green on its head SHA is the proof.

## 9. Local development

**Status, 2026-09-24: NOT done** (plan step D7). The local env files on
danlo's machine still point at production, so a local `pnpm check` or e2e run
there writes production. Nothing refuses it; see "What is NOT protected" above.

Local runs of `pnpm check` and `pnpm --filter web test:e2e` create and delete
rows exactly as CI does, so they belong on the CI project too: the four
Supabase values in BOTH `apps/web/.env.local` and `packages/db/.env` (one
switched and the other not puts the db suite and the web suite on different
databases), plus `BIS_CI_SUPABASE_REF` in `packages/db/.env` for the CI-only
tools. A local e2e run and a CI e2e run share the seeded account; before a
local e2e run, check `gh run list --workflow ci.yml --status in_progress`.
