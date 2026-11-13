import type { SupabaseClient } from "@supabase/supabase-js";
import type { TablesInsert } from "./database.types";

/**
 * One call's OpenAI usage (0116's `call_usage`), recorded once when the call finishes, so BIS can measure what a
 * minute of Sofia really costs. BIS's own cost data: the agency reads it, no client role does.
 *
 * Writes need serviceDb(): 0116 grants `authenticated` SELECT only, under an agency-only policy.
 * Idempotent on `call_id`: a retried finish is `on conflict (call_id) do nothing`, so it neither double-counts
 * nor overwrites the first write, and reports "duplicate". Throws on any database error; the app's caller wraps
 * it in a never-throw guard (the recordUsage / recordUsageSafely pairing in apps/web/src/lib/billing/usage.ts).
 */
export type CallUsageInput = {
  callId: string;
  /** The call's OWN account. Nothing in the schema ties it to calls.account_id; the caller must pass that value. */
  accountId: string;
  /** The Realtime model id, 1 to 64 characters. */
  model: string;
  /** How many model responses the call had. */
  responses: number;
  inputTextTokens: number;
  inputAudioTokens: number;
  inputCachedTextTokens: number;
  inputCachedAudioTokens: number;
  outputTextTokens: number;
  outputAudioTokens: number;
  /** The caller-speech transcription model, when one ran. It reports tokens OR seconds; leave the other unset. */
  transcribeModel?: string | null;
  transcribeInputTokens?: number | null;
  transcribeOutputTokens?: number | null;
  transcribeSeconds?: number | null;
  /** An ESTIMATE in whole micro-dollars, from the app's own price table. */
  estCostMicrousd: number;
};

export async function recordCallUsage(db: SupabaseClient, input: CallUsageInput): Promise<"recorded" | "duplicate"> {
  // Typed from the generated schema: a renamed or retyped call_usage column fails tsc here, not at run time.
  const row: TablesInsert<"call_usage"> = {
    call_id: input.callId, account_id: input.accountId, model: input.model, responses: input.responses,
    input_text_tokens: input.inputTextTokens, input_audio_tokens: input.inputAudioTokens,
    input_cached_text_tokens: input.inputCachedTextTokens, input_cached_audio_tokens: input.inputCachedAudioTokens,
    output_text_tokens: input.outputTextTokens, output_audio_tokens: input.outputAudioTokens,
    transcribe_model: input.transcribeModel ?? null,
    transcribe_input_tokens: input.transcribeInputTokens ?? null,
    transcribe_output_tokens: input.transcribeOutputTokens ?? null,
    transcribe_seconds: input.transcribeSeconds ?? null,
    est_cost_microusd: input.estCostMicrousd,
  };
  const { data, error } = await db.from("call_usage")
    .upsert(row, { onConflict: "call_id", ignoreDuplicates: true })
    .select("call_id");
  if (error) throw new Error(`recordCallUsage failed: ${error.message}`);
  return (data ?? []).length === 1 ? "recorded" : "duplicate";
}
