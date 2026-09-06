import type { SupabaseClient } from "@bis/db";
import { getEmailProvider } from "@/lib/email";
import { getSmsProvider } from "@/lib/sms";
import type { SmsProvider } from "@/lib/sms/types";
import type { Pass, PassContext, PassCounters } from "./context";

/**
 * THE ONLY automations module allowed to import the provider factories —
 * imports.test.ts scans every other file under lib/automations for exactly
 * these imports. Everything a pass sends goes through the two factories'
 * production guard (VERCEL_ENV AND NODE_ENV), because there is no other way
 * for a pass to obtain a provider.
 */
export function buildPassContext(
  input: { db: SupabaseClient; now: Date; origin: string },
): PassContext {
  let sms: SmsProvider | null = null;
  return {
    ...input,
    email: getEmailProvider(),
    sms: () => (sms ??= getSmsProvider()),
  };
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
