// The SHAPE of the transfer document, pinned element by element.
//
// This file exists because of a gap found on 2026-09-17: the number being
// dialled was moved from a bare text child of `<Dial>` into a `<Number>`
// element — a real restructure of the one document that puts a caller through
// to a human — and all 31 existing tests went on passing. They asserted that
// `>+1956…<` appeared somewhere in the string, which is true of both shapes.
//
// That markup has cost two production failures already: a caller heard dead
// air because the continuation was unreachable (#84), and the `timeLimit` the
// spec promised was missing from the code entirely. Every attribute on it is
// load-bearing, and "the tests pass" must mean "the document still has them".
//
// So: one test per attribute, asserted on the ELEMENT it belongs to, and each
// one fails on its own when that attribute is dropped.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { POST } from "./route";

const getCallByHandoffTokenMock = vi.hoisted(() => vi.fn());
const getTransferPhoneMock = vi.hoisted(() => vi.fn());
const listPhoneNumbersForAccountMock = vi.hoisted(() => vi.fn());

vi.mock("@bis/db", () => ({
  serviceDb: () => ({}),
  getCallByHandoffToken: (...a: unknown[]) => getCallByHandoffTokenMock(...a),
  getTransferPhone: (...a: unknown[]) => getTransferPhoneMock(...a),
  listPhoneNumbersForAccount: (...a: unknown[]) => listPhoneNumbersForAccountMock(...a),
}));

const REQUESTED = {
  id: "c1", account_id: "acct1", phone_number_id: "pn1", outcome: "abandoned",
  caller_e164: "+19562921696", contact_id: null,
  get handoff_requested_at(): string { return new Date().toISOString(); },
};

async function dial(): Promise<string> {
  const res = await POST(new Request("https://x.example/api/voice/texml/handoff?t=tok_abc", {
    method: "POST",
    body: new URLSearchParams({}),
    headers: { "content-type": "application/x-www-form-urlencoded" },
  }));
  return res.text();
}

beforeEach(() => {
  delete process.env.TELNYX_PUBLIC_KEY;
  delete process.env.APP_ORIGIN;
  getCallByHandoffTokenMock.mockReset().mockResolvedValue(REQUESTED);
  getTransferPhoneMock.mockReset().mockResolvedValue("+19565551234");
  listPhoneNumbersForAccountMock.mockReset().mockResolvedValue([
    { id: "pn1", account_id: "acct1", e164: "+19565550999", telnyx_id: null, status: "testing" },
  ]);
});

describe("the transfer document's shape", () => {
  // ── The <Dial> attributes. Five, all load-bearing, none optional. ───────
  it("keeps every <Dial> attribute the restructure could have dropped", async () => {
    const xml = await dial();
    const openTag = /<Dial\b[^>]*>/.exec(xml)?.[0] ?? "";
    // Asserted on the OPEN TAG, not on the whole document: a `timeLimit` that
    // ended up on the <Number> instead would still be "in the xml" and would
    // still be wrong.
    expect(openTag).toContain('callerId="+19565550999"');
    expect(openTag).toMatch(/\btimeout="\d+"/);
    expect(openTag).toMatch(/\btimeLimit="\d+"/);
    expect(openTag).toContain('passDiversionHeader="true"');
    expect(openTag).toMatch(/\baction="[^"]*handoff-result\?t=tok_abc"/);
    expect(openTag).toContain('method="POST"');
  });

  // ── The <Number> noun, which is where AMD has to live. ─────────────────
  it("dials the number as a <Number> element, not a bare text child", async () => {
    // The whole reason the wrapper exists: `machineDetection` is an attribute
    // of the noun. A bare text child cannot carry it.
    const xml = await dial();
    expect(xml).toMatch(/<Number\b[^>]*>\+19565551234<\/Number>/);
  });

  it("asks the carrier what answered, and bounds how long it may take deciding", async () => {
    const xml = await dial();
    const num = /<Number\b[^>]*>/.exec(xml)?.[0] ?? "";
    expect(num).toContain('machineDetection="Enable"');
    // Bounded BELOW Telnyx's 3500ms default on purpose: if this detection
    // turns out to be synchronous, the caller hears the wait as silence after
    // the business says hello. See the constant's comment in route.ts.
    const timeout = Number(/machineDetectionTimeout="(\d+)"/.exec(num)?.[1]);
    expect(timeout).toBeGreaterThanOrEqual(500);
    expect(timeout).toBeLessThan(3500);
  });

  it("points the detection result at a route that carries this call's token", async () => {
    // Without the token the callback cannot say WHICH call it describes, and
    // the observation is worthless. Same credential the other two routes use.
    const xml = await dial();
    const num = /<Number\b[^>]*>/.exec(xml)?.[0] ?? "";
    expect(num).toMatch(/statusCallback="[^"]*handoff-amd\?t=tok_abc"/);
    expect(num).toContain('statusCallbackEvent="amd"');
  });

  it("escapes the status-callback URL — the bug this document already had once", async () => {
    // `origin` reaches here from configuredOrigin(), which strips trailing
    // slashes and nothing else. A second query parameter with a raw `&` is
    // not a wrong URL, it is a document Telnyx cannot parse — which is dead
    // air on a caller who was just told they are being put through. The
    // action URL had exactly this bug in September 2026.
    process.env.APP_ORIGIN = "https://x.example/?a=1&b=2";
    const xml = await dial();
    expect(xml).not.toMatch(/statusCallback="[^"]*&(?!amp;)/);
    expect(xml).toContain("&amp;");
  });

  // ── And the guarantee the whole observe-only phase rests on. ───────────
  it("is still a document Telnyx can parse — every tag closed, every attribute quoted", async () => {
    // A restructure that produces malformed XML is the one failure mode that
    // reads as dead air rather than as an error, so it gets its own check
    // rather than being inferred from the assertions above.
    const xml = await dial();
    expect(xml.match(/<Dial\b/g)?.length).toBe(1);
    expect(xml.match(/<\/Dial>/g)?.length).toBe(1);
    expect(xml.match(/<Number\b/g)?.length).toBe(1);
    expect(xml.match(/<\/Number>/g)?.length).toBe(1);
    // Nothing unquoted: every `attr=` in the document is followed by a quote.
    expect(xml).not.toMatch(/\s[A-Za-z]+=[^"]/);
  });
});
