import type { SupabaseClient } from "@bis/db";
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
