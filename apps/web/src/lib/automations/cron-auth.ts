import { timingSafeEqual } from "node:crypto";

/**
 * The one cron auth check (F-196): the dispatcher, both pass routes and
 * demo-refresh call this and nothing else. Two failure modes, never one:
 *  - "unset": `CRON_SECRET` is unset or empty. An unguarded cron route must
 *    refuse to exist (503) rather than run open, and an empty secret would
 *    otherwise match a bare `Bearer ` header.
 *  - "denied": the `authorization` header is not exactly `Bearer ${secret}`
 *    (401). Vercel attaches that header to its own cron requests, and the
 *    dispatcher attaches it to every pass request.
 * Both are decided before the caller runs a single query.
 *
 * Constant-time compare, mirroring guards.ts's verifyRenderToken: a straight
 * `!==` leaks how many leading bytes matched via response timing. Length is
 * checked first because timingSafeEqual throws on mismatched lengths.
 */
export type CronAuth = "ok" | "unset" | "denied";

export function cronAuthorized(req: Request, env: NodeJS.ProcessEnv = process.env): CronAuth {
  const secret = env.CRON_SECRET;
  if (!secret) return "unset";
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return "denied";
  return "ok";
}
