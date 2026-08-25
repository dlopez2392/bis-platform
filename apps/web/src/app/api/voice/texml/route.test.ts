import { describe, it, expect, beforeEach, vi } from "vitest";
import { GET, POST } from "./route";

const lookupMock = vi.hoisted(() => vi.fn());
vi.mock("@bis/db", () => ({
  serviceDb: () => ({}),
  getPhoneNumberByE164: (...a: unknown[]) => lookupMock(...a),
}));

beforeEach(() => {
  process.env.VOICE_OPENAI_PROJECT_ID = "proj_test123";
  lookupMock.mockReset().mockResolvedValue({ id: "pn1", account_id: "a1", e164: "+19565550999", telnyx_id: null, status: "live" });
});

describe("texml route", () => {
  it("GET on a live number embeds X-BIS-Called on the SIP URI", async () => {
    const res = await GET(new Request("https://x.example/api/voice/texml?To=%2B19565550999") as any);
    const xml = await res.text();
    expect(res.headers.get("content-type")).toContain("application/xml");
    expect(xml).toContain("<Dial answerOnBridge=\"true\">");
    expect(xml).toContain("sip:proj_test123@sip.api.openai.com;transport=tls?X-BIS-Called=%2B19565550999");
  });
  it("POST reads To from the form body", async () => {
    const body = new URLSearchParams({ To: "+19565550888", From: "+19562921696" });
    const res = await POST(new Request("https://x.example/api/voice/texml", {
      method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" },
    }) as any);
    expect(await res.text()).toContain("X-BIS-Called=%2B19565550888");
  });
  it("an unknown number gets the polite refusal, never a Dial", async () => {
    lookupMock.mockResolvedValue(null);
    const res = await GET(new Request("https://x.example/api/voice/texml?To=%2B19560000000") as any);
    const xml = await res.text();
    expect(xml).toContain("<Say>");
    expect(xml).toContain("<Hangup/>");
    expect(xml).not.toContain("<Dial");
  });
  it("a released number is refused like an unknown one", async () => {
    lookupMock.mockResolvedValue({ id: "pn1", account_id: "a1", e164: "+19565550999", telnyx_id: null, status: "released" });
    const res = await GET(new Request("https://x.example/api/voice/texml?To=%2B19565550999") as any);
    expect(await res.text()).toContain("<Hangup/>");
  });
  it("a DB failure fails OPEN — dials anyway, webhook still gates", async () => {
    lookupMock.mockRejectedValue(new Error("db down"));
    const res = await GET(new Request("https://x.example/api/voice/texml?To=%2B19565550999") as any);
    expect(await res.text()).toContain("X-BIS-Called=%2B19565550999");
  });
  it("a missing/garbage To still dials without the header (webhook falls back)", async () => {
    const res = await GET(new Request("https://x.example/api/voice/texml") as any);
    const xml = await res.text();
    expect(xml).toContain("<Sip>sip:proj_test123@sip.api.openai.com;transport=tls</Sip>");
    expect(xml).not.toContain("X-BIS-Called");
    expect(lookupMock).not.toHaveBeenCalled();
  });
  it("missing project id speaks the misconfig instead of dead air", async () => {
    delete process.env.VOICE_OPENAI_PROJECT_ID;
    const res = await GET(new Request("https://x.example/api/voice/texml") as any);
    expect(await res.text()).toContain("<Say>");
  });
});
