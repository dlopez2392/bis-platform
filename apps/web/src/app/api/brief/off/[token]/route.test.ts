import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const db = vi.hoisted(() => ({ serviceDb: vi.fn(), unsubscribeFromBrief: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...db }));

import { POST, GET } from "./route";
import { sealBriefToken } from "@/lib/brief/token";
import { sealConsentToken } from "@/lib/consent/token";

const SECRET = "route-test-secret-0123456789abcdef-012";
const SUB = "4b1d6f0e-3c1a-4e2b-9a55-0f7a1c2d3e4f";
const token = () => sealBriefToken({ v: 1, s: SUB, i: 1_790_000_000_000 }, SECRET);
const ctx = (t: string) => ({ params: Promise.resolve({ token: t }) });
const post = (t: string, body = "List-Unsubscribe=One-Click") => POST(
  new Request(`https://app.example.com/api/brief/off/${t}`, {
    method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" },
  }), ctx(t));

beforeEach(() => {
  db.serviceDb.mockReset().mockReturnValue({ tag: "service" });
  db.unsubscribeFromBrief.mockReset().mockResolvedValue(true);
  vi.stubEnv("CONSENT_TOKEN_SECRET", SECRET);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/brief/off/[token]: the one-click way off", () => {
  it("a valid token deletes that subscription and answers 200 with an empty body, no-store, no redirect", async () => {
    const res = await post(token());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("location")).toBeNull();
    expect(db.unsubscribeFromBrief).toHaveBeenCalledTimes(1);
    expect(db.unsubscribeFromBrief).toHaveBeenCalledWith({ tag: "service" }, { id: SUB });
  });

  it("is idempotent: a subscription that is already gone is still 200, and a second press is the same", async () => {
    db.unsubscribeFromBrief.mockResolvedValue(false);
    expect((await post(token())).status).toBe(200);
    expect((await post(token())).status).toBe(200);
    expect(db.unsubscribeFromBrief).toHaveBeenCalledTimes(2);
  });

  it("accepts any body, even none: the token is the proof (a client that posts nothing can still turn it off)", async () => {
    expect((await post(token(), "")).status).toBe(200);
  });

  it("a bad token is 400 and touches nothing: forged, truncated, and a CONSENT token", async () => {
    const consent = sealConsentToken({ v: 1, a: SUB, c: "email", t: "ana@example.com", i: 1, n: null }, SECRET);
    for (const bad of ["1.forged.token", "junk", token().slice(0, -3), consent]) {
      const res = await post(bad);
      expect(res.status, bad.slice(0, 12)).toBe(400);
      expect(await res.text()).toBe("");
    }
    expect(db.unsubscribeFromBrief).not.toHaveBeenCalled();
    expect(db.serviceDb).not.toHaveBeenCalled();
  });

  it("CONSENT_TOKEN_SECRET unset is 503 and makes NO database query (not even a client)", async () => {
    const t = token();
    vi.stubEnv("CONSENT_TOKEN_SECRET", "");
    const res = await post(t);
    expect(res.status).toBe(503);
    expect(db.serviceDb).not.toHaveBeenCalled();
    expect(db.unsubscribeFromBrief).not.toHaveBeenCalled();
  });

  it("a failed write is 503 so the mail client may retry, and the log never carries the token", async () => {
    const t = token();
    db.unsubscribeFromBrief.mockRejectedValueOnce(new Error("unsubscribeFromBrief failed: timeout"));
    expect((await post(t)).status).toBe(503);
    expect(vi.mocked(console.error).mock.calls.flat().join(" ")).not.toContain(t);
  });
});

describe("GET /api/brief/off/[token]: never deletes", () => {
  it("redirects 303 to the page and changes nothing, so a scanner that prefetches the link cannot turn anyone's brief off", async () => {
    const t = token();
    const res = await GET(new Request(`https://app.example.com/api/brief/off/${t}`), ctx(t));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`https://app.example.com/brief/off/${t}`);
    expect(db.unsubscribeFromBrief).not.toHaveBeenCalled();
    expect(db.serviceDb).not.toHaveBeenCalled();
  });
});
