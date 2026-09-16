import { describe, it, expect, beforeEach, vi } from "vitest";
import { POST } from "./route";

// The token lookup is deliberately NOT account-scoped (the token IS the
// credential), so every other read this route makes has to be scoped by the
// account IT resolved. These mocks exist mostly to prove that.
const getCallByHandoffTokenMock = vi.hoisted(() => vi.fn());
const getTransferPhoneMock = vi.hoisted(() => vi.fn());
const listPhoneNumbersForAccountMock = vi.hoisted(() => vi.fn());
// Ordering ledger: which db read happened first. `toHaveBeenCalledWith` is
// "was called at least once with", so it cannot tell a route that resolved
// the account first from one that ALSO read another tenant's row before it.
const events = vi.hoisted(() => [] as string[]);

vi.mock("@bis/db", () => ({
  serviceDb: () => ({}),
  getCallByHandoffToken: (...a: unknown[]) => {
    events.push("token");
    return getCallByHandoffTokenMock(...a);
  },
  getTransferPhone: (...a: unknown[]) => {
    events.push("transfer");
    return getTransferPhoneMock(...a);
  },
  listPhoneNumbersForAccount: (...a: unknown[]) => {
    events.push("owned");
    return listPhoneNumbersForAccountMock(...a);
  },
}));

const REQUESTED = {
  id: "c1",
  account_id: "acct1",
  handoff_requested_at: "2026-09-16T00:00:00Z",
};

function req(token: string | undefined, body: Record<string, string> = {}): Request {
  const url = token === undefined
    ? "https://x.example/api/voice/texml/handoff"
    : `https://x.example/api/voice/texml/handoff?t=${encodeURIComponent(token)}`;
  return new Request(url, {
    method: "POST",
    body: new URLSearchParams(body),
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
}

async function post(token: string | undefined, body: Record<string, string> = {}): Promise<string> {
  const res = await POST(req(token, body));
  return res.text();
}

beforeEach(() => {
  delete process.env.TELNYX_PUBLIC_KEY;
  delete process.env.APP_ORIGIN;
  events.length = 0;
  getCallByHandoffTokenMock.mockReset().mockResolvedValue(REQUESTED);
  getTransferPhoneMock.mockReset().mockResolvedValue("+19562921696");
  // The account's own numbers — the loop guard's input. `testing` on purpose:
  // an account still walking the setup wizard has only a testing number, and
  // that is precisely the account this feature is first tried on.
  listPhoneNumbersForAccountMock.mockReset().mockResolvedValue([
    { id: "pn1", account_id: "acct1", e164: "+19565550999", telnyx_id: null, status: "testing" },
  ]);
});

describe("voice texml handoff route", () => {
  it("a call that asked to be transferred gets a Dial to the business number", async () => {
    const xml = await post("tok_abc");
    expect(xml).toContain("<Dial");
    expect(xml).toContain(">+19562921696<");
    expect(xml).toContain('passDiversionHeader="true"');
    expect(xml).toMatch(/timeout="\d+"/);
    expect(xml).toMatch(/action="[^"]*handoff-result\?t=tok_abc"/);
  });

  it("the outbound leg's caller id is one of the account's OWN numbers", async () => {
    // Telnyx refuses an outbound leg whose caller id is not a number this
    // account owns — the same reason forwardXml passes our number, not the
    // caller's (texml/route.ts:182-184).
    const xml = await post("tok_abc");
    expect(xml).toContain('callerId="+19565550999"');
  });

  it("a call that did NOT ask is hung up — this is the ordinary end of every other call", async () => {
    getCallByHandoffTokenMock.mockResolvedValue({ ...REQUESTED, handoff_requested_at: null });
    const xml = await post("tok_abc");
    expect(xml).toContain("<Hangup");
    expect(xml).not.toContain("<Dial");
  });

  it("an unknown token hangs up rather than dialling a default", async () => {
    getCallByHandoffTokenMock.mockResolvedValue(null);
    const xml = await post("tok_nope");
    expect(xml).toContain("<Hangup");
    expect(xml).not.toContain("<Dial");
  });

  it("a missing token hangs up", async () => {
    const xml = await post(undefined);
    expect(xml).toContain("<Hangup");
    expect(xml).not.toContain("<Dial");
  });

  it("a blank token hangs up, and never reaches the database", async () => {
    const xml = await post("   ");
    expect(xml).toContain("<Hangup");
    expect(getCallByHandoffTokenMock).not.toHaveBeenCalled();
  });

  it("no transfer number configured hangs up — the field IS the on/off switch", async () => {
    getTransferPhoneMock.mockResolvedValue(null);
    const xml = await post("tok_abc");
    expect(xml).toContain("<Hangup");
    expect(xml).not.toContain("<Dial");
  });

  it("the transfer number is read for the account the TOKEN resolved to, never one from the request", async () => {
    // The whole tenancy boundary of this feature. A transfer must never reach
    // a number belonging to a different account.
    await post("tok_abc", { AccountSid: "acct-ATTACKER", account_id: "acct-ATTACKER" });
    expect(getTransferPhoneMock).toHaveBeenCalledWith(expect.anything(), "acct1");
    expect(listPhoneNumbersForAccountMock).toHaveBeenCalledWith(expect.anything(), "acct1");
  });

  it("resolves the account BEFORE reading anything scoped to it, and reads it once", async () => {
    // The ordering half of the boundary above. A route that speculatively
    // read a request-supplied account first and only then corrected itself
    // would satisfy `toHaveBeenCalledWith` and still have touched another
    // tenant's row.
    await post("tok_abc", { AccountSid: "acct-ATTACKER" });
    expect(events[0]).toBe("token");
    expect(events.filter((e) => e === "transfer")).toHaveLength(1);
    expect(events.filter((e) => e === "owned")).toHaveLength(1);
  });

  it("a target that is one of the account's own numbers is refused, not dialled", async () => {
    getTransferPhoneMock.mockResolvedValue("+19565550999");
    const xml = await post("tok_abc");
    expect(xml).not.toContain("<Dial");
    expect(xml).toContain("<Hangup");
  });

  it("the loop guard counts a testing number as owned, not just a live one", async () => {
    // `resolveSmsSender` would report no live number for this account and
    // hand its caller no list at all, so the guard would silently not run on
    // exactly the accounts this ships to first.
    listPhoneNumbersForAccountMock.mockResolvedValue([
      { id: "pn1", account_id: "acct1", e164: "+19562921696", telnyx_id: null, status: "testing" },
    ]);
    const xml = await post("tok_abc");
    expect(xml).not.toContain("<Dial");
  });

  it("a released number is not treated as owned — it cannot loop back to us", async () => {
    // Close along the axis the guard moves: same number, only the status
    // differs from the case above.
    listPhoneNumbersForAccountMock.mockResolvedValue([
      { id: "pn1", account_id: "acct1", e164: "+19565550999", telnyx_id: null, status: "live" },
      { id: "pn2", account_id: "acct1", e164: "+19562921696", telnyx_id: null, status: "released" },
    ]);
    const xml = await post("tok_abc");
    expect(xml).toContain(">+19562921696<");
  });

  it("a database failure hangs up rather than 500ing at the carrier", async () => {
    getCallByHandoffTokenMock.mockRejectedValue(new Error("boom"));
    const res = await POST(req("tok_abc"));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<Hangup");
  });

  it("a transfer-number read failure hangs up too, and never dials", async () => {
    getTransferPhoneMock.mockRejectedValue(new Error("boom"));
    const res = await POST(req("tok_abc"));
    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain("<Hangup");
    expect(xml).not.toContain("<Dial");
  });

  it("answers 200 and XML on the happy path", async () => {
    const res = await POST(req("tok_abc"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/xml");
  });

  it("the result action is absolute on APP_ORIGIN when it is set", async () => {
    process.env.APP_ORIGIN = "https://app.bis-rgv.com";
    const xml = await post("tok_abc");
    expect(xml).toContain('action="https://app.bis-rgv.com/api/voice/texml/handoff-result?t=tok_abc"');
  });

  it("never writes the token to the log — it is the credential, not an id", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    getTransferPhoneMock.mockResolvedValue(null);
    await post("tok_secret_abc");
    const written = [...logSpy.mock.calls, ...errSpy.mock.calls].flat().map(String).join(" ");
    expect(written).not.toContain("tok_secret_abc");
    logSpy.mockRestore();
    errSpy.mockRestore();
  });
});

describe("voice texml handoff route — signature enforcement matches /api/voice/texml", () => {
  // Same gate as the route that mints the token, so the two cannot drift
  // when TELNYX_PUBLIC_KEY is finally set (runbook Step 6).
  it("with the key set, a request carrying no signature headers is rejected", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.TELNYX_PUBLIC_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    const res = await POST(req("tok_abc"));
    expect(res.status).toBe(403);
    expect(getCallByHandoffTokenMock).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("with the key unset, no signature is required (today's state)", async () => {
    const res = await POST(req("tok_abc"));
    expect(res.status).toBe(200);
  });
});
