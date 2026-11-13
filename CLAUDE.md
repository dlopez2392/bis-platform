# BIS Platform

@DESIGN.md

- Design contract above governs every UI change — tokens only, no hard-coded
  colors/radii/shadows; see its Installation status section for the current
  tokens-import state before wiring styles.
- Execution ledger: `.superpowers/sdd/progress.md` (gitignored — read it
  before follow-up work).
- Gates before any merge: `pnpm check` (typecheck + lint + db + web tests),
  `pnpm --filter web build`, `pnpm --filter web test:e2e`. CI runs all three
  on every push (`.github/workflows/ci.yml`, checks `verify` and `e2e`).
  Push to `main` deploys production. Before a push,
  `bash scripts/affected-tests.sh` lists the tests your diff can reach, by
  import AND by file name (a test that reads a script or config by path),
  and `--run` runs them; the full suite stays CI's job.
- **The server enforces those checks on `main` (since 2026-09-19).** The
  repo is PUBLIC, and a ruleset on `main` (id 23712687, no bypass actors —
  the owner is bound too) requires `verify` and `e2e` to be green on a PR's
  head commit, allows only squash-merge through a PR, and refuses direct
  pushes, force-pushes and deletion. What it does NOT do: the policy is
  non-strict, so a branch that is behind `main` can still merge on its own
  green checks. Therefore the reading discipline stands — before merging,
  read the check runs FOR THE HEAD SHA (`gh api .../commits/<sha>/check-runs`),
  never infer from an earlier run or a re-run's exit code — and if a
  stale-branch merge ever bites, tighten the ruleset to strict rather than
  adding a rule here. The `.githooks/pre-push` hook (installed with
  `git config core.hooksPath .githooks`) still stops a direct push from a
  developer's own machine before the server has to; it is a courtesy, not
  the control, and it does not exist in a fresh clone until that command is
  run.
- CI's suites run on neither production's Supabase (`tlbkbmlrfafquucsmsmm`)
  nor, since 2026-10-08, the shared CI project (`odnobiodsftffphuuosz`,
  `bis-ci`):
  since 2026-11-12 `verify` and `e2e` are GATE jobs (`ci-gate.sh`,
  `if: always()`) that are green only when every part they need succeeded,
  and the parts run in parallel: `verify` = `verify-db` (its own stack: the
  db suite and the web tests that need a database, vitest project `live`) +
  `verify-app` (no stack: typecheck, lint, the web `unit` project, the
  build); `e2e` = four `e2e-shard` runners + `migrations-plan` +
  `migrations-bis-ci` (below); each shard has
  its own stack started with `--trust-clerk-dev-instance` (so its PostgREST
  verifies the Clerk development instance's tokens as bis-ci does), seeded
  by `ci:seed:local`, running `--shard=N/4`. Stacks come from
  `.github/scripts/ci-local-supabase.sh` (bootstrap then migrations). No
  test job joins a repo-wide queue: a push is green in about 11 minutes (was
  ~22 with one serial e2e job; the longest shard holds billing-pause.spec.ts).
  Read a red gate through the PART it names. A guard in every part refuses
  production and any cloud Supabase value for the suites or the app.
  **Since 2026-11-13 (migration pipeline PR 4) CI WRITES to bis-ci**, in ONE
  place: `migrations-bis-ci`, for a branch that adds a migration, once
  `verify-db`, `verify-app` and every `e2e-shard` passed on its head SHA and
  only when an open, non-draft PR into main has that SHA as its head (a draft
  or no PR fails it: mark it ready, then Re-run failed jobs). It applies ONLY
  the branch's added files with `.github/scripts/migrations-apply.sh --target
  bis-ci`, then `--check`s that bis-ci holds every file of the branch, in ONE
  step that alone holds bis-ci's DB URL, in a repo-wide queue
  (`bis-ci-migrations`, never cancelled). A push that adds no migration skips
  it and never reaches bis-ci; on main it only checks. **CI WRITES to
  production in ONE place too (migration pipeline PR 5):**
  `migrations-production`, after `migrations-bis-ci` SUCCEEDED in the same
  run, for a branch (never main) that adds a migration, applies those files
  to production only after danlo approves the `production-migrations`
  environment, the only place the production database credential
  (`PROD_MIGRATIONS_DB_URL`, production's Session pooler URL) exists. The
  same one step then checks parity against bis-ci (minus
  `packages/db/supabase/parity/allowed-differences.txt`; a difference fails
  it, owner answer Q3) and production's full history. No other job,
  workflow or test holds a production database credential; `seed-demo.yml`
  and `ops-health.yml` keep their `production` environment secrets (main
  only). The required `e2e` check is red until production holds every
  migration of the branch, so the app never deploys ahead of its schema. A
  missing environment or secret fails that job closed, naming it. Never
  approve that environment through the API (a hook blocks it). Since
  #135, LOCAL runs refuse production too: the db suite, the integration
  suite, Playwright and the six live web tests all throw before connecting
  when any Supabase/PG* variable names production's ref, naming the
  variable, never its value. danlo's machine has run on the CI project
  since 2026-10-04 (runbook section 9, plan step D7, done): both
  `apps/web/.env.local` and `packages/db/.env` name it. Any other machine
  whose env still points at production is REFUSED, not run. A local e2e run
  shares bis-ci's seeded account with Vercel Preview and the screenshot
  capture (no longer with CI), so check for an in-progress `screenshots.yml`
  run first. New migration files are `YYYYMMDDHHMMSS_slug.sql` (UTC),
  created by `pnpm --filter @bis/db migration:new <slug>` (since
  2026-11-13); `0001`..`0116` keep their numbers and verify refuses a new
  numbered file. Every new migration goes to the CI project FIRST (CI's
  `migrations-bis-ci`, above; by hand only through `ci-project-setup.yml`'s
  `apply`, never `migration repair`), then production
  (`migrations-production`, above), then parity (the same step)
  (`docs/runbooks/ci-supabase-project.md` sections 5-6). The `e2e` check
  enforces all three. The Supabase MCP apply is the documented FALLBACK
  only (CI cannot run): it passes `name` = the file's WHOLE stem
  (`20261114093000_work_queue`), never the slug alone (0060..0115 were
  applied slug-only; do not copy that). The bis-ci check proves only
  that each migration's (version, name) is in bis-ci's history, not that bis-ci's
  schema works with the app: no CI test runs on bis-ci any more, so Vercel
  Preview (plus local runs and a dispatched capture) is the only thing that
  exercises it. And CI's stacks are the Supabase CLI's Docker images, not
  hosted Supabase, so read a CI-vs-Preview disagreement as an ENVIRONMENT
  finding first (runbook section 6). Leftover fixture rows and logos on
  bis-ci are swept only by a local run (runbook section 9). Booking and
  calendar-settings specs run on the per-run fixture account — never point
  mutating specs at `Test Client One` or any live account.
- **Only production credentials reach production data. DONE 2026-10-07.**
  Production's Supabase trusts only the production Clerk instance
  (`clerk.app.bis-rgv.com`); the development issuer was removed. Vercel
  Preview holds the Clerk development instance, the CI project (`bis-ci`)
  and non-secret config, behind Vercel Authentication, and never a
  production credential. The production credentials Preview had held were
  rotated. `screenshots.yml` captures on the CI project since #197
  (2026-10-08). How it was done, how to verify it and how to roll it back:
  `docs/runbooks/production-isolation.md`. Never describe Preview as sharing
  production's database, and never add a production credential to Preview.
- **How much process a change gets (owner decision, 2026-11-09; this
  replaces the habit of full ceremony on everything).** Tier each TASK,
  not the PR, and write the tier where the task is dispatched.
  - HIGH — migrations, RLS and grants, auth and tenancy, consent and
    customer-facing sends, voice call routing, billing, CI secrets: a
    brief, one implementer, a review with mutation probes, a re-review
    only when the fix changes logic.
  - MEDIUM — server logic and `packages/db` code with no migration: one
    implementer and one review.
  - LOW — UI, copy, tests, docs, styleguide: one implementer, NO per-task
    review, no mutation probes.
  - Per PR: ONE end-of-PR review, a design review only when visible
    layout or tokens change, ONE fix round. Aim for under about 800
    changed lines; split a larger change into PRs that each ship.
  - A plan is at most 300 lines, and only HIGH work gets a separate plan
    document; everything else is a short brief. The code is the record.
  - Do not write a test that reads source files as text when a behaviour
    test or a lint rule can make the same point.
  - A hold on finished work (a waiting period, a merge order) needs the
    owner's dated decision; say what it blocks when proposing it.
- **Scope (owner decision, 2026-11-09): healthcare is out.** No medical,
  dental, therapy or other HIPAA-covered client is onboarded and nothing
  is built for one; the trade check in `lib/vetting/trades.ts` stays as
  the gate. Reopening this is the owner's call, with the vendor
  agreements priced first.
