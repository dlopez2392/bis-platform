import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateSummary } from "./summary-service";
import { classifyOutcome, emptyCallState, withTranscript, withBooking } from "./call-state";
import { summaryFactLine } from "./summarize";

beforeEach(() => { process.env.OPENAI_API_KEY = "sk-test"; });

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
    const out = await generateSummary(s, { fetchImpl: fetchImpl as unknown as typeof fetch });
    const body = JSON.parse(fetchImpl.mock.calls[0]![1]!.body);
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.messages[0].content).toContain("authoritative");
    expect(out).toContain("RECORDED");
    expect(out).toContain("Caller asked about hours.");
  });
  it("a failed request still yields the fact line", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("down"));
    const out = await generateSummary(callerSpoke(), { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(out).toContain("RECORDED");
    expect(out).toContain("no appointment was recorded");
  });
  it("the request carries an abort signal — a hung connection must not stall finishCall forever", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ choices: [{ message: { content: "x" } }] }),
    });
    await generateSummary(callerSpoke(), { fetchImpl: fetchImpl as unknown as typeof fetch });
    const init = fetchImpl.mock.calls[0]![1]!;
    expect(init.signal).toBeDefined();
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it("a timeout (AbortSignal firing) still yields the fact-line summary, not a hang", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new DOMException("The operation timed out.", "TimeoutError"));
    const out = await generateSummary(callerSpoke(), { fetchImpl: fetchImpl as unknown as typeof fetch });
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
    await generateSummary(s, { timezone: "America/Chicago", fetchImpl: fetchImpl as unknown as typeof fetch });
    const body = JSON.parse(fetchImpl.mock.calls[0]![1]!.body);
    const systemContent = body.messages[0].content as string;
    expect(systemContent).toContain("America/Chicago");
    expect(systemContent).toContain("Never present a UTC time as if it were local");
  });
  it("a spam call never reaches the model — there is no caller speech to summarize", async () => {
    const fetchImpl = vi.fn();
    const s = silentCaller();
    expect(classifyOutcome(s)).toBe("spam");
    const out = await generateSummary(s, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(out).toBe(summaryFactLine(s));
  });
  it("a connect timeout — no transcript at all — never reaches the model either", async () => {
    const fetchImpl = vi.fn();
    const s = emptyCallState();
    expect(classifyOutcome(s)).toBe("spam");
    await generateSummary(s, { timezone: "America/Chicago", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("an abandoned call DOES reach the model — the caller spoke, so there is something to summarize", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ choices: [{ message: { content: "Caller asked about pricing and hung up." } }] }),
    });
    const s = withTranscript(silentCaller(), { role: "caller", text: "how much for a roof?", at: "t" });
    expect(classifyOutcome(s)).toBe("abandoned");
    const out = await generateSummary(s, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out).toContain("Caller asked about pricing and hung up.");
  });
  it("no timezone in opts omits the timezone instruction entirely", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ choices: [{ message: { content: "x" } }] }),
    });
    await generateSummary(callerSpoke(), { fetchImpl: fetchImpl as unknown as typeof fetch });
    const body = JSON.parse(fetchImpl.mock.calls[0]![1]!.body);
    const systemContent = body.messages[0].content as string;
    expect(systemContent).not.toContain("Never present a UTC time as if it were local");
  });
});
