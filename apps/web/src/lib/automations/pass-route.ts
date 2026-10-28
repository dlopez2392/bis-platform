import { serviceDb } from "@bis/db";
import { configuredOrigin } from "@/lib/email/origin";
import { cronAuthorized } from "./cron-auth";
import type { Pass } from "./context";
import { buildPassContext, runPass } from "./harness";

/**
 * F-196: what a pass route does, in one place, for `/api/cron/pass/[key]` (90 s)
 * and the jobs drain's own route (300 s). The dispatcher POSTs `{ now }`, the
 * tick's one instant; the route runs that ONE pass on it and answers its
 * counters. `runPass` writes `cron.pass.<key>`; never `cron.tick`, which the
 * dispatcher writes once, after every node is decided.
 */

/** One tick: a `now` older than this is a replay or a stuck queue, not this tick. */
export const TICK_NOW_MAX_AGE_MS = 900_000;
/** Clock skew between the dispatcher's function and this one, and nothing more. */
export const TICK_NOW_MAX_AHEAD_MS = 60_000;

/**
 * The tick's instant from a pass request's body, or null when the body is not
 * `{ now: <a date string> }` or that instant is outside
 * [wall - 900 s, wall + 60 s] (both bounds inclusive).
 */
export function parseTickNow(body: unknown, wallMs: number): Date | null {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
  const raw = (body as { now?: unknown }).now;
  if (typeof raw !== "string") return null;
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return null;
  if (t < wallMs - TICK_NOW_MAX_AGE_MS || t > wallMs + TICK_NOW_MAX_AHEAD_MS) return null;
  return new Date(t);
}

/**
 * The order is the contract; every refusal comes before the first query:
 *  1. auth: `CRON_SECRET` unset → 503; a wrong bearer → 401;
 *  2. an unknown pass → 404;
 *  3. a body that is not JSON, or whose `now` is not this tick's → 400;
 *  4. `APP_ORIGIN` unset → 503: under fan-out a link is never built from a
 *     request's host, which for a server-to-server call is the deployment's
 *     vercel.app URL (lib/email/origin.ts says why that matters);
 *  5. run the pass on the body's `now`, answer its counters (a pass that
 *     throws is `{ errored: 1 }`, still 200: it ran, and its heartbeat says how).
 */
export async function handlePassRequest(req: Request, pass: Pass | null): Promise<Response> {
  const auth = cronAuthorized(req);
  if (auth === "unset") return new Response(null, { status: 503 });
  if (auth === "denied") return new Response(null, { status: 401 });

  if (!pass) return new Response(null, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(null, { status: 400 });
  }
  const now = parseTickNow(body, Date.now());
  if (!now) return new Response(null, { status: 400 });

  const origin = configuredOrigin();
  if (!origin) return new Response(null, { status: 503 });

  const ctx = buildPassContext({ db: serviceDb(), now, origin });
  return Response.json(await runPass(pass, ctx));
}
