import { timingSafeEqual } from "node:crypto";
import { serviceDb } from "@bis/db";
import { configuredOrigin } from "@/lib/email/origin";
import { buildPassContext, runPasses } from "@/lib/automations/harness";
import { PASSES } from "@/lib/automations/registry";

export const dynamic = "force-dynamic";

// The tick's own ceiling. RELEASE_BUDGET_MS (60s, release-held.ts) bounds the
// FIRST pass so it cannot starve the passes after it; this is that budget plus
// headroom for them — the two numbers are one coupling, so changing either
// without the other is the bug. (No count here on purpose: `PASSES` grows by a
// line per recipe, and a number written in prose rots the first time it does.)
// 300 is Vercel's current per-function default; declaring it here makes the
// assumption explicit rather than inherited.
export const maxDuration = 300;

/**
 * The platform's scheduled job: Vercel hits this every 15 minutes
 * (`vercel.json`'s `crons` entry — the literal cron string is deliberately
 * NOT quoted in a block comment in this repo, because its leading `*` + `/`
 * closes the comment). It runs every registered automation pass
 * (`lib/automations/registry.ts`) in order, each isolated from the others.
 *
 * The schedule, `listDueReminders`' forward window and `listDueFollowups`'
 * backward window are COUPLED; `lib/automations/cron-coupling.test.ts` now
 * enforces that against this file's own vercel.json.
 *
 * Cost when nothing is due: one narrow indexed select per pass, each
 * returning [] and short-circuiting before any per-account lookup.
 * `getEmailProvider()` only reads env vars — it opens no connection.
 *
 * AUTH is two separate failure modes, not one:
 *  - `CRON_SECRET` unset → 503, zero queries. An unguarded cron route must
 *    refuse to exist rather than run open.
 *  - a request whose `authorization` header doesn't match → 401, zero
 *    queries. Vercel attaches `Bearer ${CRON_SECRET}` automatically.
 */
export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return new Response(null, { status: 503 });

  // Constant-time compare, mirroring guards.ts's verifyRenderToken: a
  // straight `!==` leaks how many leading bytes matched via response timing.
  // Length is checked first — timingSafeEqual throws on mismatched lengths.
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  if (got.length !== want.length || !timingSafeEqual(got, want)) {
    return new Response(null, { status: 401 });
  }

  // APP_ORIGIN wins when set (the custom domain); req.url's origin is only
  // the FALLBACK, and that fallback IS the deployment's vercel.app URL — the
  // exact link/sender mismatch Gmail silently discarded mail over.
  const origin = configuredOrigin() ?? new URL(req.url).origin;

  const ctx = buildPassContext({ db: serviceDb(), now: new Date(), origin });
  const { reminders, ...rest } = await runPasses(PASSES, ctx);

  // The reminder pass's counters stay TOP-LEVEL and every other pass nests
  // under its key — byte-identical to what this route returned before the
  // harness existed, which is what lets route.test.ts stand unchanged as the
  // migration's proof. New passes appear as new keys beside `followups`.
  // One consequence to know when reading the cron log: if the reminder pass
  // itself errors outright, the top level carries `errored: 1` and no
  // `sent`/`failed`/`unstamped` keys for that tick.
  return Response.json({ ...reminders, ...rest });
}
