import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const unsub = vi.hoisted(() => ({ recordUnsubscribe: vi.fn() }));
vi.mock("@/lib/consent/unsubscribe", async (importOriginal) => ({ ...(await importOriginal<object>()), ...unsub }));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), serviceDb: () => ({ tag: "service" }) }));

import { POST, GET } from "./route";
import { sealConsentToken } from "@/lib/consent/token";

const SECRET = "route-test-secret-0123456789abcdef-012";
const P = { v: 1 as const, a: "5b1f6a5e-6a3d-4f7e-9f65-2a0b1c3d4e5f", c: "email" as const, t: "ana@example.com", i: 1_790_000_000_000, n: null };
const post = (token: string, body = "List-Unsubscribe=One-Click") => POST(
  new Request(`https://app.example.com/api/unsubscribe/${token}`, {
    method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" },
  }), { params: Promise.resolve({ token }) });

beforeEach(() => {
  unsub.recordUnsubscribe.mockReset().mockResolvedValue("stopped");
  vi.stubEnv("CONSENT_TOKEN_SECRET", SECRET);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/unsubscribe/[token] — RFC 8058 one-click", () => {
  it("a valid token: 200, an empty body, no-store, no cookie, no redirect, and the stop recorded as one_click (X1, X2; mutation: answer 204 or a body → FAILS; mutation: record 'unsubscribe_link' → FAILS)", async () => {
    const res = await post(sealConsentToken(P, SECRET));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("location")).toBeNull();
    expect(unsub.recordUnsubscribe).toHaveBeenCalledWith({ tag: "service" }, expect.objectContaining({ a: P.a, t: P.t }), "one_click");
  });

  it("an already-stopped address is still 200 (idempotent, no second row: the guard's answer; mutation: 409 → a mail client shows an error, FAILS)", async () => {
    unsub.recordUnsubscribe.mockResolvedValueOnce("already_stopped");
    expect((await post(sealConsentToken(P, SECRET))).status).toBe(200);
  });

  it("any body, even an empty one, is accepted: the token is the proof (X2 says the receiver SENDS the pair; nothing requires the server to demand it; mutation: require the body → a client that posts none cannot unsubscribe, FAILS)", async () => {
    expect((await post(sealConsentToken(P, SECRET), "")).status).toBe(200);
  });

  it("a bad token: 400, empty, nothing recorded (mutation: 200 → FAILS)", async () => {
    const res = await post("1.forged.token");
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("");
    expect(unsub.recordUnsubscribe).not.toHaveBeenCalled();
  });

  it("no secret configured, or the write failed: 503, so the mail client can retry; logged without the token (fails closed; mutation: 200 on a failed write → a stop never recorded, FAILS)", async () => {
    const token = sealConsentToken(P, SECRET);
    unsub.recordUnsubscribe.mockRejectedValueOnce(new Error("append_consent_event failed: timeout"));
    expect((await post(token)).status).toBe(503);
    vi.stubEnv("CONSENT_TOKEN_SECRET", "");
    expect((await post(token)).status).toBe(503);
    expect(vi.mocked(console.error).mock.calls.flat().join(" ")).not.toContain(token);
  });
});

describe("GET /api/unsubscribe/[token]", () => {
  it("redirects 303 to the page, so a client that opens the header link lands where a person can act (G6; mutation: record on GET → FAILS)", async () => {
    const token = sealConsentToken(P, SECRET);
    const res = await GET(new Request(`https://app.example.com/api/unsubscribe/${token}`), { params: Promise.resolve({ token }) });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`https://app.example.com/u/${token}`);
    expect(unsub.recordUnsubscribe).not.toHaveBeenCalled();
  });
});
