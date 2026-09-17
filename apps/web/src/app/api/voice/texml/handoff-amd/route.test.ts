import { describe, it, expect, beforeEach, vi } from "vitest";
import { POST } from "./route";

const getCallByHandoffTokenMock = vi.hoisted(() => vi.fn());
const setTransferAnsweredByMock = vi.hoisted(() => vi.fn());

vi.mock("@bis/db", () => ({
  serviceDb: () => ({}),
  getCallByHandoffToken: (...a: unknown[]) => getCallByHandoffTokenMock(...a),
  setTransferAnsweredBy: (...a: unknown[]) => setTransferAnsweredByMock(...a),
}));

const CALL = { id: "c1", account_id: "acct1", phone_number_id: "pn1", outcome: "abandoned" };

function req(token: string | undefined, body: Record<string, string> = {}): Request {
  const url = token === undefined
    ? "https://x.example/api/voice/texml/handoff-amd"
    : `https://x.example/api/voice/texml/handoff-amd?t=${encodeURIComponent(token)}`;
  return new Request(url, {
    method: "POST",
    body: new URLSearchParams(body),
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
}

beforeEach(() => {
  delete process.env.TELNYX_PUBLIC_KEY;
  getCallByHandoffTokenMock.mockReset().mockResolvedValue(CALL);
  setTransferAnsweredByMock.mockReset().mockResolvedValue(undefined);
});

describe("voice texml handoff-amd route", () => {
  it("records the carrier's verdict against the call the token resolved to", async () => {
    const res = await POST(req("tok_abc", { AnsweredBy: "machine_start" }));
    expect(res.status).toBe(200);
    expect(setTransferAnsweredByMock).toHaveBeenCalledOnce();
    const [, accountId, callId, value] = setTransferAnsweredByMock.mock.calls[0]!;
    // The account from the TOKEN LOOKUP, never from the request.
    expect(accountId).toBe("acct1");
    expect(callId).toBe("c1");
    expect(value).toBe("machine_start");
  });

  it("stores an unfamiliar verdict verbatim rather than mapping it to something known", async () => {
    // The entire point of the observe-only phase: a value Telnyx's docs did
    // not prepare us for is the observation most worth having. Normalising on
    // the way in would throw away the one thing we are here to learn, and
    // 0038 leaves the column unconstrained for the same reason.
    await POST(req("tok_abc", { AnsweredBy: "something_nobody_documented" }));
    expect(setTransferAnsweredByMock.mock.calls[0]![3]).toBe("something_nobody_documented");
  });

  // ── The guarantee the whole observe-only phase rests on ─────────────────
  it("NEVER returns TeXML — a body here could become the call", async () => {
    // Telnyx documents a synchronous detection mode in which the response to
    // this callback IS the next set of instructions. We expect async, but if
    // that is wrong, `<Response/>` would be an empty instruction list — a
    // hangup on a caller mid-transfer. An empty body is the only answer that
    // is safe in both modes.
    //
    // Asserted for every branch, not just the happy one: the dangerous
    // version of this bug is a body that only appears on an error path.
    const cases: Array<[string, Request]> = [
      ["recorded", req("tok_abc", { AnsweredBy: "human" })],
      ["no token", req(undefined, { AnsweredBy: "human" })],
      ["no verdict", req("tok_abc", {})],
      ["unknown token", req("tok_nope", { AnsweredBy: "human" })],
    ];
    getCallByHandoffTokenMock.mockImplementation((_db: unknown, t: string) =>
      t === "tok_abc" ? CALL : null);
    for (const [label, r] of cases) {
      const res = await POST(r);
      const text = await res.text();
      expect(text, `${label} returned a body`).toBe("");
      // `?? ""` because the header is absent entirely, which is the strongest
      // form of the guarantee — not "declared as something harmless", but not
      // declared at all. Coerced so the assertion reads the same either way.
      expect(String(res.headers.get("content-type") ?? ""), `${label} declared XML`)
        .not.toMatch(/xml/i);
    }
  });

  it("a database failure is swallowed — a call in progress never pays for our notebook", async () => {
    setTransferAnsweredByMock.mockRejectedValue(new Error("db down"));
    const res = await POST(req("tok_abc", { AnsweredBy: "human" }));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });

  it("a token that resolves to nothing writes nothing", async () => {
    getCallByHandoffTokenMock.mockResolvedValue(null);
    const res = await POST(req("tok_abc", { AnsweredBy: "human" }));
    expect(res.status).toBe(200);
    expect(setTransferAnsweredByMock).not.toHaveBeenCalled();
  });

  it("no AnsweredBy means no write — an absent verdict is not a verdict", async () => {
    // NULL in that column means "no result". Writing "" or "unknown" here
    // would turn a callback that told us nothing into a recorded observation,
    // and the sample this decision gets made on would be quietly polluted.
    await POST(req("tok_abc", { DialCallStatus: "completed" }));
    expect(setTransferAnsweredByMock).not.toHaveBeenCalled();
  });

  it("no token means no database read at all", async () => {
    await POST(req(undefined, { AnsweredBy: "human" }));
    expect(getCallByHandoffTokenMock).not.toHaveBeenCalled();
    expect(setTransferAnsweredByMock).not.toHaveBeenCalled();
  });

  it("refuses an unsigned request once TELNYX_PUBLIC_KEY is set", async () => {
    // The gate is off today (the key is unset in every environment) and this
    // is what notices the day the runbook's Step 6 turns it on.
    process.env.TELNYX_PUBLIC_KEY = "not-a-real-key";
    const res = await POST(req("tok_abc", { AnsweredBy: "human" }));
    expect(res.status).toBe(403);
    expect(setTransferAnsweredByMock).not.toHaveBeenCalled();
  });
});
