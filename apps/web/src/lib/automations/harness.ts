import type { SupabaseClient } from "@bis/db";
import { getEmailProvider } from "@/lib/email";
import { smsSenderFor } from "@/lib/consent/gate";
import type { Pass, PassContext, PassCounters } from "./context";

/**
 * THE ONLY automations module allowed to import the EMAIL provider factory —
 * imports.test.ts scans every other file under lib/automations for it.
 * Everything a pass emails goes through the factory's production guard
 * (VERCEL_ENV AND NODE_ENV). Texts no longer come from a factory here: since
 * the consent chain's PR-1 the only way a pass texts is `ctx.sms`, which is
 * the send gate (lib/consent/gate.ts), and the gate is the only module
 * outside lib/sms that may reach an SMS provider (lib/consent/scans.test.ts).
 */
export function buildPassContext(
  input: { db: SupabaseClient; now: Date; origin: string },
): PassContext {
  return { ...input, email: getEmailProvider(), sms: smsSenderFor(input.db) };
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
  passes: readonly Pass[], ctx: PassContext,
): Promise<Record<string, PassCounters>> {
  const results: Record<string, PassCounters> = {};
  for (const pass of passes) {
    try {
      results[pass.key] = await pass.run(ctx);
    } catch (e) {
      results[pass.key] = { errored: 1 };
      console.error(`automation pass ${pass.key} failed outright: ${String(e)}`);
    }
  }
  return results;
}
