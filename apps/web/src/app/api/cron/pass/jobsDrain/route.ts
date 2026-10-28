import { handlePassRequest } from "@/lib/automations/pass-route";
import { jobsDrainPass } from "@/lib/automations/passes/jobs-drain";

export const dynamic = "force-dynamic";

// The jobs drain, in its own function (F-196). JOBS_DRAIN_MAX_S in
// lib/automations/fanout.ts is this number, and cron-coupling.test.ts reads
// this literal: the drain's budget (JOBS_DRAIN_BUDGET_MS, 200 s) plus 30 s
// for the sweep and the two queue reads must end inside it.
export const maxDuration = 300;

/**
 * The dispatcher POSTs here once per tick, with the cron bearer and the
 * tick's `{ now }`. A static segment, so Next routes `jobsDrain` here and not
 * to `[key]`, which knows only the registry's passes. POST only.
 */
export async function POST(req: Request): Promise<Response> {
  return handlePassRequest(req, jobsDrainPass);
}
