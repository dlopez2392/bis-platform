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

CI (.github/workflows/ci.yml) runs all three on every push, from five
repository secrets that mirror apps/web/.env.local: NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
CLERK_SECRET_KEY, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DB_URL.
Both jobs are ADVISORY: this repo is private on a plan without protected
branches, so a red check does not block a merge. Read the checks before
merging, and let `.githooks/pre-push` keep direct pushes off main.

The e2e job is serialized across the repo because the suite shares the one
Supabase project with production. SUPABASE_DB_URL in CI must be the **Session
pooler** URI (aws-…pooler.supabase.com:5432): the direct db.<ref>.supabase.co
host is IPv6-only and GitHub-hosted runners have no IPv6.

## Deploy
Vercel project "bis-platform" (team danlopez508-8452s-projects), Root Directory apps/web,
framework pinned via apps/web/vercel.json. Push to main = deploy.
Env vars: see .env.example (service-role + db-url are server-only, never NEXT_PUBLIC).
Deployment Protection is disabled; the app's own Clerk auth is the gate.
