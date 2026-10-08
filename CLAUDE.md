# BIS Platform

@DESIGN.md

- Design contract above governs every UI change — tokens only, no hard-coded
  colors/radii/shadows; see its Installation status section for the current
  tokens-import state before wiring styles.
- Execution ledger: `.superpowers/sdd/progress.md` (gitignored — read it
  before follow-up work).
- Gates before any merge: `pnpm check` (typecheck + lint + db + web tests),
  `pnpm --filter web build`, `pnpm --filter web test:e2e`. CI runs all three
  on every push (`.github/workflows/ci.yml`, jobs `verify` and `e2e`).
  Push to `main` deploys production.
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
- CI's `e2e` runs on a separate Supabase project, `odnobiodsftffphuuosz`
  (`bis-ci`), never on production's (`tlbkbmlrfafquucsmsmm`). Since
  2026-10-08 `verify` runs on neither: it starts a throwaway Supabase stack
  inside its own runner (`.github/scripts/ci-local-supabase.sh`, bootstrap
  then migrations), so it joins no repo-wide queue and branches' verify runs
  go in parallel (~6 min, was 13–21 plus up to an hour of queue). A guard in
  both jobs refuses production; in verify it refuses any cloud Supabase
  value at all. Since
  #135, LOCAL runs refuse production too: the db suite, the integration
  suite, Playwright and the two live web tests all throw before connecting
  when any Supabase/PG* variable names production's ref, naming the
  variable, never its value. danlo's machine has run on the CI project
  since 2026-10-04 (runbook section 9, plan step D7, done): both
  `apps/web/.env.local` and `packages/db/.env` name it. Any other machine
  whose env still points at production is REFUSED, not run, and a local e2e
  run shares CI's seeded account, so check for an in-progress CI run first.
  Every new migration goes to
  the CI project FIRST (the `ci-project-setup.yml` workflow), then
  production, then a parity check (`docs/runbooks/ci-supabase-project.md`).
  Booking and calendar-settings specs run on the per-run fixture account —
  never point mutating specs at `Test Client One` or any live account.
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
