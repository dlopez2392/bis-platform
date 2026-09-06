// apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calls/textback-window.ts
//
// WHICH CALL a failed text-back belongs to. Shared by the calls list
// (page.tsx) and the call detail page ([callId]/page.tsx) so both surfaces
// answer that question the same way, rather than agreeing by coincidence.
import type { CallListRow, TextbackWindow } from "@bis/db";

/**
 * How long after the caller hangs up a text-back row may still appear.
 *
 * `messages` has no call id and this change ships no migration to add one, so
 * TIME is the only thing that can tie a failed outbound SMS to a particular
 * call. `finishCall` (lib/voice/finish-call.ts) writes the text-back row during
 * its own run, which starts the moment the call ends: `generateSummary` first,
 * which aborts hard at 10s (summary-service.ts), then three Supabase round
 * trips — resolve the contact, ensure the conversation, check the 24h cooldown
 * — and then the insert. Twelve seconds is the realistic ceiling.
 *
 * Five minutes is ~25× that. Deliberately generous rather than snug, because
 * the two errors are not symmetrical: too tight and a real failure shows no
 * badge at all, which is the state this whole feature exists to end (nothing
 * else in the product records that a text-back failed). Too loose and an
 * unrelated message gets misread — which additionally requires that message to
 * have FAILED, inside those same five minutes.
 *
 * It is also three orders of magnitude tighter than what it replaces: keyed on
 * the conversation, a 09:00 call and a 14:00 call from the same person shared
 * one answer, because a conversation is one-per-CONTACT and spans every call
 * that person ever made.
 */
export const TEXTBACK_WINDOW_GRACE_MS = 5 * 60 * 1000;

/**
 * The window inside which THIS call's text-back, if it sent one, was written —
 * `[started_at, ended_at + 5 min)`. `null` means "do not ask": there is no
 * window this call could own, so it gets no badge rather than a borrowed one.
 *
 * The lower bound is `started_at`, not `ended_at`, on purpose. Both
 * `calls.started_at` and `messages.created_at` are Postgres defaults, so they
 * come off ONE clock and the comparison carries no skew; `ended_at` is written
 * by the app server from its own `new Date()`, and a text-back row lands only
 * seconds after it, which is well inside the skew two machines can have. Using
 * it as the lower bound would drop real failures whenever the database clock
 * ran behind. It is safe on the UPPER bound because five minutes of grace
 * swamps any skew there.
 *
 * Three reasons to return null:
 *
 * - Not `abandoned`. The text-back fires on no other outcome (finish-call.ts),
 *   so no other outcome can own a failed one. The reviewer confirmed this
 *   narrowing is correct; it is simply not sufficient on its own, which is why
 *   the window exists.
 * - No `conversation_id`. Nothing to look under: every call before the
 *   text-back shipped, and every account with it switched off.
 * - No `ended_at`. Two shapes reach this: a call still in progress right now
 *   (which has not run `finishCall` at all, so it has no text-back to fail),
 *   and a call whose `finishCallRow` write failed. Neither can be bounded, and
 *   an unbounded window is exactly the conversation-wide claim this file
 *   exists to stop making — so it claims nothing. In practice this branch is
 *   unreachable: `finishCallRow` stamps `ended_at` and `conversation_id` in one
 *   UPDATE, so a row with a conversation always has an end. It is a guard for
 *   the day that stops being true, not live behaviour.
 *
 * KNOWN RESIDUALS, both narrow and both preferred to what they replace:
 *
 * 1. A MANUAL text that also failed, sent inside the window. `messages` has no
 *    actor column, so an operator who texted this caller within five minutes of
 *    the hangup AND had that text refused by the carrier reads as a failed
 *    text-back. Both halves have to happen, in that window, for one call.
 * 2. A REDIAL inside `finishCall`'s own run. If the caller hangs up and calls
 *    straight back before the first call's text-back row is written, that row
 *    falls inside both calls' windows and both rows badge. The second call's
 *    text-back was suppressed by the 24h cooldown, so only one text was ever
 *    attempted — but nothing on file says which call attempted it. Requires a
 *    redial within roughly ten seconds of hanging up.
 */
export function textbackWindow(
  call: Pick<CallListRow, "id" | "outcome" | "conversation_id" | "started_at" | "ended_at">,
): TextbackWindow | null {
  if (call.outcome !== "abandoned") return null;
  if (!call.conversation_id || !call.ended_at) return null;

  const from = Date.parse(call.started_at);
  const to = Date.parse(call.ended_at) + TEXTBACK_WINDOW_GRACE_MS;
  // A row whose timestamps do not parse, or that ended before it started, is
  // not a call this can reason about. Silence, not a guess.
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return null;

  return {
    callId: call.id,
    conversationId: call.conversation_id,
    fromIso: new Date(from).toISOString(),
    toIso: new Date(to).toISOString(),
  };
}
