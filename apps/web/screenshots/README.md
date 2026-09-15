# Product screenshots

The captures `/platform` on bis-rgv.com renders. Six images of the seeded demo
tenant (Resaca Air), produced here and committed to the website repo under
`public/screenshots/`.

## Running it

**Actions → Capture demo screenshots → Run workflow.** The runner has the Clerk
and Supabase secrets; a laptop needs both plus a production build, which is why
this exists as a button rather than a paragraph of instructions.

The captures arrive as a workflow artifact. They are not committed here — this
repo has no use for them; the website does.

Locally, if you have `apps/web/.env.local`:

    pnpm --filter web screenshots

## Re-seed first, always

    pnpm --filter @bis/db db:seed-demo     # or the Seed demo tenant workflow

Every timestamp in the demo is anchored to the moment the seeder ran. Capture a
week later and the dashboard's "this week" panels are empty, because they
honestly report a week in which nothing happened. The workflow re-seeds by
default for exactly this reason.

## What "deterministic" does and does not mean here

The browser clock is pinned to the demo account's own `created_at` — the moment
it was seeded — so anything the CLIENT renders from `Date.now()` is stable
across runs.

It does **not** pin the server's clock, and it cannot: the dashboard's period
panels are computed server-side. So two capture runs against the same seed
produce the same pictures only in so far as the wall clock has not moved the
server's idea of "this week". Re-seed immediately before capturing and that
window is minutes wide. That is the real lever; the pinned clock is the part
that was cheap.
