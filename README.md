# bis-platform

Multi-tenant client platform (BIS). Spec: docs/superpowers/specs/2026-07-25-bis-platform-design.md

## Dev
pnpm install
cp .env.example apps/web/.env.local   # fill from Clerk + Supabase dashboards
git config core.hooksPath .githooks   # once per clone; see .githooks/pre-push
pnpm --filter web dev

## Gates
pnpm check                    # typecheck + lint + every package's vitest suite
pnpm --filter web build
pnpm --filter web test:e2e    # Playwright; needs apps/web/.env.local, ~5 min

CI (.github/workflows/ci.yml) runs all three on every push, on the separate CI
Supabase project `bis-ci` (ref odnobiodsftffphuuosz), never on production's.
Its URL, ref and publishable key are literals in ci.yml; the rest comes from
four required repository secrets: NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and
CLERK_SECRET_KEY (the Clerk development instance), CI_SUPABASE_SECRET_KEY and
CI_SUPABASE_DB_URL. The e2e job also reads an optional OPENAI_API_KEY (a
separate CI key); without it the one spec that calls the model skips itself.
The secrets named NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and
SUPABASE_DB_URL hold PRODUCTION's values; only seed-demo.yml and
screenshots.yml read them. Both jobs first run .github/scripts/ci-target-guard.sh,
which refuses production's project, a production Clerk key, or a key that does
not open the CI project. CI_SUPABASE_DB_URL must be the **Session pooler** URI
(aws-…pooler.supabase.com:5432, user postgres.<ref>): the direct
db.<ref>.supabase.co host is IPv6-only and GitHub-hosted runners have no IPv6.

That guard is CI's. Locally, since #135, the live suites and e2e refuse
production themselves: they throw before connecting when
apps/web/.env.local or packages/db/.env names production's project. Until both
files point at the CI project (docs/runbooks/ci-supabase-project.md, section
9), `pnpm check` and `pnpm --filter web test:e2e` on such a machine are
refused, not run.

A ruleset on main requires `verify` and `e2e` green on a PR's head commit
(CLAUDE.md). Read the checks for the head SHA before merging, and let
`.githooks/pre-push` keep direct pushes off main from your own machine.

The e2e job is serialized across the repo because every run shares one seeded
account ("Test Client One") on the CI project. It runs
`pnpm --filter @bis/db ci:seed` first, which adds whatever of that account is
missing. Creating, restoring or rebuilding the CI project, and applying a new
migration to it: docs/runbooks/ci-supabase-project.md.

## Deploy
Vercel project "bis-platform" (team danlopez508-8452s-projects), Root Directory apps/web,
framework pinned via apps/web/vercel.json. Push to main = deploy.
Env vars: see .env.example (service-role + db-url are server-only, never NEXT_PUBLIC).
Production holds production's values; Preview must hold only the Clerk
development instance, the CI Supabase project and non-secret config, behind
Vercel Authentication (docs/runbooks/production-isolation.md). As of
2026-09-26 that is NOT yet the case: Preview still names production's database
and Deployment Protection is off. The runbook is the owner's checklist.
