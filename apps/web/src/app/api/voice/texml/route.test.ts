import { describe, it, expect, beforeEach, vi } from "vitest";
import { GET, POST } from "./route";
import { utcDayStart } from "@/lib/voice/call-limits";

const lookupMock = vi.hoisted(() => vi.fn());
const profileMock = vi.hoisted(() => vi.fn());
const countCallsSinceMock = vi.hoisted(() => vi.fn());
const countCallsByCallerSinceMock = vi.hoisted(() => vi.fn());
vi.mock("@bis/db", () => ({
  serviceDb: () => ({}),
  getPhoneNumberByE164: (...a: unknown[]) => lookupMock(...a),
  getVoiceProfile: (...a: unknown[]) => profileMock(...a),
  countCallsSince: (...a: unknown[]) => countCallsSinceMock(...a),
  countCallsByCallerSince: (...a: unknown[]) => countCallsByCallerSinceMock(...a),
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
  lookupMock.mockReset().mockResolvedValue({ id: "pn1", account_id: "a1", e164: "+19565550999", telnyx_id: null, status: "live" });
  // Default: enabled, under the (default 5/day) cap — the pre-existing "dial"
  // tests below never mention a profile or caps, so they need this to still
  // reach `<Dial>` now that classify() checks both.
  profileMock.mockReset().mockResolvedValue(ENABLED_PROFILE);
  countCallsSinceMock.mockReset().mockResolvedValue(0);
  countCallsByCallerSinceMock.mockReset().mockResolvedValue(0);
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
