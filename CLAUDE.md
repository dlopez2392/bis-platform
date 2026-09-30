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
- CI (`verify` and `e2e`) runs on a separate Free Supabase project,
  `odnobiodsftffphuuosz` (`bis-ci`), never on production's
  (`tlbkbmlrfafquucsmsmm`); a guard in both jobs refuses production. Since
  #135, LOCAL runs refuse production too: the db suite, the integration
  suite, Playwright and the two live web tests all throw before connecting
  when any Supabase/PG* variable names production's ref, naming the
  variable, never its value. Until `apps/web/.env.local` and
  `packages/db/.env` are switched to the CI project (runbook section 9,
  plan step D7), a local `pnpm check` or e2e run on a machine whose env
  still points at production is REFUSED, not run. Every new migration goes to
  the CI project FIRST (the `ci-project-setup.yml` workflow), then
  production, then a parity check (`docs/runbooks/ci-supabase-project.md`).
  Booking and calendar-settings specs run on the per-run fixture account —
  never point mutating specs at `Test Client One` or any live account.
