import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { POST } from "./route";
// Heartbeats are mocked out so the `after()` recorders below keep counting
// only this route's own work; their calls are asserted where they matter
// (lib/ops/stamp.ts).
const stampMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ops/stamp", () => ({ stampHeartbeat: (...a: unknown[]) => stampMock(...a) }));

// The token lookup is deliberately NOT account-scoped (the token IS the
// credential), so every other read this route makes has to be scoped by the
// account IT resolved. These mocks exist mostly to prove that.
const getCallByHandoffTokenMock = vi.hoisted(() => vi.fn());
const getTransferPhoneMock = vi.hoisted(() => vi.fn());
const listPhoneNumbersForAccountMock = vi.hoisted(() => vi.fn());
// The model-down fallback's cross-account loop guard: is the target any BIS line?
const platformNumberMock = vi.hoisted(() => vi.fn());
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
  getPhoneNumberByE164: (...a: unknown[]) => platformNumberMock(...a),
}));

const REQUESTED = {
  id: "c1",
  account_id: "acct1",
  // Which of the account's numbers the caller actually dialled — the caller id
  // the business's handset must show.
  phone_number_id: "pn1",
  // Read fresh on every access, deliberately. The route refuses a stamp older
  // than a few minutes (the recency gate below), so a hardcoded date would
  // make this whole file pass on the day it was written and hang up on every
  // call from the next day onwards.
  get handoff_requested_at(): string { return new Date().toISOString(); },
};

const MINUTE = 60_000;
const agoIso = (ms: number) => new Date(Date.now() - ms).toISOString();

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
  stampMock.mockReset();
  platformNumberMock.mockReset().mockResolvedValue(null);
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

  it("the Dial carries a timeLimit — the conversation has a ceiling, not just the ringing", async () => {
    // `timeout` bounds the RINGING and nothing else. Once the business
    // answers, this leg runs on the tenant's own trunk until one side hangs
    // up, and the AI leg's `PHONE_MAX_CALL_SECONDS` is no longer anywhere in
    // the path. A voicemail that auto-answers, or an IVR that never hangs up,
    // plus a caller who walked away, is an open billing leg with no ceiling
    // anywhere in this product. The spec promised this attribute before the
    // code had it.
    const xml = await post("tok_abc");
    expect(xml).toContain('timeLimit="3600"');
  });

  it("the conversation ceiling is its own quantity, inside what Telnyx accepts", async () => {
    // Telnyx documents `timeLimit` as 60–14400 seconds. Outside that range
    // the attribute is rejected and the failure is the worst kind this route
    // has: the dial does not happen and the caller who was just told "one
    // moment" hears nothing.
    //
    // `not.toBe(ring)` is the cheap half of a rule a test cannot fully state:
    // how long a handset rings and how long two people talk move for
    // unrelated reasons, so one must never be derived from the other. It
    // catches the literal `timeLimit={RING_SECONDS}` slip; the comment on the
    // constant is what carries the rest.
    const xml = await post("tok_abc");
    const limit = Number(/timeLimit="(\d+)"/.exec(xml)?.[1]);
    const ring = Number(/timeout="(\d+)"/.exec(xml)?.[1]);
    expect(limit).toBeGreaterThanOrEqual(60);
    expect(limit).toBeLessThanOrEqual(14400);
    expect(limit).not.toBe(ring);
  });

  it("the outbound leg's caller id is one of the account's OWN numbers", async () => {
    // Telnyx refuses an outbound leg whose caller id is not a number this
    // account owns — the same reason forwardXml passes our number, not the
    // caller's (texml/route.ts:182-184).
    const xml = await post("tok_abc");
    expect(xml).toContain('callerId="+19565550999"');
  });

  // TWO LIVE NUMBERS, which is the only fixture that can tell the rule apart.
  // With one number, "the number the caller dialled" and "any number this
  // account owns" are the same string and any implementation passes. An
  // account that owns two live numbers and a customer who called the second
  // one is the failing input: under the old rule the business's handset shows
  // the FIRST number, one its customers never call back.
  const TWO_LIVE = [
    { id: "pn1", account_id: "acct1", e164: "+19565550999", telnyx_id: null, status: "live" },
    { id: "pn2", account_id: "acct1", e164: "+19565550777", telnyx_id: null, status: "live" },
  ];

  it("the caller id is the number the caller DIALLED, not merely one the account owns", async () => {
    listPhoneNumbersForAccountMock.mockResolvedValue(TWO_LIVE);
    getCallByHandoffTokenMock.mockResolvedValue({ ...REQUESTED, phone_number_id: "pn2" });
    const xml = await post("tok_abc");
    expect(xml).toContain('callerId="+19565550777"');
    expect(xml).not.toContain('callerId="+19565550999"');
  });

  it("the other number, same fixture — the caller id follows the call, not the list order", async () => {
    listPhoneNumbersForAccountMock.mockResolvedValue(TWO_LIVE);
    getCallByHandoffTokenMock.mockResolvedValue({ ...REQUESTED, phone_number_id: "pn1" });
    const xml = await post("tok_abc");
    expect(xml).toContain('callerId="+19565550999"');
  });

  it("a dialled number that is no longer in the list falls back to an owned one rather than dropping the caller id", async () => {
    // `calls.phone_number_id` is `on delete restrict` (0019), so the row it
    // points at cannot vanish — but it can leave this account's list by being
    // MOVED to another account, and a released one is filtered out here for
    // the same reason it is filtered out of the loop guard. Telnyx rejects an
    // outbound leg whose caller id is not a number we own, so falling back to
    // one we do keeps the transfer working; the business sees a number of its
    // own, just not the dialled one.
    listPhoneNumbersForAccountMock.mockResolvedValue(TWO_LIVE);
    getCallByHandoffTokenMock.mockResolvedValue({ ...REQUESTED, phone_number_id: "pn-gone" });
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

  it("a token in the BODY is not a credential — only the query string we wrote is", async () => {
    // The body is the carrier's call-status form: fields in it are supplied by
    // whoever POSTed, and with TELNYX_PUBLIC_KEY unset that is anyone who can
    // reach the URL. The query string is the one WE wrote into the `action`
    // URL. The route's comment said "never from the body" and nothing held it:
    // a version reading `form.get("t")` as a fallback passed the whole file.
    const xml = await post(undefined, { t: "tok_abc", Token: "tok_abc" });
    expect(xml).toContain("<Hangup");
    expect(xml).not.toContain("<Dial");
    expect(getCallByHandoffTokenMock).not.toHaveBeenCalled();
  });

  it("the owned-numbers read failing hangs up — the loop guard's input must never open", async () => {
    // `listPhoneNumbersForAccount` is what tells us a transfer target is one
    // of this account's OWN numbers. A failure that fell through to an empty
    // list would disarm that guard and loop the caller back into Sofía, on
    // the tenant's own trunk, at the tenant's own per-minute cost. Its
    // sibling `getTransferPhone` was pinned; this one was not.
    listPhoneNumbersForAccountMock.mockRejectedValue(new Error("boom"));
    const res = await POST(req("tok_abc"));
    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain("<Hangup");
    expect(xml).not.toContain("<Dial");
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

describe("voice texml handoff route — the token stops working minutes after the call", () => {
  // The token reaches the QUERY STRING of the action URL, so it lands in
  // Telnyx's request logs and Vercel's access logs, where the SIP-header copy
  // of it never goes. Anyone holding a logged token can fetch this route and
  // read back the account's private transfer number and one of its owned
  // numbers. It cannot place a call — nothing here writes, and only Telnyx
  // executes TeXML — so the loss is disclosure of a private business line.
  // Unbounded in time, until this gate: wherever TELNYX_PUBLIC_KEY is unset
  // (not production since 2026-09-29) a logged token is a complete credential.
  //
  // A recency gate, NOT single use: Task 5's result route is pointed at
  // `handoff-result?t=<the same token>`, so consuming it here would break it.
  it("a stamp from an hour ago is refused — a logged token is not a key forever", async () => {
    getCallByHandoffTokenMock.mockResolvedValue({ ...REQUESTED, handoff_requested_at: agoIso(60 * MINUTE) });
    const xml = await post("tok_abc");
    expect(xml).toContain("<Hangup");
    expect(xml).not.toContain("<Dial");
    // And the disclosure itself is gone, not just the dial: neither the
    // transfer number nor an owned number appears in the body.
    expect(xml).not.toContain("+19562921696");
    expect(xml).not.toContain("+19565550999");
  });

  it("the legitimate fetch — seconds after the stamp — still dials", async () => {
    getCallByHandoffTokenMock.mockResolvedValue({ ...REQUESTED, handoff_requested_at: agoIso(5_000) });
    expect(await post("tok_abc")).toContain("<Dial");
  });

  // The window's own value, pinned from both sides. Without the pair, widening
  // it to an hour or narrowing it to one minute both stay green — and one
  // minute would hang up on a real caller whose AI leg ran to the call-length
  // cap before Telnyx fetched this URL.
  it("just inside the window dials", async () => {
    getCallByHandoffTokenMock.mockResolvedValue({ ...REQUESTED, handoff_requested_at: agoIso(9 * MINUTE) });
    expect(await post("tok_abc")).toContain("<Dial");
  });

  it("just outside the window hangs up", async () => {
    getCallByHandoffTokenMock.mockResolvedValue({ ...REQUESTED, handoff_requested_at: agoIso(11 * MINUTE) });
    expect(await post("tok_abc")).toContain("<Hangup");
  });

  it("a stamp that is not a date hangs up — this route fails closed", async () => {
    getCallByHandoffTokenMock.mockResolvedValue({ ...REQUESTED, handoff_requested_at: "not-a-date" });
    const xml = await post("tok_abc");
    expect(xml).toContain("<Hangup");
    expect(xml).not.toContain("<Dial");
  });
});

describe("voice texml handoff route — signature enforcement matches /api/voice/texml", () => {
  // Same gate as the route that mints the token, so the two cannot drift.
  // Production has run with TELNYX_PUBLIC_KEY set since 2026-09-29.
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

describe("the model-down fallback (operational-floor spec §3)", () => {
  const ACCOUNT = "0b2cbb04-b46c-4fed-a377-d377a1a201eb";
  const TOKEN = "f".repeat(32);
  let ticket: string;
  const fallbackReq = (status: string | null, f: string | null = ticket) => {
    const q = new URLSearchParams({ t: TOKEN, ...(f ? { f } : {}) });
    return new Request(`https://x.example/api/voice/texml/handoff?${q}`, {
      method: "POST",
      body: new URLSearchParams(status ? { DialCallStatus: status } : {}),
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
  };
  const fall = async (status: string | null, f?: string | null) => (await POST(fallbackReq(status, f))).text();

  beforeEach(async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-fixture";
    const { signFallbackTicket } = await import("@/lib/voice/fallback-ticket");
    ticket = signFallbackTicket(TOKEN, ACCOUNT, "+19565550999", Date.now())!;
    // Sofía's webhook never ran, so there is no call row for the token.
    getCallByHandoffTokenMock.mockResolvedValue(null);
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it.each(["failed", "busy", "no-answer"])("a never-connected leg (%s) with a transfer number rings it, presenting the dialled number, for the ticket's account only", async (status) => {
    const xml = await fall(status);
    expect(xml).toContain('<Dial callerId="+19565550999" timeout="20" timeLimit="3600" passDiversionHeader="true">+19562921696</Dial>');
    expect(getTransferPhoneMock).toHaveBeenCalledWith(expect.anything(), ACCOUNT);
    expect(listPhoneNumbersForAccountMock).toHaveBeenCalledWith(expect.anything(), ACCOUNT);
  });

  it("it emails BIS: a voice.sip_webhook error heartbeat (mutation: drop the stamp → FAILS)", async () => {
    await fall("failed");
    expect(stampMock).toHaveBeenCalledExactlyOnceWith("voice.sip_webhook", { ok: false, error: "Sofia's line did not connect (DialCallStatus failed)" });
  });

  it("with no transfer number it hangs up, as today, and STILL stamps the outage", async () => {
    getTransferPhoneMock.mockResolvedValue(null);
    expect(await fall("no-answer")).toContain("<Hangup/>");
    expect(stampMock).toHaveBeenCalledOnce();
  });

  it("a completed leg with no handoff request hangs up as today, with no stamp (mutation: add completed to NEVER_CONNECTED → FAILS)", async () => {
    expect(await fall("completed")).toContain("<Hangup/>");
    expect(getTransferPhoneMock).not.toHaveBeenCalled();
    expect(stampMock).not.toHaveBeenCalled();
  });

  it("a caller who hung up while it rang (canceled) is not chased with a call to the business", async () => {
    expect(await fall("canceled")).toContain("<Hangup/>");
    expect(getTransferPhoneMock).not.toHaveBeenCalled();
  });

  it("no ticket — a call the guards did not clear — hangs up and stamps nothing, so a forger cannot raise an alert either", async () => {
    expect(await fall("failed", null)).toContain("<Hangup/>");
    expect(getTransferPhoneMock).not.toHaveBeenCalled();
    expect(stampMock).not.toHaveBeenCalled();
  });

  it("a forged ticket naming another account is refused before any read (mutation: trust the ticket unverified → FAILS)", async () => {
    const forged = ticket.replace(ACCOUNT, "11111111-2222-4333-8444-555555555555");
    expect(await fall("failed", forged)).toContain("<Hangup/>");
    expect(getTransferPhoneMock).not.toHaveBeenCalled();
  });

  it("a transfer number that is one of the account's own lines is refused: it would ring straight back into Sofía", async () => {
    getTransferPhoneMock.mockResolvedValue("+19565550999");
    expect(await fall("failed")).toContain("<Hangup/>");
  });

  it("a transfer number that is ANOTHER account's BIS line is refused: two fallbacks would hand the caller back and forth (mutation: drop the platform-number check → FAILS)", async () => {
    platformNumberMock.mockResolvedValue({ id: "pnX", account_id: "someone-else", e164: "+19562921696", telnyx_id: null, status: "live" });
    expect(await fall("failed")).toContain("<Hangup/>");
    expect(platformNumberMock).toHaveBeenCalledWith(expect.anything(), "+19562921696");
  });

  it("a read that throws hangs up rather than dialling, as everything in this route does", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getTransferPhoneMock.mockRejectedValue(new Error("db down"));
    expect(await fall("failed")).toContain("<Hangup/>");
  });

  it("a call row that exists still takes the requested-handoff path: the fallback is only for a call Sofía never answered", async () => {
    getCallByHandoffTokenMock.mockResolvedValue({ ...REQUESTED, handoff_requested_at: null });
    expect(await fall("failed")).toContain("<Hangup/>");
    expect(stampMock).not.toHaveBeenCalled();
  });
});

