import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GET, POST } from "./route";
import { utcDayStart } from "@/lib/voice/call-limits";

const lookupMock = vi.hoisted(() => vi.fn());
const profileMock = vi.hoisted(() => vi.fn());
const countCallsSinceMock = vi.hoisted(() => vi.fn());
const countCallsByCallerSinceMock = vi.hoisted(() => vi.fn());
const countCallerHistorySinceMock = vi.hoisted(() => vi.fn());
vi.mock("@bis/db", () => ({
  serviceDb: () => ({}),
  getPhoneNumberByE164: (...a: unknown[]) => lookupMock(...a),
  getVoiceProfile: (...a: unknown[]) => profileMock(...a),
  countCallsSince: (...a: unknown[]) => countCallsSinceMock(...a),
  countCallsByCallerSince: (...a: unknown[]) => countCallsByCallerSinceMock(...a),
  countCallerHistorySince: (...a: unknown[]) => countCallerHistorySinceMock(...a),
}));

const ENABLED_PROFILE = {
  id: "vp1", account_id: "a1", persona_name: "Sofía",
  greeting_en: "Hi", greeting_es: "Hola", facts: "-", services: "-",
  languages: "en" as const, booking_enabled: true,
  after_hours: "hours_then_message" as const, enabled: true,
};

beforeEach(() => {
  process.env.VOICE_OPENAI_PROJECT_ID = "proj_test123";
  delete process.env.PHONE_MAX_CALLS_PER_NUMBER_PER_DAY;
  delete process.env.PHONE_MAX_CALLS_PER_ACCOUNT_PER_DAY;
  delete process.env.TELNYX_PUBLIC_KEY;
  delete process.env.PHONE_SPAM_BLOCK_THRESHOLD;
  delete process.env.PHONE_SPAM_BLOCK_WINDOW_DAYS;
  lookupMock.mockReset().mockResolvedValue({ id: "pn1", account_id: "a1", e164: "+19565550999", telnyx_id: null, status: "live" });
  // Default: enabled, under the (default 5/day) cap — the pre-existing "dial"
  // tests below never mention a profile or caps, so they need this to still
  // reach `<Dial>` now that classify() checks both.
  profileMock.mockReset().mockResolvedValue(ENABLED_PROFILE);
  countCallsSinceMock.mockReset().mockResolvedValue(0);
  countCallsByCallerSinceMock.mockReset().mockResolvedValue(0);
  // A clean caller by default, so every pre-existing test above still reaches
  // the verdict it was written for now that classify() also reads reputation.
  countCallerHistorySinceMock.mockReset().mockResolvedValue({ spamCalls: 0, otherCalls: 0 });
});

describe("texml route", () => {
  it("GET on a live number embeds X-BIS-Called on the SIP URI", async () => {
    const res = await GET(new Request("https://x.example/api/voice/texml?To=%2B19565550999"));
    const xml = await res.text();
    expect(res.headers.get("content-type")).toContain("application/xml");
    expect(xml).toContain("<Dial answerOnBridge=\"true\">");
    expect(xml).toContain("sip:proj_test123@sip.api.openai.com;transport=tls?X-BIS-Called=%2B19565550999");
  });
  it("POST reads To from the form body", async () => {
    const body = new URLSearchParams({ To: "+19565550888", From: "+19562921696" });
    const res = await POST(new Request("https://x.example/api/voice/texml", {
      method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" },
    }));
    expect(await res.text()).toContain("X-BIS-Called=%2B19565550888");
  });
  it("an unknown number gets the polite refusal, never a Dial", async () => {
    lookupMock.mockResolvedValue(null);
    const res = await GET(new Request("https://x.example/api/voice/texml?To=%2B19560000000"));
    const xml = await res.text();
    expect(xml).toContain("<Say>");
    expect(xml).toContain("<Hangup/>");
    expect(xml).not.toContain("<Dial");
  });
  it("a released number is refused like an unknown one", async () => {
    lookupMock.mockResolvedValue({ id: "pn1", account_id: "a1", e164: "+19565550999", telnyx_id: null, status: "released" });
    const res = await GET(new Request("https://x.example/api/voice/texml?To=%2B19565550999"));
    expect(await res.text()).toContain("<Hangup/>");
  });
  it("a DB failure fails OPEN — dials anyway, webhook still gates", async () => {
    lookupMock.mockRejectedValue(new Error("db down"));
    const res = await GET(new Request("https://x.example/api/voice/texml?To=%2B19565550999"));
    expect(await res.text()).toContain("X-BIS-Called=%2B19565550999");
  });
  it("a missing/garbage To still dials without the header (webhook falls back)", async () => {
    const res = await GET(new Request("https://x.example/api/voice/texml"));
    const xml = await res.text();
    expect(xml).toContain("<Sip>sip:proj_test123@sip.api.openai.com;transport=tls</Sip>");
    expect(xml).not.toContain("X-BIS-Called");
    expect(lookupMock).not.toHaveBeenCalled();
  });
  it("missing project id speaks the misconfig instead of dead air", async () => {
    delete process.env.VOICE_OPENAI_PROJECT_ID;
    const res = await GET(new Request("https://x.example/api/voice/texml"));
    expect(await res.text()).toContain("<Say>");
  });
});

describe("texml route — disabled profile refusal (spoken, bilingual)", () => {
  it("known number + enabled:false profile → spoken refusal, no Dial", async () => {
    profileMock.mockResolvedValue({ ...ENABLED_PROFILE, enabled: false, languages: "en" });
    const res = await GET(new Request("https://x.example/api/voice/texml?To=%2B19565550999"));
    const xml = await res.text();
    expect(xml).toContain("<Say>");
    expect(xml).toContain("<Hangup/>");
    expect(xml).not.toContain("<Dial");
  });
  it("status testing + enabled:false profile → Dials anyway (testing answers regardless of the toggle)", async () => {
    lookupMock.mockResolvedValue({ id: "pn1", account_id: "a1", e164: "+19565550999", telnyx_id: null, status: "testing" });
    profileMock.mockResolvedValue({ ...ENABLED_PROFILE, enabled: false, languages: "en" });
    const res = await GET(new Request("https://x.example/api/voice/texml?To=%2B19565550999"));
    const xml = await res.text();
    expect(xml).toContain("<Dial");
    expect(xml).not.toContain("<Say>Sorry");
  });

  it("status live + enabled:false profile → spoken refusal (live keeps requiring the toggle)", async () => {
    lookupMock.mockResolvedValue({ id: "pn1", account_id: "a1", e164: "+19565550999", telnyx_id: null, status: "live" });
    profileMock.mockResolvedValue({ ...ENABLED_PROFILE, enabled: false, languages: "en" });
    const res = await GET(new Request("https://x.example/api/voice/texml?To=%2B19565550999"));
    const xml = await res.text();
    expect(xml).not.toContain("<Dial");
    expect(xml).toContain("<Say>Sorry");
  });

  it("profile missing entirely → refusal defaults to English", async () => {
    profileMock.mockResolvedValue(null);
    const res = await GET(new Request("https://x.example/api/voice/texml?To=%2B19565550999"));
    const xml = await res.text();
    expect(xml).toContain("Sorry, this number can't take your call right now. Please try again later.");
    expect(xml).not.toContain("<Dial");
  });
  it("existing English refusal sentence stays byte-identical", async () => {
    profileMock.mockResolvedValue({ ...ENABLED_PROFILE, enabled: false, languages: "en" });
    const res = await GET(new Request("https://x.example/api/voice/texml?To=%2B19565550999"));
    const xml = await res.text();
    expect(xml).toContain("<Say>Sorry, this number can't take your call right now. Please try again later.</Say>");
  });
  it("languages: es → language=\"es-MX\" Say with the Spanish copy, English absent", async () => {
    profileMock.mockResolvedValue({ ...ENABLED_PROFILE, enabled: false, languages: "es" });
    const res = await GET(new Request("https://x.example/api/voice/texml?To=%2B19565550999"));
    const xml = await res.text();
    expect(xml).toContain("<Say language=\"es-MX\">Lo sentimos, este número no puede atender su llamada en este momento. Por favor intente más tarde.</Say>");
    expect(xml).not.toContain("<Say>Sorry");
    expect(xml).not.toContain("<Dial");
  });
  it("languages: both → English then Spanish, both Say elements present", async () => {
    profileMock.mockResolvedValue({ ...ENABLED_PROFILE, enabled: false, languages: "both" });
    const res = await GET(new Request("https://x.example/api/voice/texml?To=%2B19565550999"));
    const xml = await res.text();
    expect(xml).toContain("<Say>Sorry, this number can't take your call right now. Please try again later.</Say>");
    expect(xml).toContain("<Say language=\"es-MX\">Lo sentimos, este número no puede atender su llamada en este momento. Por favor intente más tarde.</Say>");
    // English must come first — order matters for a caller hearing it live.
    expect(xml.indexOf("Sorry")).toBeLessThan(xml.indexOf("Lo sentimos"));
  });
});

describe("texml route — daily call cap refusal (spoken, bilingual)", () => {
  it("over the per-number cap (default 5) → cap copy, no Dial", async () => {
    countCallsByCallerSinceMock.mockResolvedValue(5);
    const res = await GET(new Request("https://x.example/api/voice/texml?To=%2B19565550999&From=%2B19562921696"));
    const xml = await res.text();
    expect(xml).toContain("We're sorry");
    expect(xml).toContain("can't take more calls today");
    expect(xml).not.toContain("<Dial");
  });
  it("cap refusal honors the profile's language (es)", async () => {
    profileMock.mockResolvedValue({ ...ENABLED_PROFILE, enabled: true, languages: "es" });
    countCallsByCallerSinceMock.mockResolvedValue(5);
    const res = await GET(new Request("https://x.example/api/voice/texml?To=%2B19565550999&From=%2B19562921696"));
    const xml = await res.text();
    expect(xml).toContain("<Say language=\"es-MX\">Lo sentimos — hoy ya no podemos atender más llamadas. Por favor llame mañana.</Say>");
    expect(xml).not.toContain("<Dial");
  });
  it("over the per-account cap (default 50) while the per-caller count is 0 → cap copy, no Dial", async () => {
    countCallsSinceMock.mockResolvedValue(50);
    countCallsByCallerSinceMock.mockResolvedValue(0);
    const res = await GET(new Request("https://x.example/api/voice/texml?To=%2B19565550999&From=%2B19562921696"));
    const xml = await res.text();
    expect(xml).toContain("We're sorry");
    expect(xml).toContain("can't take more calls today");
    expect(xml).not.toContain("<Dial");
  });
  it("under cap + enabled → Dial present (existing behavior intact)", async () => {
    countCallsSinceMock.mockResolvedValue(1);
    countCallsByCallerSinceMock.mockResolvedValue(1);
    const res = await GET(new Request("https://x.example/api/voice/texml?To=%2B19565550999&From=%2B19562921696"));
    const xml = await res.text();
    expect(xml).toContain("<Dial answerOnBridge=\"true\">");
  });
  it("counts are queried from midnight UTC of today, not an unpinned Date().toISOString()", async () => {
    const expectedSince = utcDayStart(new Date());
    await GET(new Request("https://x.example/api/voice/texml?To=%2B19565550999&From=%2B19562921696"));
    expect(countCallsSinceMock).toHaveBeenCalledWith(expect.anything(), "a1", expectedSince);
    expect(countCallsByCallerSinceMock).toHaveBeenCalledWith(expect.anything(), "a1", "+19562921696", expectedSince);
  });
  it("getVoiceProfile rejecting fails open — Dial present through the outer catch", async () => {
    profileMock.mockRejectedValue(new Error("db down"));
    const res = await GET(new Request("https://x.example/api/voice/texml?To=%2B19565550999"));
    const xml = await res.text();
    expect(xml).toContain("<Dial answerOnBridge=\"true\">");
  });
  it("cap-count lookup throws → Dial present (fail-open pin)", async () => {
    countCallsByCallerSinceMock.mockRejectedValue(new Error("db down"));
    const res = await GET(new Request("https://x.example/api/voice/texml?To=%2B19565550999&From=%2B19562921696"));
    const xml = await res.text();
    expect(xml).toContain("<Dial answerOnBridge=\"true\">");
  });
  it("POST also reads From from the form body for cap counting", async () => {
    countCallsByCallerSinceMock.mockResolvedValue(5);
    const body = new URLSearchParams({ To: "+19565550999", From: "+19562921696" });
    const res = await POST(new Request("https://x.example/api/voice/texml", {
      method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" },
    }));
    const xml = await res.text();
    expect(xml).toContain("can't take more calls today");
    expect(countCallsByCallerSinceMock).toHaveBeenCalledWith(expect.anything(), "a1", "+19562921696", utcDayStart(new Date()));
  });
});

describe("texml route — Telnyx signature validation (TELNYX_PUBLIC_KEY set)", () => {
  function makeSigned(body: string, timestamp: string) {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const sig = cryptoSign(null, Buffer.from(`${timestamp}|${body}`, "utf8"), privateKey);
    const spki = publicKey.export({ format: "der", type: "spki" }) as Buffer;
    return {
      publicKeyB64: spki.subarray(spki.length - 32).toString("base64"),
      signatureB64: sig.toString("base64"),
    };
  }

  afterEach(() => {
    delete process.env.TELNYX_PUBLIC_KEY;
  });

  it("POST with no signature headers → 403, logged as missing-headers with the claimed To/From", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // Any base64 works here — the missing headers short-circuit before the
    // key is ever parsed.
    process.env.TELNYX_PUBLIC_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    const raw = new URLSearchParams({ To: "+19565550999", From: "+19562921696" }).toString();
    const res = await POST(new Request("https://x.example/api/voice/texml", {
      method: "POST", body: raw, headers: { "content-type": "application/x-www-form-urlencoded" },
    }));
    expect(res.status).toBe(403);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("missing-headers"));
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("+19565550999"));
    errSpy.mockRestore();
  });

  it("POST with a log-injection attempt in claimed To/From → sanitized to \"none\", never the raw value", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.TELNYX_PUBLIC_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    const raw = new URLSearchParams({
      To: "not-a-number\ntexml: rejected request (forged) fake-decline-line",
      From: "also-garbage",
    }).toString();
    const res = await POST(new Request("https://x.example/api/voice/texml", {
      method: "POST", body: raw, headers: { "content-type": "application/x-www-form-urlencoded" },
    }));
    expect(res.status).toBe(403);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("claimedTo none, claimedFrom none"));
    expect(errSpy).not.toHaveBeenCalledWith(expect.stringContaining("forged"));
    errSpy.mockRestore();
  });

  it("POST with a tampered/invalid signature → 403, logged as invalid-signature with the claimed To/From", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const raw = new URLSearchParams({ To: "+19565550999", From: "+19562921696" }).toString();
    const ts = String(Math.floor(Date.now() / 1000));
    const { publicKeyB64, signatureB64 } = makeSigned(raw, ts);
    process.env.TELNYX_PUBLIC_KEY = publicKeyB64;
    const res = await POST(new Request("https://x.example/api/voice/texml", {
      method: "POST",
      body: raw + "&x=1", // tampered after signing
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "telnyx-timestamp": ts,
        "telnyx-signature-ed25519": signatureB64,
      },
    }));
    expect(res.status).toBe(403);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("invalid-signature"));
    errSpy.mockRestore();
  });

  it("POST with a valid signature → normal XML (Dial present)", async () => {
    const raw = new URLSearchParams({ To: "+19565550999", From: "+19562921696" }).toString();
    const ts = String(Math.floor(Date.now() / 1000));
    const { publicKeyB64, signatureB64 } = makeSigned(raw, ts);
    process.env.TELNYX_PUBLIC_KEY = publicKeyB64;
    const res = await POST(new Request("https://x.example/api/voice/texml", {
      method: "POST",
      body: raw,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "telnyx-timestamp": ts,
        "telnyx-signature-ed25519": signatureB64,
      },
    }));
    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain("<Dial answerOnBridge=\"true\">");
    expect(xml).toContain("X-BIS-Called=%2B19565550999");
  });

  it("POST with a stale timestamp (now-400s) → 403 even with an otherwise-valid signature", async () => {
    const raw = new URLSearchParams({ To: "+19565550999", From: "+19562921696" }).toString();
    const stale = String(Math.floor(Date.now() / 1000) - 400);
    const { publicKeyB64, signatureB64 } = makeSigned(raw, stale);
    process.env.TELNYX_PUBLIC_KEY = publicKeyB64;
    const res = await POST(new Request("https://x.example/api/voice/texml", {
      method: "POST",
      body: raw,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "telnyx-timestamp": stale,
        "telnyx-signature-ed25519": signatureB64,
      },
    }));
    expect(res.status).toBe(403);
  });

  it("GET → 405 (the diagnostic path closes in hardened mode)", async () => {
    process.env.TELNYX_PUBLIC_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    const res = await GET(new Request("https://x.example/api/voice/texml?To=%2B19565550999"));
    expect(res.status).toBe(405);
    expect(lookupMock).not.toHaveBeenCalled();
  });
});

describe("texml route — guarded body read (Finding B)", () => {
  afterEach(() => {
    delete process.env.TELNYX_PUBLIC_KEY;
  });

  it("a body-read failure with the key SET fails closed (403), never a 500", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.TELNYX_PUBLIC_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    const req = new Request("https://x.example/api/voice/texml", {
      method: "POST", body: "To=%2B19565550999", headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    vi.spyOn(req, "text").mockRejectedValue(new Error("stream error"));
    const res = await POST(req);
    expect(res.status).toBe(403);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("failed to read request body"));
    errSpy.mockRestore();
  });

  it("a body-read failure with the key UNSET fails open — dials (old behavior preserved)", async () => {
    const req = new Request("https://x.example/api/voice/texml", {
      method: "POST", body: "To=%2B19565550999", headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    vi.spyOn(req, "text").mockRejectedValue(new Error("stream error"));
    const res = await POST(req);
    const xml = await res.text();
    expect(xml).toContain("<Dial answerOnBridge=\"true\">");
    expect(xml).not.toContain("X-BIS-Called");
  });
});

// The live number the fixture above hands back from getPhoneNumberByE164, and
// a caller with no history of speaking to anyone.
const LIVE_TO = "+19565550999";
const SILENT_CALLER = "+19565550301";

async function texmlXml(params: { To?: string; From?: string }): Promise<string> {
  const q = new URLSearchParams();
  if (params.To) q.set("To", params.To);
  if (params.From) q.set("From", params.From);
  const res = await GET(new Request(`https://x.example/api/voice/texml?${q.toString()}`));
  return res.text();
}

describe("texml route — repeat-offender refusal (Guard 2)", () => {
  it("a caller with nothing but silent calls is refused, and never gets a Dial", async () => {
    countCallerHistorySinceMock.mockResolvedValue({ spamCalls: 3, otherCalls: 0 });
    const xml = await texmlXml({ To: LIVE_TO, From: SILENT_CALLER });
    expect(xml).toContain("Sorry, this number can't take your call right now.");
    expect(xml).not.toContain("<Dial");
  });

  it("a caller with ANY good outcome is dialled, however much spam they also have", async () => {
    // The live-data shape: the top spam caller is also the top booker.
    countCallerHistorySinceMock.mockResolvedValue({ spamCalls: 4, otherCalls: 13 });
    const xml = await texmlXml({ To: LIVE_TO, From: "+19562921696" });
    expect(xml).toContain("<Dial");
  });

  it("uses the EXISTING refusal copy — no new sentence is introduced", async () => {
    countCallerHistorySinceMock.mockResolvedValue({ spamCalls: 3, otherCalls: 0 });
    const xml = await texmlXml({ To: LIVE_TO, From: SILENT_CALLER });
    // Byte-identical to the sentence the disabled-profile test above pins.
    expect(xml).toContain("<Say>Sorry, this number can't take your call right now. Please try again later.</Say>");
  });

  it("the history read failing fails OPEN — a database blip dials, never refuses", async () => {
    countCallerHistorySinceMock.mockRejectedValue(new Error("boom"));
    const xml = await texmlXml({ To: LIVE_TO, From: SILENT_CALLER });
    expect(xml).toContain("<Dial");
  });

  it("is read over the DEFAULT rolling window, from the caller and account in hand", async () => {
    countCallerHistorySinceMock.mockResolvedValue({ spamCalls: 0, otherCalls: 0 });
    await texmlXml({ To: LIVE_TO, From: SILENT_CALLER });
    expect(countCallerHistorySinceMock).toHaveBeenCalledWith(
      expect.anything(), "a1", SILENT_CALLER, expect.any(String),
    );
    const since = new Date(countCallerHistorySinceMock.mock.calls[0]![3] as string);
    const days = (Date.now() - since.getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
  });

  // BOTH KNOBS, EXERCISED RATHER THAN DELETED. Every other test in this file
  // only `delete`s these env vars, so replacing `readReputationConfig()` with a
  // hardcoded `{ threshold: 3, windowDays: 30 }` left the whole suite green and
  // the test above could not tell configured from hardcoded. An operator
  // turning a knob to relieve a false-positive block on a real customer would
  // have got no effect and no signal — possibly at one gate and not the other.
  // `beforeEach` deletes both, so setting one here cannot leak into a sibling.
  it("the WINDOW knob reaches this gate — PHONE_SPAM_BLOCK_WINDOW_DAYS=7 reads 7 days back, not 30", async () => {
    process.env.PHONE_SPAM_BLOCK_WINDOW_DAYS = "7";
    await texmlXml({ To: LIVE_TO, From: SILENT_CALLER });
    const since = new Date(countCallerHistorySinceMock.mock.calls[0]![3] as string);
    const days = (Date.now() - since.getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
  });

  // Also the threshold's only near-miss at route level: 4 silent calls against
  // a threshold of 5 must dial. `decideReputation` is non-strict (`>=`), so an
  // off-by-one here is a caller refused one call early.
  it("the THRESHOLD knob reaches this gate — PHONE_SPAM_BLOCK_THRESHOLD=5 dials a caller with 4 silent calls", async () => {
    process.env.PHONE_SPAM_BLOCK_THRESHOLD = "5";
    countCallerHistorySinceMock.mockResolvedValue({ spamCalls: 4, otherCalls: 0 });
    const xml = await texmlXml({ To: LIVE_TO, From: SILENT_CALLER });
    expect(xml).toContain("<Dial");
    expect(xml).not.toContain("<Say");
  });

  // REPUTATION IS DECIDED BEFORE THE CAP, and until this case existed the two
  // branches never contended: no test arranged a caller who is BOTH over the
  // cap and a known repeat offender, so swapping `decideReputation` and
  // `decideLimit` in `classify()` left 50/50 green. It is not cosmetic. They
  // emit different copy — under a reversal a robot hears "we can't take more
  // calls today. Please call back tomorrow", which invites it back — and
  // different log lines, and `texml declined blocked (repeat-spam)` is the
  // ONLY telemetry Guard 2 produces at all.
  it("a caller who is BOTH over the cap and a repeat offender hears the refusal, not the cap copy", async () => {
    countCallsByCallerSinceMock.mockResolvedValue(9); // well past the default cap of 5
    countCallerHistorySinceMock.mockResolvedValue({ spamCalls: 3, otherCalls: 0 });
    const xml = await texmlXml({ To: LIVE_TO, From: SILENT_CALLER });
    expect(xml).toContain("Sorry, this number can't take your call right now. Please try again later.");
    expect(xml).not.toContain("can't take more calls today");
    expect(xml).not.toContain("<Dial");
  });

  // The blocked verdict passes `profile.languages` through like every other
  // refusal. The other two refusal kinds each have a Spanish pin; without this
  // one, hardcoding "en" on the blocked branch left 50/50 green and an
  // es-only client's wrongly-blocked caller would start hearing English.
  it("the blocked refusal honors the profile's language (es)", async () => {
    profileMock.mockResolvedValue({ ...ENABLED_PROFILE, languages: "es" });
    countCallerHistorySinceMock.mockResolvedValue({ spamCalls: 3, otherCalls: 0 });
    const xml = await texmlXml({ To: LIVE_TO, From: SILENT_CALLER });
    expect(xml).toContain("<Say language=\"es-MX\">Lo sentimos, este número no puede atender su llamada en este momento. Por favor intente más tarde.</Say>");
    expect(xml).not.toContain("<Say>Sorry");
    expect(xml).not.toContain("<Dial");
  });

  it("a caller with no number at all is not blocked — there is no history to read", async () => {
    const xml = await texmlXml({ To: LIVE_TO });
    expect(xml).toContain("<Dial");
    expect(countCallerHistorySinceMock).not.toHaveBeenCalled();
  });

  it("rides the SAME round trip as the cap counts — it never waits for them", async () => {
    // This route sits on Telnyx's carrier answer-deadline, so Guard 2 must
    // cost no extra wall-clock: all three reads start before any of them
    // finishes. A sequential `await` before the cap block would still fail
    // open and still refuse correctly — only this test can see the extra
    // round trip.
    const events: string[] = [];
    const traced = <T,>(name: string, value: T) => () => {
      events.push(`start:${name}`);
      return new Promise<T>((resolve) => setTimeout(() => {
        events.push(`end:${name}`);
        resolve(value);
      }, 0));
    };
    countCallsSinceMock.mockImplementation(traced("account", 0));
    countCallsByCallerSinceMock.mockImplementation(traced("caller", 0));
    countCallerHistorySinceMock.mockImplementation(traced("history", { spamCalls: 0, otherCalls: 0 }));

    const xml = await texmlXml({ To: LIVE_TO, From: SILENT_CALLER });

    expect(xml).toContain("<Dial");
    expect(events.filter((e) => e.startsWith("start:"))).toHaveLength(3);
    // All three are in flight before ANY of them comes back. Asserted on the
    // first three events rather than on history's own position: history
    // running FIRST and the caps waiting on it is still a second round trip.
    expect(events.slice(0, 3).sort()).toEqual(["start:account", "start:caller", "start:history"]);
  });
});

describe("texml route — a refusal and the bridge are mutually exclusive", () => {
  // The ordering guarantee this architecture admits. Every verdict produces
  // EITHER spoken refusal copy OR a bridge, never both and never neither.
  //
  // Be honest about what this is: it is not an assertion about call order, and
  // it cannot be — `classify()` and `dialXml()` are module-private. It is a
  // structural invariant over every verdict, which is the strongest pin
  // available while one response body holds the whole decision. It is what
  // would catch a future screen-then-bridge design where a <Gather> and a
  // <Dial> could legitimately coexist in one document. Each case also names
  // the side it must land on, so a verdict that quietly flips to the other
  // side fails here too. The ordering itself is proven by mutation, not by
  // this test.
  const cases: [string, "refusal" | "bridge", () => void][] = [
    ["unknown number", "refusal", () => { lookupMock.mockResolvedValue(null); }],
    ["disabled profile", "refusal", () => { profileMock.mockResolvedValue({ ...ENABLED_PROFILE, enabled: false }); }],
    ["over the cap", "refusal", () => { countCallsByCallerSinceMock.mockResolvedValue(9); }],
    ["repeat offender", "refusal", () => { countCallerHistorySinceMock.mockResolvedValue({ spamCalls: 3, otherCalls: 0 }); }],
    ["allowed", "bridge", () => {}],
  ];

  for (const [name, expected, arrange] of cases) {
    it(`${name}: exactly one of refusal-copy or <Dial> is present, and it is the ${expected}`, async () => {
      arrange();
      const xml = await texmlXml({ To: LIVE_TO, From: SILENT_CALLER });
      const refused = xml.includes("<Say");
      const bridged = xml.includes("<Dial");
      expect(refused !== bridged).toBe(true);
      expect(refused ? "refusal" : "bridge").toBe(expected);
    });
  }
});
