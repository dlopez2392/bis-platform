import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withTestAccount, testPhoneNumber } from "./fixtures";
import { assignPhoneNumber, startCallRow } from "../voice";
import { recordCallUsage, type CallUsageInput } from "../call-usage";
import { recordCallUsage as barrelRecordCallUsage } from "../index";

/**
 * 0116: `recordCallUsage` writes one `call_usage` row per call through the service client, and a retried
 * finish neither double-counts nor throws. Live: needs PostgREST (CI's per-run stack, or a local one).
 */
async function seedCall(db: SupabaseClient, accountId: string): Promise<string> {
  const num = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, "user_test");
  const call = await startCallRow(db, accountId, { phoneNumberId: num.id, callerE164: null });
  return call.id;
}

const usage = (callId: string, accountId: string, over: Partial<CallUsageInput> = {}): CallUsageInput => ({
  callId, accountId, model: "gpt-realtime", responses: 4,
  inputTextTokens: 1500, inputAudioTokens: 2200, inputCachedTextTokens: 900, inputCachedAudioTokens: 300,
  outputTextTokens: 120, outputAudioTokens: 1800,
  transcribeModel: "gpt-4o-mini-transcribe", transcribeInputTokens: 410, transcribeOutputTokens: 52, transcribeSeconds: 31.5,
  estCostMicrousd: 61234,
  ...over,
});

async function readRow(db: SupabaseClient, callId: string) {
  const { data, error } = await db.from("call_usage").select("*").eq("call_id", callId);
  expect(error, `call_usage read failed: ${error?.message}`).toBeNull();
  return data ?? [];
}

describe("recordCallUsage (0116)", () => {
  it("writes one row with every column mapped from its camelCase twin (mutation: swap two token fields -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const callId = await seedCall(db, accountId);
      expect(await recordCallUsage(db, usage(callId, accountId))).toBe("recorded");
      const rows = await readRow(db, callId);
      expect(rows).toHaveLength(1);
      const { created_at, ...rest } = rows[0] as Record<string, unknown>;
      expect(typeof created_at).toBe("string");
      expect(rest).toEqual({
        call_id: callId, account_id: accountId, model: "gpt-realtime", responses: 4,
        input_text_tokens: 1500, input_audio_tokens: 2200, input_cached_text_tokens: 900, input_cached_audio_tokens: 300,
        output_text_tokens: 120, output_audio_tokens: 1800,
        transcribe_model: "gpt-4o-mini-transcribe", transcribe_input_tokens: 410, transcribe_output_tokens: 52, transcribe_seconds: 31.5,
        est_cost_microusd: 61234,
      });
    });
  });

  it("a transcription reported in seconds only stores the token columns as null, not zero (mutation: `?? 0` on the transcription tokens -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const callId = await seedCall(db, accountId);
      await recordCallUsage(db, usage(callId, accountId, {
        transcribeModel: "whisper-1", transcribeInputTokens: undefined, transcribeOutputTokens: undefined, transcribeSeconds: 42,
      }));
      expect(await readRow(db, callId)).toMatchObject([
        { transcribe_model: "whisper-1", transcribe_input_tokens: null, transcribe_output_tokens: null, transcribe_seconds: 42 }]);
    });
  });

  it("a retried finish for the same call is a no-op: no throw, the first write stands, nothing is added (mutations: drop ignoreDuplicates -> the retry overwrites and reads 'recorded'; a plain insert -> the retry throws on call_usage_pkey -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const callId = await seedCall(db, accountId);
      expect(await recordCallUsage(db, usage(callId, accountId))).toBe("recorded");
      expect(await recordCallUsage(db, usage(callId, accountId, { outputAudioTokens: 99999, estCostMicrousd: 1 }))).toBe("duplicate");
      expect(await readRow(db, callId)).toMatchObject([{ output_audio_tokens: 1800, est_cost_microusd: 61234 }]);
    });
  });

  it("throws, naming itself, on a database error (mutation: return instead of throw on error -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const callId = await seedCall(db, accountId);
      await expect(recordCallUsage(db, usage(callId, accountId, { outputAudioTokens: -1 })))
        .rejects.toThrow(/^recordCallUsage failed: .*call_usage_output_audio_tokens_check/);
      expect(await readRow(db, callId)).toEqual([]);
    });
  });

  it("is exported from the package barrel", () => {
    expect(barrelRecordCallUsage).toBe(recordCallUsage);
  });
});
