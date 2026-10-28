import { cronAuthorized } from "@/lib/automations/cron-auth";

export const dynamic = "force-dynamic";

/**
 * Starts the "Seed demo tenant" workflow every morning (owner's decision,
 * 2026-10-20). Vercel hits this once a day (`vercel.json`'s `crons` entry);
 * this route only ASKS GitHub to run `.github/workflows/seed-demo.yml`. The
 * rebuild itself stays in GitHub, where the production key already lives in
 * the protected `production` environment.
 *
 * Why not GitHub's own schedule: GitHub dropped most of this repo's scheduled
 * runs. On 2026-10-19/20 the hourly ops-health workflow ran 5 times in 24
 * hours, and both of the demo's scheduled runs (10:17 and 11:17 UTC) never
 * started. Vercel's cron has run the 15-minute tick reliably all along. The
 * workflow keeps its own schedules as a fallback that only rebuilds a stale
 * demo, so this dispatch and a late GitHub run never rebuild twice.
 *
 * AUTH mirrors /api/cron/reminders: `CRON_SECRET` unset → 503, a request
 * without Vercel's `Bearer ${CRON_SECRET}` → 401. Then `DEMO_REFRESH_GITHUB_TOKEN`
 * unset → 503: a token that can start workflows is set in Vercel Production
 * only, never Preview, so a preview deployment can never trigger a rebuild of
 * production's demo.
 */
const REPO = "dlopez2392/bis-platform";
const WORKFLOW = "seed-demo.yml";

export async function GET(req: Request): Promise<Response> {
  // The one cron auth helper (constant-time compare, length first).
  const auth = cronAuthorized(req);
  if (auth === "unset") return new Response(null, { status: 503 });
  if (auth === "denied") return new Response(null, { status: 401 });

  const token = process.env.DEMO_REFRESH_GITHUB_TOKEN;
  if (!token) return Response.json({ dispatched: false, reason: "token unset" }, { status: 503 });

  const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
      "content-type": "application/json",
    },
    // The workflow's own guard wants the word typed by a human; this route is
    // the owner's standing instruction to type it every morning.
    body: JSON.stringify({ ref: "main", inputs: { confirm: "seed" } }),
  });

  // GitHub answers 204 to an accepted dispatch. Anything else is reported,
  // status only: the body can echo request details and is not logged.
  if (res.status !== 204) {
    console.error(`demo-refresh: GitHub refused the dispatch with HTTP ${res.status}`);
    return Response.json({ dispatched: false, status: res.status }, { status: 502 });
  }
  return Response.json({ dispatched: true });
}
