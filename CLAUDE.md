# BIS Platform

@DESIGN.md

- Design contract above governs every UI change — tokens only, no hard-coded
  colors/radii/shadows; see its Installation status section for the current
  tokens-import state before wiring styles.
- Execution ledger: `.superpowers/sdd/progress.md` (gitignored — read it
  before follow-up work).
- Gates before any merge: `pnpm check` (typecheck + lint + db + web tests),
  `pnpm --filter web build`, `pnpm --filter web test:e2e`. CI runs all three
  on every push (`.github/workflows/ci.yml`, jobs `verify` and `e2e`); a PR
  is mergeable only when both are green. Push to `main` deploys production.
- The e2e suite shares the ONE Supabase project with production. Booking and
  calendar-settings specs run on the per-run fixture account — never point
  mutating specs at `Test Client One` or any live account.
