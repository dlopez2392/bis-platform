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
- **Nothing server-side enforces those checks.** This repo is private on a
  plan without protected branches, so GitHub shows a red X and lets the
  merge happen anyway. Therefore: never merge a PR unless BOTH `verify` and
  `e2e` are green ON ITS CURRENT HEAD COMMIT — read the check runs, do not
  infer it from an earlier run — and never push to `main` directly. Work
  goes on a branch and lands through a PR. The `.githooks/pre-push` hook
  (installed with `git config core.hooksPath .githooks`) stops the direct
  push from a developer's own machine; it is a guard against a slip, not a
  control, and it does not exist at all in a fresh clone until that command
  is run.
- The e2e suite shares the ONE Supabase project with production. Booking and
  calendar-settings specs run on the per-run fixture account — never point
  mutating specs at `Test Client One` or any live account.
