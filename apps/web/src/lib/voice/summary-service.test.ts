import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateSummary } from "./summary-service";
import { classifyOutcome, emptyCallState, withTranscript, withBooking } from "./call-state";
import { summaryFactLine } from "./summarize";
import { openGateDb } from "@/lib/ai/testing/open-gate";

beforeEach(() => { process.env.OPENAI_API_KEY = "sk-test"; });
const GATE = { db: openGateDb().db, accountId: "acct", timezone: undefined as string | undefined };

/** A call the classifier scores `spam`: the assistant spoke, the caller never did. */
function silentCaller() {
  return withTranscript(emptyCallState(), { role: "assistant", text: "Hi, this is Sofía.", at: "t" });
}

/**
 * A call that REACHES the model. `emptyCallState()` classifies `spam`, which
 * now returns the fact line without a request at all — so every test below
 * whose subject is the request itself (its body, its abort signal, what a
 * failure does to it) has to start from caller speech, or it asserts against a
 * fetch that was never made and can no longer fail on its own claim.
 */
function callerSpoke() {
  return withTranscript(emptyCallState(), { role: "caller", text: "are you open saturday?", at: "t" });
}

describe("generateSummary", () => {
  it("sends gpt-4o-mini with the authoritative-records system rules and composes", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ choices: [{ message: { content: "Caller asked about hours. No appointment was recorded." } }] }),
    });
    const s = withTranscript(emptyCallState(), { role: "caller", text: "what are your hours?", at: "t" });
    const out = await generateSummary(s, { ...GATE, fetchImpl: fetchImpl as unknown as typeof fetch });
    const body = JSON.parse(fetchImpl.mock.calls[0]![1]!.body);
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.messages[0].content).toContain("authoritative");
    expect(out).toContain("RECORDED");
    expect(out).toContain("Caller asked about hours.");
  });
  it("a failed request still yields the fact line", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("down"));
    const out = await generateSummary(callerSpoke(), { ...GATE, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(out).toContain("RECORDED");
    expect(out).toContain("no appointment was recorded");
  });
  it("the request carries an abort signal — a hung connection must not stall finishCall forever", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ choices: [{ message: { content: "x" } }] }),
    });
    await generateSummary(callerSpoke(), { ...GATE, fetchImpl: fetchImpl as unknown as typeof fetch });
    const init = fetchImpl.mock.calls[0]![1]!;
    expect(init.signal).toBeDefined();
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it("a timeout (AbortSignal firing) still yields the fact-line summary, not a hang", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new DOMException("The operation timed out.", "TimeoutError"));
    const out = await generateSummary(callerSpoke(), { ...GATE, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(out).toContain("RECORDED");
    expect(out).toContain("no appointment was recorded");
  });
  it("a timezone in opts instructs the model to state times in that local zone, never raw UTC", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ choices: [{ message: { content: "Booked for 9:00 AM Central." } }] }),
    });
    const s = withBooking(emptyCallState(), {
      id: "bk1", contactName: "Ana", startsAt: "2026-08-31T14:00:00.000Z", endsAt: "2026-08-31T15:00:00.000Z",
    });
    await generateSummary(s, { ...GATE, timezone: "America/Chicago", fetchImpl: fetchImpl as unknown as typeof fetch });
    const body = JSON.parse(fetchImpl.mock.calls[0]![1]!.body);
    const systemContent = body.messages[0].content as string;
    expect(systemContent).toContain("America/Chicago");
    expect(systemContent).toContain("Never present a UTC time as if it were local");
  });
  it("a spam call never reaches the model — there is no caller speech to summarize", async () => {
    const fetchImpl = vi.fn();
    const s = silentCaller();
    expect(classifyOutcome(s)).toBe("spam");
    const out = await generateSummary(s, { ...GATE, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(out).toBe(summaryFactLine(s));
  });
  it("a connect timeout — no transcript at all — never reaches the model either", async () => {
    const fetchImpl = vi.fn();
    const s = emptyCallState();
    expect(classifyOutcome(s)).toBe("spam");
    await generateSummary(s, { ...GATE, timezone: "America/Chicago", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("an abandoned call DOES reach the model — the caller spoke, so there is something to summarize", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ choices: [{ message: { content: "Caller asked about pricing and hung up." } }] }),
    });
    const s = withTranscript(silentCaller(), { role: "caller", text: "how much for a roof?", at: "t" });
    expect(classifyOutcome(s)).toBe("abandoned");
    const out = await generateSummary(s, { ...GATE, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out).toContain("Caller asked about pricing and hung up.");
  });
  it("no timezone in opts omits the timezone instruction entirely", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ choices: [{ message: { content: "x" } }] }),
    });
    await generateSummary(callerSpoke(), { ...GATE, fetchImpl: fetchImpl as unknown as typeof fetch });
    const body = JSON.parse(fetchImpl.mock.calls[0]![1]!.body);
    const systemContent = body.messages[0].content as string;
    expect(systemContent).not.toContain("Never present a UTC time as if it were local");
  });
  // Owner decision A (2026-10-10): Sofía's call summaries stay ENGLISH for
  // every account, Spanish ones included — summarize.ts's BOOKING_CLAIM /
  // INTAKE_CLAIM mismatch guards are English regexes and only stay valid
  // over English prose. There is no language option any more; a stray one
  // (an old caller, a cast) must not be able to switch the prompt.
  it("a stray language option cannot switch the summary out of English (owner decision A; mutation: restore the opts.language === \"es\" branch → FAILS, the prompt asks for español)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ choices: [{ message: { content: "x" } }] }),
    });
    const opts = { ...GATE, language: "es", fetchImpl } as unknown as Parameters<typeof generateSummary>[1];
    await generateSummary(callerSpoke(), opts);
    const body = JSON.parse(fetchImpl.mock.calls[0]![1]!.body);
    const systemContent = body.messages[0].content as string;
    expect(systemContent).toContain("Always write the summary in English (it is staff-facing), regardless of the language spoken on the call.");
    expect(systemContent).not.toMatch(/español/i);
  });
  it("the English rule keeps the quote clause: a caller's quoted words stay in the language they spoke (mutation: drop the quote clause → FAILS)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ choices: [{ message: { content: "x" } }] }),
    });
    await generateSummary(callerSpoke(), { ...GATE, fetchImpl: fetchImpl as unknown as typeof fetch });
    const body = JSON.parse(fetchImpl.mock.calls[0]![1]!.body);
    const systemContent = body.messages[0].content as string;
    expect(systemContent).toContain("If you quote the caller, keep the quote in the language the caller spoke.");
  });
  it("a switched-off account gets the fact line and makes no request (spec 3.2; mutation: fall through to the fetch when the gateway refuses -> FAILS)", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchImpl = vi.fn();
    const s = callerSpoke();
    const out = await generateSummary(s, { ...GATE, db: openGateDb({ gate: { account_enabled: false } }).db, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(out).toBe(summaryFactLine(s));
  });
  // S-47b, owner ruling B7: on an insurance account the summary never sees an ID number, and is told never
  // to repeat one. The rule is the LAST sentence, after the timezone rule (re-review R4).
  describe("protectIds (insurance accounts, B7)", () => {
    const RULE = "Never repeat an identification number (SSN, driver's licence, policy number).";
    const ssnCall = () => withTranscript(emptyCallState(), { role: "caller", text: "my social is 123-45-6789", at: "t" });
    const sent = async (opts: { timezone?: string; protectIds?: boolean }) => {
      const fetchImpl = vi.fn().mockResolvedValue({
        ok: true, json: async () => ({ choices: [{ message: { content: "x" } }] }),
      });
      await generateSummary(ssnCall(), { ...GATE, ...opts, fetchImpl: fetchImpl as unknown as typeof fetch });
      const body = JSON.parse(fetchImpl.mock.calls[0]![1]!.body);
      return { system: body.messages[0].content as string, user: body.messages[1].content as string };
    };

    it("with a timezone: the user message carries [ID number], never the number, and the rule ends the system message", async () => {
      const { system, user } = await sent({ timezone: "America/Chicago", protectIds: true });
      expect(user).toContain("my social is [ID number]");
      expect(user).not.toContain("6789");
      expect(system).toContain("America/Chicago");
      expect(system.endsWith(RULE)).toBe(true);
    });

    it("with no timezone: the rule still ends the system message", async () => {
      const { system, user } = await sent({ protectIds: true });
      expect(user).toContain("my social is [ID number]");
      expect(system.endsWith(RULE)).toBe(true);
    });

    it("absent: every other account is byte-identical, the number reaches the model and there is no such line (mutation: mask always → FAILS)", async () => {
      const { system, user } = await sent({ timezone: "America/Chicago" });
      expect(user).toContain("my social is 123-45-6789");
      expect(system).not.toContain("identification number");
    });
  });

  it("records one call_summary ledger row for this account (mutation: feature 'call_card' -> FAILS)", async () => {
    const { db, calls } = openGateDb();
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "x" } }], usage: { prompt_tokens: 10, completion_tokens: 2 } })));
    await generateSummary(callerSpoke(), { ...GATE, db, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(calls.filter((c) => c.fn === "ai_ledger_record").map((c) => [c.args.p_account, c.args.p_feature, c.args.p_outcome])).toEqual([["acct", "call_summary", "ok"]]);
  });
});
