import { describe, it, expect, beforeEach, vi } from "vitest";
import { POST } from "./route";

// The token lookup is deliberately NOT account-scoped (the token IS the
// credential), so the account every write and read below uses has to be the
// one the TOKEN resolved — never one supplied by the request.
const getCallByHandoffTokenMock = vi.hoisted(() => vi.fn());
const setCallOutcomeMock = vi.hoisted(() => vi.fn());
const getVoiceProfileMock = vi.hoisted(() => vi.fn());
// Ordering ledger. `toHaveBeenCalledWith` is "was called at least once
// with", so it cannot tell a route that resolved the call first from one
// that stamped an outcome before it knew whose call this was.
const events = vi.hoisted(() => [] as string[]);

vi.mock("@bis/db", () => ({
  serviceDb: () => ({}),
  getCallByHandoffToken: (...a: unknown[]) => {
    events.push("token");
    return getCallByHandoffTokenMock(...a);
  },
  setCallOutcome: (...a: unknown[]) => {
    events.push("outcome");
    return setCallOutcomeMock(...a);
  },
  getVoiceProfile: (...a: unknown[]) => {
    events.push("profile");
    return getVoiceProfileMock(...a);
  },
}));

// The spoken line is real copy, delegated to the real implementation on every
// test EXCEPT the escaping one — which is the only way to feed this route a
// sentence containing an `&` without editing the copy itself.
const realLine = vi.hoisted(() => ({
  fn: null as null | ((l: "en" | "es" | "both") => string),
}));
const transferFailedLineMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/voice/handoff", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/voice/handoff")>();
  realLine.fn = actual.transferFailedLine;
  return {
    ...actual,
    transferFailedLine: (l: "en" | "es" | "both") => transferFailedLineMock(l),
  };
});

const PROFILE = {
  id: "vp1", account_id: "acct1", persona_name: "Sofía",
  greeting_en: "Hi", greeting_es: "Hola", facts: "-", services: "-",
  languages: "en" as const, booking_enabled: true,
  after_hours: "hours_then_message" as const, enabled: true,
  textback_enabled: false, textback_body: "-",
};

const REQUESTED = {
  id: "c1",
  account_id: "acct1",
  phone_number_id: "pn1",
  // Read fresh: this route has NO recency gate (it is fetched when the human
  // conversation ends, which can be an hour after the caller asked), but a
  // hardcoded date would still hide a gate someone added by mistake behind a
  // fixture that only works on the day it was written.
  get handoff_requested_at(): string { return new Date().toISOString(); },
};

function req(token: string | undefined, body: Record<string, string> = {}): Request {
  const url = token === undefined
    ? "https://x.example/api/voice/texml/handoff-result"
    : `https://x.example/api/voice/texml/handoff-result?t=${encodeURIComponent(token)}`;
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
  events.length = 0;
  getCallByHandoffTokenMock.mockReset().mockResolvedValue(REQUESTED);
  setCallOutcomeMock.mockReset().mockResolvedValue(undefined);
  getVoiceProfileMock.mockReset().mockResolvedValue(PROFILE);
  transferFailedLineMock.mockReset().mockImplementation((l: "en" | "es" | "both") => realLine.fn!(l));
});

describe("voice texml handoff-result route", () => {
  it("a completed transfer stamps the call `transferred`", async () => {
    await post("tok_abc", { DialCallStatus: "completed" });
    expect(setCallOutcomeMock).toHaveBeenCalledWith(expect.anything(), "acct1", "c1", "transferred");
  });

  it("an answered transfer stamps it too — a person picked up either way", async () => {
    // Telnyx's documented `DialCallStatus` set carries BOTH `completed` and
    // `answered`. Treating `answered` as a failure would tell a caller who
    // just finished talking to the business owner that nobody could be
    // reached, and record the call as abandoned on the client's dashboard.
    await post("tok_abc", { DialCallStatus: "answered" });
    expect(setCallOutcomeMock).toHaveBeenCalledWith(expect.anything(), "acct1", "c1", "transferred");
  });

  it("a completed transfer ends our side without speaking over the goodbye", async () => {
    const xml = await post("tok_abc", { DialCallStatus: "completed" });
    expect(xml).not.toContain("<Say");
    expect(xml).toContain("<Hangup");
  });

  it.each(["no-answer", "busy", "failed"])("%s speaks an honest line, never silence", async (status) => {
    // The caller was already told they were being put through. Silence is the
    // one unacceptable ending.
    const xml = await post("tok_abc", { DialCallStatus: status });
    expect(xml).toContain("<Say");
    expect(xml).toContain("Sorry, we weren't able to reach anyone just now.");
    expect(xml).toContain("<Hangup");
  });

  it.each(["no-answer", "busy", "failed"])("%s does NOT stamp the call transferred — nobody was reached", async (status) => {
    await post("tok_abc", { DialCallStatus: status });
    expect(setCallOutcomeMock).not.toHaveBeenCalled();
  });

  it("a status nobody planned for speaks rather than claiming a transfer", async () => {
    // Fail closed in BOTH directions: an unrecognised status is not evidence
    // a person was reached, and it is not a reason to leave a caller in
    // silence either. `canceled` is in Telnyx's own set and is exactly this
    // case.
    const xml = await post("tok_abc", { DialCallStatus: "canceled" });
    expect(setCallOutcomeMock).not.toHaveBeenCalled();
    expect(xml).toContain("<Say");
  });

  it("speaks Spanish for an es profile", async () => {
    getVoiceProfileMock.mockResolvedValue({ ...PROFILE, languages: "es" });
    const xml = await post("tok_abc", { DialCallStatus: "no-answer" });
    expect(xml).toContain('language="es-MX"');
    expect(xml).toContain("Lo siento, nadie pudo contestar en este momento.");
  });

  it("speaks English for a `both` profile — it must match the line this caller just heard", async () => {
    // `handoffLine` took English on `both` seconds earlier. Telling the
    // caller they are being connected in one language and that it failed in
    // another is the bug this pins.
    getVoiceProfileMock.mockResolvedValue({ ...PROFILE, languages: "both" });
    const xml = await post("tok_abc", { DialCallStatus: "no-answer" });
    expect(xml).not.toContain("es-MX");
    expect(xml).toContain("Sorry, we weren't able to reach anyone just now.");
  });

  it("an unknown token does nothing and hangs up", async () => {
    getCallByHandoffTokenMock.mockResolvedValue(null);
    const xml = await post("tok_nope", { DialCallStatus: "completed" });
    expect(setCallOutcomeMock).not.toHaveBeenCalled();
    expect(xml).toContain("<Hangup");
  });

  it("a call that never asked for a person is never stamped transferred", async () => {
    // The only WRITE in this whole feature, and with TELNYX_PUBLIC_KEY unset
    // anyone who can reach this URL with a logged token can trigger it. A
    // call with no `handoff_requested_at` was never handed to anybody, so
    // stamping it would put a transfer on the client's dashboard that never
    // happened.
    getCallByHandoffTokenMock.mockResolvedValue({ ...REQUESTED, handoff_requested_at: null });
    const xml = await post("tok_abc", { DialCallStatus: "completed" });
    expect(setCallOutcomeMock).not.toHaveBeenCalled();
    expect(xml).toContain("<Hangup");
  });

  it("stamps for the account the TOKEN resolved to, never one from the request body", async () => {
    await post("tok_abc", { DialCallStatus: "completed", AccountSid: "acct-ATTACKER", account_id: "acct-ATTACKER" });
    expect(setCallOutcomeMock).toHaveBeenCalledWith(expect.anything(), "acct1", "c1", "transferred");
  });

  it("resolves the call BEFORE writing anything, and writes once", async () => {
    await post("tok_abc", { DialCallStatus: "completed" });
    expect(events[0]).toBe("token");
    expect(events.filter((e) => e === "outcome")).toHaveLength(1);
  });

  it("reads the profile for the token's account, not one from the request", async () => {
    await post("tok_abc", { DialCallStatus: "busy", AccountSid: "acct-ATTACKER" });
    expect(getVoiceProfileMock).toHaveBeenCalledWith(expect.anything(), "acct1");
  });

  it("a missing status hangs up and stamps nothing — we do not know what happened", async () => {
    const xml = await post("tok_abc", {});
    expect(setCallOutcomeMock).not.toHaveBeenCalled();
    expect(getCallByHandoffTokenMock).not.toHaveBeenCalled();
    expect(xml).toContain("<Hangup");
  });

  it("a missing token hangs up and never reaches the database", async () => {
    const xml = await post(undefined, { DialCallStatus: "completed" });
    expect(getCallByHandoffTokenMock).not.toHaveBeenCalled();
    expect(xml).toContain("<Hangup");
  });

  it("a blank token hangs up and never reaches the database", async () => {
    const xml = await post("   ", { DialCallStatus: "completed" });
    expect(getCallByHandoffTokenMock).not.toHaveBeenCalled();
    expect(xml).toContain("<Hangup");
  });

  it("a token in the BODY is not a credential — only the query string we wrote is", async () => {
    // The body is the carrier's own call-status form; with TELNYX_PUBLIC_KEY
    // unset every field in it comes from whoever POSTed.
    const xml = await post(undefined, { DialCallStatus: "completed", t: "tok_abc", Token: "tok_abc" });
    expect(getCallByHandoffTokenMock).not.toHaveBeenCalled();
    expect(setCallOutcomeMock).not.toHaveBeenCalled();
    expect(xml).toContain("<Hangup");
  });

  it("a stamping failure still returns valid TeXML, never a 5xx", async () => {
    setCallOutcomeMock.mockRejectedValue(new Error("boom"));
    const res = await POST(req("tok_abc", { DialCallStatus: "completed" }));
    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain("<Hangup");
  });

  it("a token lookup failure hangs up rather than 500ing at the carrier", async () => {
    getCallByHandoffTokenMock.mockRejectedValue(new Error("boom"));
    const res = await POST(req("tok_abc", { DialCallStatus: "no-answer" }));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<Hangup");
  });

  it("a profile read failure still SPEAKS — a dead line is worse than the wrong language", async () => {
    // The outer catch would launder this into `<Hangup/>`, which is the one
    // ending this route must never produce after a failed dial.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    getVoiceProfileMock.mockRejectedValue(new Error("boom"));
    const xml = await post("tok_abc", { DialCallStatus: "no-answer" });
    expect(xml).toContain("<Say");
    expect(xml).toContain("Sorry, we weren't able to reach anyone just now.");
    errSpy.mockRestore();
  });

  it("no profile row at all still speaks, in English", async () => {
    getVoiceProfileMock.mockResolvedValue(null);
    const xml = await post("tok_abc", { DialCallStatus: "busy" });
    expect(xml).toContain("Sorry, we weren't able to reach anyone just now.");
  });

  it("answers 200 and XML on every path", async () => {
    const res = await POST(req("tok_abc", { DialCallStatus: "no-answer" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/xml");
  });

  it("escapes the spoken line — copy is character data, and a raw '&' is fatal", async () => {
    // `transferFailedLine`'s text carries no `&` TODAY. It is copy, so the
    // day it does ("Mon & Fri", an apostrophe entity, a dash) the document
    // stops parsing and the caller hears the carrier's error handling
    // instead of words. This is the same class of bug that took the bridge
    // document down.
    transferFailedLineMock.mockReturnValue("Sorry — Tom & Jerry <are> out");
    const xml = await post("tok_abc", { DialCallStatus: "no-answer" });
    // Asserted as text, not parsed: the parser lives in
    // `../wellformed.test.ts`, and importing one test file from another
    // re-registers its whole suite under this file's mocks. The real
    // documents this route emits are parsed THERE.
    expect(xml).toContain("Tom &amp; Jerry");
    expect(xml).not.toContain("Tom & Jerry");
    expect(xml).toContain("&lt;are&gt;");
  });

  it("never writes the token to the log — it is the credential, not an id", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    getCallByHandoffTokenMock.mockResolvedValue(null);
    await post("tok_secret_abc", { DialCallStatus: "completed" });
    const written = [...logSpy.mock.calls, ...errSpy.mock.calls].flat().map(String).join(" ");
    expect(written).not.toContain("tok_secret_abc");
    logSpy.mockRestore();
    errSpy.mockRestore();
  });
});

describe("voice texml handoff-result route — signature enforcement matches its siblings", () => {
  it("with the key set, a request carrying no signature headers is rejected", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.TELNYX_PUBLIC_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    const res = await POST(req("tok_abc", { DialCallStatus: "completed" }));
    expect(res.status).toBe(403);
    expect(getCallByHandoffTokenMock).not.toHaveBeenCalled();
    expect(setCallOutcomeMock).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("with the key unset, no signature is required (today's state)", async () => {
    const res = await POST(req("tok_abc", { DialCallStatus: "completed" }));
    expect(res.status).toBe(200);
  });
});
