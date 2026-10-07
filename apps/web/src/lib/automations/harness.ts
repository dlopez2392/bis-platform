import { recordHeartbeat, type SupabaseClient } from "@bis/db";
import { smsSenderFor } from "@/lib/consent/gate";
import { emailSenderFor } from "@/lib/consent/email-gate";
import type { Pass, PassContext, PassCounters } from "./context";

/**
 * Builds a tick's context. No automations module imports a provider factory
 * (imports.test.ts): since the consent chain's PR-1 a pass texts only through
 * `ctx.sms` (the SMS gate) and since PR-3 it emails only through `ctx.email`
 * (the email gate, lib/consent/email-gate.ts). Each gate is the only module
 * outside its provider's own files that may reach that provider
 * (lib/consent/scans.test.ts).
 */
export function buildPassContext(
  input: { db: SupabaseClient; now: Date; origin: string },
): PassContext {
  return { ...input, email: emailSenderFor(input.db), sms: smsSenderFor(input.db) };
}

/**
 * Runs every pass in order, each inside its own try/catch — the `finishCall`
 * legs pattern. A pass whose `run` rejects OUTRIGHT (its due-query throwing,
 * say) is reported under its own key as `{ errored: 1 }` and the tick goes on
 * to the next pass; a send failing INSIDE a pass is that pass's business and
 * shows up in its own counters. Sequential, not parallel, on purpose: the
 * follow-up pass stamps `followup_sent_at` and the review-request pass reads
 * it in the same tick, so order is part of the contract (see registry.ts).
 */
export async function runPasses(
  passes: readonly Pass[], ctx: PassContext, beat: HeartbeatWriter = defaultBeat,
): Promise<Record<string, PassCounters>> {
  const results: Record<string, PassCounters> = {};
  for (const pass of passes) {
    let outcome: HeartbeatOutcome = { ok: true };
    try {
      results[pass.key] = await pass.run(ctx);
    } catch (e) {
      results[pass.key] = { errored: 1 };
      outcome = { ok: false, error: String(e) };
      console.error(`automation pass ${pass.key} failed outright: ${String(e)}`);
    }
    // AFTER the pass and OUTSIDE its try: a heartbeat is a record of what the
    // pass did, so it can never be the reason a pass failed. Awaited, in
    // order, so the alert pass (registered last) reads this tick's rows.
    await safeBeat(beat, ctx, `cron.pass.${pass.key}`, outcome);
  }
  // The tick completed. `/api/ops/health` reads this one row: no completed
  // tick for 45 minutes is what the hourly GitHub check alerts on.
  await safeBeat(beat, ctx, "cron.tick", { ok: true });
  return results;
}

/**
 * The operational floor's heartbeats (spec §1): one row per pass and one for
 * the tick, written by the service role. Injectable so tests can see the
 * writes without a database; production uses `recordHeartbeat`, which already
 * swallows its own failures. `safeBeat` guards a writer that throws anyway.
 */
export type HeartbeatOutcome = { ok: true } | { ok: false; error: string };
export type HeartbeatWriter = (ctx: PassContext, key: string, outcome: HeartbeatOutcome) => Promise<void>;
const defaultBeat: HeartbeatWriter = (ctx, key, outcome) => recordHeartbeat(ctx.db, key, outcome);

async function safeBeat(beat: HeartbeatWriter, ctx: PassContext, key: string, outcome: HeartbeatOutcome): Promise<void> {
  try {
    await beat(ctx, key, outcome);
  } catch (e) {
    console.error(`heartbeat ${key} not written: ${String(e)}`);
  }
}
