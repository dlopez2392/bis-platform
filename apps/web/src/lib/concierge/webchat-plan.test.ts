import { describe, it, expect } from "vitest";
import {
  planWebchatRows, matchedExistingCustomer, parseWebchatKey, webchatKey, WEBCHAT_MAX_ROWS_PER_CHAT, type WebchatTurn,
} from "@bis/db/webchat-plan";
import { CONCIERGE_MAX_TURNS } from "./guards";

/** S-06 part 3 (spec §2, §3 step 4, G1, G2, G5; plan G27). The REAL planner, through the subpath, never a mock. */
const CHAT = "11111111-1111-4111-8111-111111111111";
const SUB = "22222222-2222-4222-8222-222222222222";
const T = (ms: number) => new Date(Date.parse("2026-10-17T15:00:00.000Z") + ms).toISOString();
const turn = (role: WebchatTurn["role"], text: string, at: string): WebchatTurn => ({ role, text, at });
const plan = (transcript: WebchatTurn[], over: Partial<Parameters<typeof planWebchatRows>[0]> = {}) =>
  planWebchatRows({ chatId: CHAT, transcript, existing: [], locale: "es", submissionId: SUB, matchedExisting: false,
    leadAt: "2026-10-17T16:00:00+00:00", now: T(999_999), ...over });

describe("planWebchatRows: what a sync still has to write", () => {
  it("only the indices the thread does not hold, in index order, each keyed webchat:<chat>:<index> (mutation: plan every index → FAILS; key by text → FAILS)", () => {
    const tr = [turn("visitor", "hola", T(0)), turn("assistant", "¿En qué le ayudo?", T(0)), turn("visitor", "una mesa", T(9_000)), turn("assistant", "Claro", T(9_000))];
    const rows = plan(tr, { existing: [{ index: 1, createdAt: T(1) }, { index: 2, createdAt: T(9_000) }] });
    expect(rows.map((r) => [r.index, r.providerMessageId, r.body])).toEqual([
      [0, `webchat:${CHAT}:0`, "hola"], [3, `webchat:${CHAT}:3`, "Claro"],
    ]);
  });

  it("a retried POST's duplicated pair is two more indices, planned like any other (G2; mutation: skip a turn whose text equals an earlier one → FAILS)", () => {
    const tr = [turn("visitor", "hi", T(0)), turn("assistant", "Hello", T(0)), turn("visitor", "hi", T(0)), turn("assistant", "Hello", T(0))];
    expect(plan(tr).map((r) => r.index)).toEqual([0, 1, 2, 3]);
  });

  it("times strictly increase in index order: +1 ms on a tie, and never at or before an earlier row already written (G5; mutation: createdAt = at → the tie stays, FAILS; ignore `existing` → row 2 sorts before row 1, FAILS)", () => {
    const tied = plan([turn("visitor", "a", T(0)), turn("assistant", "b", T(0))]);
    expect(tied.map((r) => r.createdAt)).toEqual([T(0), T(1)]);
    // Two tabs: index 2's own `at` is EARLIER than the row already written at index 1.
    const healed = plan([turn("visitor", "a", T(0)), turn("assistant", "b", T(5)), turn("visitor", "c", T(2)), turn("assistant", "d", T(2))],
      { existing: [{ index: 0, createdAt: T(0) }, { index: 1, createdAt: "2026-10-17T15:00:00.005123+00:00" }] });
    expect(healed.map((r) => [r.index, r.createdAt])).toEqual([[2, T(6)], [3, T(7)]]);
  });

  it("nothing to plan for an empty transcript, or for one the thread already holds in full", () => {
    expect(plan([])).toEqual([]);
    expect(plan([turn("visitor", "a", T(0))], { existing: [{ index: 0, createdAt: T(0) }] })).toEqual([]);
  });

  it("the visitor's turn is inbound, Sofía's outbound; every row's meta names the chat, its index, the chat's own language, the lead and the match (spec §2, §5a; mutation: swap the directions → FAILS; drop matched_existing → FAILS)", () => {
    const rows = plan([turn("visitor", "a", T(0)), turn("assistant", "b", T(10))], { matchedExisting: true });
    expect(rows.map((r) => r.direction)).toEqual(["inbound", "outbound"]);
    expect(rows[1]!.meta).toEqual({ webchat: { chat_id: CHAT, index: 1, locale: "es", submission_id: SUB, matched_existing: true } });
    expect(plan([turn("visitor", "a", T(0))], { locale: "fr" })[0]!.meta.webchat.locale).toBe("en");
  });

  it("a visitor turn raises unread only when it arrived after the lead was on file; Sofía's never (G27; mutation: countsUnread = visitor → the pre-lead turn counts, FAILS; count Sofía → FAILS)", () => {
    const rows = plan([
      turn("visitor", "before the lead", "2026-10-17T15:59:59.000Z"), turn("assistant", "after", "2026-10-17T16:00:05.000Z"),
      turn("visitor", "after the lead", "2026-10-17T16:00:30.000Z"), turn("assistant", "after", "2026-10-17T16:00:31.000Z"),
    ]);
    expect(rows.map((r) => r.countsUnread)).toEqual([false, false, true, false]);
  });

  it("a visitor turn stamped at the lead's own instant does not count; one millisecond later does, even against a microsecond lead (G27 'later than'; mutation: `at >= leadAt` → the equal turn counts, FAILS)", () => {
    const at = (leadAt: string, visitorAt: string) => plan([turn("visitor", "x", visitorAt)], { leadAt })[0]!.countsUnread;
    expect(at("2026-10-17T16:00:00.000+00:00", "2026-10-17T16:00:00.000Z")).toBe(false);
    expect(at("2026-10-17T16:00:00.000500+00:00", "2026-10-17T16:00:00.000Z")).toBe(false);
    expect(at("2026-10-17T16:00:00.000500+00:00", "2026-10-17T16:00:00.001Z")).toBe(true);
  });

  it("an `at` that does not parse takes the previous row's time + 1 ms, or `now` when it is the first (mutation: new Date(NaN).toISOString() → throws, FAILS)", () => {
    expect(plan([turn("visitor", "a", T(0)), turn("assistant", "b", "garbage")]).map((r) => r.createdAt)).toEqual([T(0), T(1)]);
    expect(plan([turn("visitor", "a", "garbage")])[0]!.createdAt).toBe(T(999_999));
    expect(plan([turn("visitor", "a", "garbage")])[0]!.countsUnread).toBe(false);
  });
});

describe("matchedExistingCustomer (spec §5a, G19)", () => {
  it("a customer older than the lead's submission is a match; one created by it is not; equal reads as new; to the microsecond (mutation: `<=` → equal reads matched, FAILS; compare Date.parse → the 1 µs pair ties, FAILS)", () => {
    expect(matchedExistingCustomer("2026-09-01T10:00:00+00:00", "2026-10-17T16:00:00+00:00")).toBe(true);
    expect(matchedExistingCustomer("2026-10-17T16:00:00.250+00:00", "2026-10-17T16:00:00.100+00:00")).toBe(false);
    expect(matchedExistingCustomer("2026-10-17T16:00:00.100+00:00", "2026-10-17T16:00:00.100+00:00")).toBe(false);
    expect(matchedExistingCustomer("2026-10-17T16:00:00.100001+00:00", "2026-10-17T16:00:00.100002+00:00")).toBe(true);
    expect(matchedExistingCustomer("not a time", "2026-10-17T16:00:00+00:00")).toBe(false);
  });
});

describe("the key", () => {
  it("parses this chat's own key back to its index and refuses anything else (mutation: accept any prefix → another chat's key parses, FAILS)", () => {
    expect(parseWebchatKey(CHAT, webchatKey(CHAT, 7))).toBe(7);
    expect(parseWebchatKey(CHAT, `webchat:${SUB}:7`)).toBeNull();
    expect(parseWebchatKey(CHAT, `webchat:${CHAT}:07`)).toBeNull();
    expect(parseWebchatKey(CHAT, `webchat:${CHAT}:x`)).toBeNull();
    expect(parseWebchatKey(CHAT, null)).toBeNull();
  });

  it("a chat holds at most 48 rows: 24 claimed turns, one pair each (mutation: 40 → FAILS)", () => {
    expect(WEBCHAT_MAX_ROWS_PER_CHAT).toBe(CONCIERGE_MAX_TURNS * 2);
  });
});
