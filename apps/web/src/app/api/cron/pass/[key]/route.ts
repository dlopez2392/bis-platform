import { handlePassRequest } from "@/lib/automations/pass-route";
import { PASSES } from "@/lib/automations/registry";

export const dynamic = "force-dynamic";

// One pass, in its own function (F-196). PASS_ROUTE_MAX_S in
// lib/automations/fanout.ts is this number, and cron-coupling.test.ts reads
// this literal: every budgeted pass, plus the send in flight past its budget,
// must end inside it, and the dispatcher's plan is built from it.
export const maxDuration = 90;

type Params = { params: Promise<{ key: string }> };

/**
 * The dispatcher (`/api/cron/reminders` with `CRON_FANOUT=1`) POSTs here once
 * per plan node, with the cron bearer and the tick's `{ now }`. POST only: Next
 * answers a GET with 405. The jobs drain has its own route beside this one,
 * with its own ceiling. Everything else is `handlePassRequest`.
 */
export async function POST(req: Request, { params }: Params): Promise<Response> {
  const { key } = await params;
  return handlePassRequest(req, PASSES.find((p) => p.key === key) ?? null);
}
