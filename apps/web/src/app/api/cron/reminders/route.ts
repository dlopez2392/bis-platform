import { recordHeartbeat, serviceDb, type SupabaseClient } from "@bis/db";
import { configuredOrigin } from "@/lib/email/origin";
import { cronAuthorized } from "@/lib/automations/cron-auth";
import { fanoutEnabled, httpInvoke, PLAN, runFanout } from "@/lib/automations/fanout";
import { buildPassContext, runPasses } from "@/lib/automations/harness";
import { PASSES } from "@/lib/automations/registry";
import type { PassCounters } from "@/lib/automations/context";

export const dynamic = "force-dynamic";

// The tick's own ceiling: DISPATCHER_MAX_S in lib/automations/fanout.ts, and
// cron-coupling.test.ts reads this literal. Under fan-out it must hold the
// plan's longest chain of pass-route ceilings plus slack, and stay under one
// tick so two dispatchers never overlap. With the switch off it is also the
// in-process tick's ceiling, whose own budget (every pass together, the
// release pass's included) is LEGACY_TICK_CEILING_S, pinned in the same test.
export const maxDuration = 800;

/**
 * The platform's scheduled job: Vercel hits this every 15 minutes
 * (`vercel.json`'s `crons` entry — the literal cron string is deliberately
 * NOT quoted in a block comment in this repo, because its leading `*` + `/`
 * closes the comment). It runs every registered automation pass
 * (`lib/automations/registry.ts`), each isolated from the others, in one of
 * two ways (F-196):
 *  - `CRON_FANOUT=1` and `APP_ORIGIN` set: a DISPATCHER. It walks `PLAN`
 *    (`lib/automations/fanout.ts`) and POSTs each node to its own function,
 *    `/api/cron/pass/<key>`, awaiting the plan; the tick's one `now` travels
 *    in every body.
 *  - otherwise: the single in-process tick, exactly as before fan-out. The
 *    switch on with `APP_ORIGIN` unset falls back here, and says so, because
 *    a pass route refuses to build links from a request's host.
 *
 * The schedule, `listDueReminders`' forward window and `listDueFollowups`'
 * backward window are COUPLED; `lib/automations/cron-coupling.test.ts` now
 * enforces that against this file's own vercel.json.
 *
 * Cost when nothing is due: one narrow indexed select per pass, each
 * returning [] and short-circuiting before any per-account lookup.
 * `getEmailProvider()` only reads env vars — it opens no connection.
 *
 * AUTH is two separate failure modes, not one (`cronAuthorized`):
 *  - `CRON_SECRET` unset → 503, zero queries. An unguarded cron route must
 *    refuse to exist rather than run open.
 *  - a request whose `authorization` header doesn't match → 401, zero
 *    queries. Vercel attaches `Bearer ${CRON_SECRET}` automatically.
 */
export async function GET(req: Request): Promise<Response> {
  const auth = cronAuthorized(req);
  if (auth === "unset") return new Response(null, { status: 503 });
  if (auth === "denied") return new Response(null, { status: 401 });

  const now = new Date();
  const appOrigin = configuredOrigin();
  let results: Record<string, PassCounters>;

  if (fanoutEnabled() && appOrigin) {
    // One client for the dispatcher's own heartbeats, built on the first one.
    let db: SupabaseClient | null = null;
    results = await runFanout({
      plan: PLAN, now,
      invoke: httpInvoke(appOrigin, process.env.CRON_SECRET!),
      beat: (key, outcome) => recordHeartbeat((db ??= serviceDb()), key, outcome),
    });
  } else {
    if (fanoutEnabled()) {
      console.error("cron: CRON_FANOUT is on but APP_ORIGIN is unset, so the single in-process tick runs");
    }
    // APP_ORIGIN wins when set (the custom domain); req.url's origin is only
    // the FALLBACK, and that fallback IS the deployment's vercel.app URL — the
    // exact link/sender mismatch Gmail silently discarded mail over.
    const origin = appOrigin ?? new URL(req.url).origin;
    const ctx = buildPassContext({ db: serviceDb(), now, origin });
    results = await runPasses(PASSES, ctx);
  }

  // The reminder pass's counters stay TOP-LEVEL and every other pass nests
  // under its key — byte-identical to what this route returned before the
  // harness existed, which is what lets route.test.ts stand unchanged as the
  // migration's proof. New passes appear as new keys beside `followups`.
  // One consequence to know when reading the cron log: if the reminder pass
  // itself errors outright, the top level carries `errored: 1` and no
  // `sent`/`failed`/`unstamped` keys for that tick (under fan-out also
  // `noAnswer` or `notStarted`).
  const { reminders, ...rest } = results;
  return Response.json({ ...reminders, ...rest });
}
