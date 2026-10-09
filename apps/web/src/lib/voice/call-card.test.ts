import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TranscriptEvent } from "@bis/db";
import {
  emptyCallState, withLead, withMessage, withTranscript, withBooking, withRecordedCaller, withTransferred,
  type CallState,
} from "./call-state";
import {
  recordedReason, callbackNumberOf, callbackWanted, callbackTaskTitle, cardReadable,
  readCallForCard, composeCallCard, NO_READING,
} from "./call-card";

beforeEach(() => { process.env.OPENAI_API_KEY = "sk-test"; });
afterEach(() => { vi.restoreAllMocks(); });

const CALLER_ID = "+19562921696";
const t = (role: "caller" | "assistant", text: string): TranscriptEvent =>
  ({ role, text, at: "2027-06-01T17:00:00.000Z" });

const spoke = (s: CallState = emptyCallState()) =>
  withTranscript(s, t("caller", "Hi, my roof started leaking last night and I need someone out here."));

function modelReturning(content: unknown, status = 200): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify({
    choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }],
  }), { status })) as unknown as typeof fetch;
}

describe("recordedReason: what Sofía wrote down on the call", () => {
  it("the message's body wins over the lead's need when both were taken (mutation: lead first → \"roof quote\", FAILS)", () => {
    const s = withMessage(withLead(spoke(), { fields: { fullName: "Ana Ruiz", need: "roof quote" } }),
      { body: "Wants the owner to call about the leak", at: "t" });
    expect(recordedReason(s)).toBe("Wants the owner to call about the leak");
  });

  it("the LAST message when two were taken (mutation: messages[0] → the first, FAILS)", () => {
    const s = withMessage(withMessage(spoke(), { body: "Call about gutters", at: "t1" }),
      { body: "Actually, call about the roof", at: "t2" });
    expect(recordedReason(s)).toBe("Actually, call about the roof");
  });

  it("the lead's need when no message was taken", () => {
    expect(recordedReason(withLead(spoke(), { fields: { fullName: "Ana Ruiz", need: " roof quote " } })))
      .toBe("roof quote");
  });

  it("null when nothing was written down, or only blanks", () => {
    expect(recordedReason(spoke())).toBeNull();
    expect(recordedReason(withLead(spoke(), { fields: { fullName: "Ana", need: "   " } }))).toBeNull();
  });
});

describe("callbackNumberOf: the number as the caller said it, or the caller ID", () => {
  it("a message's number that is not the caller ID comes back as its ten digits, never re-parsed (mutation: return the stored E.164 → \"+19565061545\", FAILS)", () => {
    // take_message stores e164Of(said); spokenPhone hands back the national digits.
    expect(callbackNumberOf(withMessage(spoke(), { body: "x", callbackNumber: "+19565061545", at: "t" }), CALLER_ID))
      .toBe("9565061545");
  });

  it("a lead's number is kept as said: an ambiguous US-or-Mexico number is not dressed as a confirmed +1 (mutation: e164Of → \"+15512345678\", FAILS)", () => {
    expect(callbackNumberOf(withLead(spoke(), { fields: { fullName: "Ana", need: "x", callbackNumber: "55 1234 5678" } }), CALLER_ID))
      .toBe("55 1234 5678");
  });

  it("the message's number wins over the lead's (mutation: lead first → \"55 1234 5678\", FAILS)", () => {
    const s = withMessage(withLead(spoke(), { fields: { fullName: "Ana", need: "x", callbackNumber: "55 1234 5678" } }),
      { body: "x", callbackNumber: "+19565061545", at: "t" });
    expect(callbackNumberOf(s, CALLER_ID)).toBe("9565061545");
  });

  it("nothing said → the caller ID; nothing said and the caller ID withheld → null", () => {
    expect(callbackNumberOf(spoke(), CALLER_ID)).toBe(CALLER_ID);
    expect(callbackNumberOf(spoke(), null)).toBeNull();
  });
});

describe("callbackWanted: does a person need to call this caller back?", () => {
  it("a message was taken → yes; a lead with no booking → yes", () => {
    expect(callbackWanted(withMessage(spoke(), { body: "Call me", at: "t" }))).toBe(true);
    expect(callbackWanted(withLead(spoke(), { fields: { fullName: "Ana", need: "roof quote" } }))).toBe(true);
  });

  it("a booked call with a lead → no: the appointment is the follow-up (mutation: leads.length > 0 regardless of outcome → FAILS)", () => {
    const booked = withBooking(withLead(spoke(), { fields: { fullName: "Ana", need: "roof quote" } }),
      { id: "b1", contactName: "Ana", startsAt: "2027-06-02T15:00:00Z", endsAt: "2027-06-02T16:00:00Z" });
    expect(callbackWanted(booked)).toBe(false);
  });

  it("a booked call where a message was ALSO taken → yes: the message asks for a person", () => {
    const s = withMessage(withBooking(spoke(),
      { id: "b1", contactName: "Ana", startsAt: "2027-06-02T15:00:00Z", endsAt: "2027-06-02T16:00:00Z" }),
    { body: "Also call me about a second roof", at: "t" });
    expect(callbackWanted(s)).toBe(true);
  });

  it("an abandoned caller who left nothing → no (the missed-call text-back is that caller's path)", () => {
    expect(callbackWanted(spoke())).toBe(false);
  });

  it("a RECORDING that got a message taken → no: a robocall never makes a To do (mutation: drop the recordedCaller check → FAILS)", () => {
    expect(callbackWanted(withRecordedCaller(withMessage(spoke(), { body: "Press 1 for your warranty", at: "t" }))))
      .toBe(false);
  });

  it("a caller who asked for a person → no: a person took it, or the transfer's own result decides (mutation: drop the wasTransferred check → FAILS)", () => {
    expect(callbackWanted(withTransferred(withMessage(spoke(), { body: "Call me", at: "t" })))).toBe(false);
  });
});

describe("callbackTaskTitle: the To do's English line", () => {
  it("names the number and the reason", () => {
    expect(callbackTaskTitle("956 555 0142", "Roof leak")).toBe("Call back at 956 555 0142: Roof leak");
  });

  it("no reason → the bare line, never a dangling colon (mutation: always the reasoned line → \"…0142: \", FAILS)", () => {
    expect(callbackTaskTitle("956 555 0142", null)).toBe("Call back at 956 555 0142");
    expect(callbackTaskTitle("956 555 0142", "  ")).toBe("Call back at 956 555 0142");
  });

  it("a long reason is cut at a word with an ellipsis, so the To do row stays one line", () => {
    const title = callbackTaskTitle("956 555 0142", "word ".repeat(80).trim());
    expect(title.startsWith("Call back at 956 555 0142: word word")).toBe(true);
    expect(title.endsWith("…")).toBe(true);
    expect(title.length).toBeLessThanOrEqual("Call back at 956 555 0142: ".length + 141);
  });

  it("a reason carrying `$&` is written literally, never as a replacement pattern (mutation: .replace(\"{reason}\", reason) → the placeholder echoes, FAILS)", () => {
    expect(callbackTaskTitle("956 555 0142", "Paid $& for nothing")).toBe("Call back at 956 555 0142: Paid $& for nothing");
  });
});

describe("cardReadable: is the transcript worth a reading?", () => {
  it("a caller who spoke → yes; a silent call, a spam call or a recording → no", () => {
    expect(cardReadable(spoke())).toBe(true);
    expect(cardReadable(emptyCallState())).toBe(false);
    expect(cardReadable(withRecordedCaller(spoke()))).toBe(false);
  });
});

describe("readCallForCard: the model's reading, grounded", () => {
  const transcript = [
    t("assistant", "Thanks for calling Rio Roofing. How can I help?"),
    t("caller", "Hi, my roof started leaking last night and I need someone out here."),
  ];

  it("returns the reason and the caller's WHOLE turn the quote came from, verbatim (mutation: store the model's excerpt → FAILS)", async () => {
    const fetchImpl = modelReturning({ reason: "Roof leak, needs someone out", quote: "my roof started leaking last night" });
    expect(await readCallForCard(transcript, { fetchImpl })).toEqual({
      reason: "Roof leak, needs someone out",
      callerWords: "Hi, my roof started leaking last night and I need someone out here.",
    });
  });

  it("a quote of the ASSISTANT grounds nothing: no words (mutation: drop grounding → Sofía's line stored as the caller's, FAILS)", async () => {
    const fetchImpl = modelReturning({ reason: "Roof leak", quote: "Thanks for calling Rio Roofing" });
    expect((await readCallForCard(transcript, { fetchImpl })).callerWords).toBeNull();
  });

  it("a reason carrying a phone number is dropped: the card's number comes from the call, never from prose (mutation: drop the digit guard → FAILS)", async () => {
    const fetchImpl = modelReturning({ reason: "Call back at 956-555-0142 about a leak", quote: null });
    expect((await readCallForCard(transcript, { fetchImpl })).reason).toBeNull();
  });

  it("asks gpt-4o-mini in JSON mode, under a time limit, with the transcript and an English-reason rule", async () => {
    const fetchImpl = modelReturning({ reason: null, quote: null });
    await readCallForCard(transcript, { fetchImpl });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[1].content).toContain("caller: Hi, my roof started leaking");
    expect(body.messages[0].content).toMatch(/English/);
    expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });

  it("no key → no request and no reading", async () => {
    delete process.env.OPENAI_API_KEY;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchImpl = modelReturning({ reason: "x", quote: null });
    expect(await readCallForCard(transcript, { fetchImpl })).toEqual(NO_READING);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("never throws: a refused request, unparseable content and a network failure all read as nothing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await readCallForCard(transcript, { fetchImpl: modelReturning({}, 500) })).toEqual(NO_READING);
    expect(await readCallForCard(transcript, { fetchImpl: modelReturning("not json") })).toEqual(NO_READING);
    const failing = vi.fn(async () => { throw new Error("socket hang up"); }) as unknown as typeof fetch;
    expect(await readCallForCard(transcript, { fetchImpl: failing })).toEqual(NO_READING);
  });

  it("a very long caller turn is cut at a word with an ellipsis", async () => {
    const long = `My roof is leaking ${"and it keeps dripping ".repeat(60)}`.trim();
    const fetchImpl = modelReturning({ reason: "Roof leak", quote: "My roof is leaking" });
    const words = (await readCallForCard([t("caller", long)], { fetchImpl })).callerWords!;
    expect(words.startsWith("My roof is leaking and it keeps dripping")).toBe(true);
    expect(words.endsWith("…")).toBe(true);
    expect(words.length).toBeLessThanOrEqual(501);
  });
});

describe("composeCallCard", () => {
  it("what Sofía wrote down beats the model's reading; the words come from the reading; the number from the call (mutation: reading's reason first → FAILS)", () => {
    const s = withMessage(spoke(), { body: "Wants the owner to call about the leak", callbackNumber: "+19565061545", at: "t" });
    expect(composeCallCard(s, CALLER_ID, { reason: "Roof leak", callerWords: "my words" })).toEqual({
      reason: "Wants the owner to call about the leak", callbackNumber: "9565061545", callerWords: "my words",
    });
  });

  it("with nothing written down, the model's reason stands", () => {
    expect(composeCallCard(spoke(), CALLER_ID, { reason: "Roof leak", callerWords: null }))
      .toEqual({ reason: "Roof leak", callbackNumber: CALLER_ID, callerWords: null });
  });

  it("a spam call gets no card at all, even with a caller ID (mutation: drop the spam gate → a card of one number, FAILS)", () => {
    expect(composeCallCard(withRecordedCaller(spoke()), CALLER_ID, NO_READING)).toBeNull();
    expect(composeCallCard(emptyCallState(), CALLER_ID, NO_READING)).toBeNull();
  });

  it("nothing to say at all → no card", () => {
    expect(composeCallCard(spoke(), null, NO_READING)).toBeNull();
  });
});
