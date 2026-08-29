import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateSummary } from "./summary-service";
import { emptyCallState, withTranscript, withBooking } from "./call-state";

beforeEach(() => { process.env.OPENAI_API_KEY = "sk-test"; });

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
    const out = await generateSummary(emptyCallState(), { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(out).toContain("RECORDED");
    expect(out).toContain("no appointment was recorded");
  });
  it("the request carries an abort signal — a hung connection must not stall finishCall forever", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ choices: [{ message: { content: "x" } }] }),
    });
    await generateSummary(emptyCallState(), { fetchImpl: fetchImpl as unknown as typeof fetch });
    const init = fetchImpl.mock.calls[0]![1]!;
    expect(init.signal).toBeDefined();
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it("a timeout (AbortSignal firing) still yields the fact-line summary, not a hang", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new DOMException("The operation timed out.", "TimeoutError"));
    const out = await generateSummary(emptyCallState(), { fetchImpl: fetchImpl as unknown as typeof fetch });
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
  it("no timezone in opts omits the timezone instruction entirely", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ choices: [{ message: { content: "x" } }] }),
    });
    await generateSummary(emptyCallState(), { fetchImpl: fetchImpl as unknown as typeof fetch });
    const body = JSON.parse(fetchImpl.mock.calls[0]![1]!.body);
    const systemContent = body.messages[0].content as string;
    expect(systemContent).not.toContain("Never present a UTC time as if it were local");
  });
});
