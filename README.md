# bis-platform

Multi-tenant client platform (BIS). Spec: docs/superpowers/specs/2026-07-25-bis-platform-design.md

## Dev
pnpm install
cp .env.example apps/web/.env.local   # fill from Clerk + Supabase dashboards
pnpm --filter web dev

## Gates
pnpm check   # tsc + vitest, must be green before commit

## Deploy
Vercel project "bis-platform" (team danlopez508-8452s-projects), Root Directory apps/web,
framework pinned via apps/web/vercel.json. Push to main = deploy.
Env vars: see .env.example (service-role + db-url are server-only, never NEXT_PUBLIC).
Deployment Protection is disabled; the app's own Clerk auth is the gate.
