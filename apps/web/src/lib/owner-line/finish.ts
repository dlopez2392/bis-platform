// apps/web/src/lib/owner-line/finish.ts
import { finishCallRow, noteOwnerLineCall, type SupabaseClient } from "@bis/db";
import { recordUsageSafely, voiceMinutes } from "@/lib/billing/usage";
import { detectCallerLanguage } from "@/lib/voice/language";
import type { CallState } from "@/lib/voice/call-state";
import { LOG_KIND_OF, type OwnerToolName } from "./tools/schemas";
import type { OwnerLineSession } from "./session";

/** An error as a log line may name it: its class only (a message can quote a number, a name or a row). */
const errorClass = (e: unknown) => (e instanceof Error ? e.name : typeof e);

/**
 * F-032 §6, the "legs" pattern (finish-call.ts), each leg in its own try/catch, NEVER throws:
 *   1. the calls row: ended, duration, transcript (the PIN was never in it: §2.2). The outcome stays the column
 *      default `abandoned`. Every counting reader leaves the row out by owner_line_user_id (Task 2), so the outcome is
 *      not a metric anywhere;
 *   2. its minutes on the voice_minutes meter, when the person spoke (M7a: minutes for a call Sofía talked to; Q-B);
 *   3. the access-log entry: who, which business, when, which tools were asked for, on THIS call's own row id
 *      (note_owner_line_call does not check the call belongs to the account, so only this call's id is ever passed).
 * Nothing else: no contact, no conversation, no text-back, no staff alert, no call card, no callback To do, no
 * proposals, no automation log (so Activity's "calls handled" is unchanged), no event. A read is not a change (§6).
 * Logs carry the error class and the account only.
 */
export async function finishOwnerLineCall(
  state: CallState, ctx: { db: SupabaseClient; session: OwnerLineSession; ran: ReadonlySet<OwnerToolName> },
  meta: { callRowId: string | null; startedAt: Date; endedAt: Date },
): Promise<void> {
  const s = ctx.session;
  const durationSecs = Math.max(0, Math.round((meta.endedAt.getTime() - meta.startedAt.getTime()) / 1000));
  if (!meta.callRowId) {
    console.error(`[voice/owner-line] finish with no call row, accountId ${s.accountId}`);
    return;
  }
  try {
    await finishCallRow(ctx.db, s.accountId, meta.callRowId, {
      outcome: "abandoned", endedAt: meta.endedAt, durationSecs, turnCount: state.transcript.length,
      transcript: state.transcript, summary: "", language: detectCallerLanguage(state, s.locale),
    });
  } catch (e) {
    console.error(`[voice/owner-line] call row finish failed (${errorClass(e)}), accountId ${s.accountId}`);
  }
  if (state.transcript.some((x) => x.role === "caller")) {
    await recordUsageSafely(ctx.db, { accountId: s.accountId, meter: "voice_minutes", quantity: voiceMinutes(durationSecs),
      occurredAt: meta.endedAt, sourceRef: `call:${meta.callRowId}` }, `owner line ${meta.callRowId}`);
  }
  try {
    await noteOwnerLineCall(ctx.db, { accountId: s.accountId, callId: meta.callRowId, actorClerkUserId: s.clerkUserId,
      actorName: s.actorName, kinds: [...ctx.ran].map((n) => LOG_KIND_OF[n]) });
  } catch (e) {
    console.error(`[voice/owner-line] access-log entry failed (${errorClass(e)}), accountId ${s.accountId}`);
  }
}
