import { timingSafeEqual } from "node:crypto";
import { listHeartbeats, serviceDb } from "@bis/db";

export const dynamic = "force-dynamic";

/**
 * The operational floor's health check (spec §1), asked once an hour by
 * .github/workflows/ops-health.yml. It answers ONE question the alert pass
 * cannot: is the 15-minute cron still completing ticks? A pass cannot report
 * that the passes stopped running, so this is checked from outside.
 *
 * 200 `{ ok: true }` when the database answers and the last completed tick
 * (`cron.tick`, written by the harness at the end of every run) is under
 * STALE_AFTER_MS old. 503 otherwise, naming only WHICH check failed: never an
 * error message, a timestamp or a heartbeat's text. A health endpoint is read
 * by a workflow log anyone with repo access can open, so it says as little as
 * it can and still be acted on.
 *
 * AUTH. `OPS_HEALTH_SECRET`, a key that opens this route and nothing else. It
 * is deliberately not CRON_SECRET: the copy kept in GitHub must not be able to
 * run the passes. Unset → 503 to everyone (the workflow goes red, so a missed
 * setup step shows). Wrong or missing bearer → 401 with no body and zero
 * queries, compared in constant time like the cron route.
 */
export const STALE_AFTER_MS = 45 * 60_000; // three missed 15-minute ticks

export async function GET(req: Request): Promise<Response> {
  const secret = process.env.OPS_HEALTH_SECRET?.trim();
  if (!secret) return Response.json({ ok: false, failing: ["not_configured"] }, { status: 503 });

  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  if (got.length !== want.length || !timingSafeEqual(got, want)) {
    return new Response(null, { status: 401 });
  }

  let tickAt: string | null = null;
  try {
    const rows = await listHeartbeats(serviceDb());
    tickAt = rows.find((r) => r.key === "cron.tick")?.lastOkAt ?? null;
  } catch (e) {
    console.error(`ops health: database read failed: ${String(e)}`);
    return Response.json({ ok: false, failing: ["database"] }, { status: 503 });
  }

  const age = tickAt ? Date.now() - Date.parse(tickAt) : Number.POSITIVE_INFINITY;
  if (!(age < STALE_AFTER_MS)) {
    return Response.json({ ok: false, failing: ["cron.tick"] }, { status: 503 });
  }
  return Response.json({ ok: true });
}
