import { describe, it, expect } from "vitest";
import type { CallListRow } from "@bis/db";
import { textbackWindow, TEXTBACK_WINDOW_GRACE_MS } from "./textback-window";

// The correlation itself — which call a failed text-back belongs to. Pinned
// here rather than only through the pages, because the two scenarios that made
// this necessary are both about two CALLS, and neither is expressible against a
// single rendered row.

const CALL: CallListRow = {
  id: "call-morning",
  // Deliberately microsecond-precision, as Postgres returns it.
  started_at: "2026-09-04T14:00:00.123456+00:00",
  ended_at: "2026-09-04T14:00:38.000000+00:00",
  duration_secs: 38,
  outcome: "abandoned",
  language: "en",
  caller_e164: "+19565061545",
  contact_id: "ct1",
  conversation_id: "cv-shared",
  contact: null,
};

/** Is `at` inside the window this call owns? The question the db read asks of
 *  every failed row, restated here so the two scenarios can be checked without
 *  a database. */
function claims(call: CallListRow, at: string): boolean {
  const w = textbackWindow(call);
  if (!w) return false;
  const t = Date.parse(at);
  return t >= Date.parse(w.fromIso) && t < Date.parse(w.toIso);
}

describe("textbackWindow", () => {
  it("bounds the window by THIS call's own start and end, plus the grace", () => {
    const w = textbackWindow(CALL);

    expect(w).toEqual({
      callId: "call-morning",
      conversationId: "cv-shared",
      // Truncated to milliseconds, and truncation rounds DOWN — the lower
      // bound only ever widens, so it cannot drop a row that belongs.
      fromIso: "2026-09-04T14:00:00.123Z",
      toIso: new Date(Date.parse(CALL.ended_at!) + TEXTBACK_WINDOW_GRACE_MS).toISOString(),
    });
    // Five minutes. Stated as a literal rather than read off the constant: a
    // test that imports the number it is checking proves only that
    // multiplication works, and would stay green if someone quietly widened
    // this back out to an hour.
    expect(Date.parse(w!.toIso) - Date.parse(CALL.ended_at!)).toBe(5 * 60 * 1000);
  });

  /**
   * FINDING 1, THE FALSE POSITIVE — the reviewer's own scenario. The caller
   * abandons at 09:00 and is texted back. They abandon again at 14:00, and
   * `finishCall` stamps the conversation onto that second row BEFORE the 24h
   * cooldown suppresses its text-back, so no text is ever attempted for it. A
   * `delivery_failed` receipt then flips the 09:00 message to `failed`.
   *
   * Keyed on the conversation, the 14:00 row said "Text-back didn't send" about
   * a text-back that never existed. Keyed on the window, the 09:00 message is
   * five hours outside it.
   */
  it("does not let a later call claim an earlier call's failed message", () => {
    const morning = { ...CALL, id: "call-0900", started_at: "2026-09-04T09:00:00.000000+00:00", ended_at: "2026-09-04T09:00:41.000000+00:00" };
    const afternoon = { ...CALL, id: "call-1400", started_at: "2026-09-04T14:00:00.000000+00:00", ended_at: "2026-09-04T14:00:33.000000+00:00" };
    // Both calls, one contact, ONE conversation — that is the whole trap.
    expect(morning.conversation_id).toBe(afternoon.conversation_id);

    // The text-back written by the 09:00 call's own finishCall run.
    const message = "2026-09-04T09:00:52.000000+00:00";

    expect(claims(morning, message)).toBe(true);
    expect(claims(afternoon, message)).toBe(false);
    // …and the reverse: nothing written around the 14:00 call reaches back.
    expect(claims(morning, "2026-09-04T14:00:44.000000+00:00")).toBe(false);
  });

  /**
   * FINDING 1, THE FALSE NEGATIVE. The window says nothing about what happened
   * LATER in the thread, which is the point: a manual reply that afternoon, or
   * the operator's own successful resend, used to erase the badge entirely and
   * nothing else in the product recorded that the text-back had failed.
   */
  it("still claims a failed message after a later outbound text in the same conversation", () => {
    // Two hours later, same conversation, sent fine. Outside this window, and
    // therefore not this window's business.
    expect(claims(CALL, "2026-09-04T16:11:00.000000+00:00")).toBe(false);
    // The failure itself is claimed exactly as before.
    expect(claims(CALL, "2026-09-04T14:00:47.000000+00:00")).toBe(true);
  });

  it("covers finishCall's real latency and closes right after it", () => {
    // `generateSummary` aborts at 10s and three Supabase round trips follow, so
    // a text-back row a minute after hangup is still plausible; one an hour
    // later is a different call or a different message entirely.
    expect(claims(CALL, "2026-09-04T14:01:38.000000+00:00")).toBe(true);
    expect(claims(CALL, "2026-09-04T14:05:37.999000+00:00")).toBe(true);
    expect(claims(CALL, "2026-09-04T14:05:38.000000+00:00")).toBe(false);
    expect(claims(CALL, "2026-09-04T15:00:00.000000+00:00")).toBe(false);
    // A message written DURING the call is still this call's — the lower bound
    // is `started_at`, so app-vs-database clock skew around the hangup cannot
    // drop a real failure.
    expect(claims(CALL, "2026-09-04T14:00:20.000000+00:00")).toBe(true);
    // One written before the call started is not.
    expect(claims(CALL, "2026-09-04T13:59:59.000000+00:00")).toBe(false);
  });

  it("refuses to build a window for anything that cannot own a text-back", () => {
    // The text-back fires on `abandoned` and nothing else (finish-call.ts).
    for (const outcome of ["booked", "lead", "message", "spam"] as const) {
      expect(textbackWindow({ ...CALL, outcome })).toBeNull();
    }
    // Nothing to look under — every call before the text-back shipped.
    expect(textbackWindow({ ...CALL, conversation_id: null })).toBeNull();
    // No end: the row write failed, or the call is still live. Nothing bounds
    // it, and an unbounded window is the conversation-wide claim this exists to
    // stop making.
    expect(textbackWindow({ ...CALL, ended_at: null })).toBeNull();
    // Garbage timestamps, and a row that ended before it began.
    expect(textbackWindow({ ...CALL, started_at: "not a date" })).toBeNull();
    expect(textbackWindow({ ...CALL, ended_at: "not a date" })).toBeNull();
    expect(textbackWindow({
      ...CALL, started_at: "2026-09-04T14:00:00Z", ended_at: "2026-09-04T13:00:00Z",
    })).toBeNull();
  });
});
