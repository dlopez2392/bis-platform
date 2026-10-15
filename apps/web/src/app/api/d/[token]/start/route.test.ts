import { describe, it, expect, vi, beforeEach } from "vitest";

const customerStart = vi.fn();
const customerFinish = vi.fn();
vi.mock("@/lib/document-requests/customer-upload", () => ({
  customerStart: (...a: unknown[]) => customerStart(...a),
  customerFinish: (...a: unknown[]) => customerFinish(...a),
}));
const SERVICE = { tag: "service" };
vi.mock("@bis/db", () => ({ serviceDb: () => SERVICE }));

const route = await import("./route");

const TOKEN = "A".repeat(43);
const post = (body: string, token = TOKEN) => route.POST(
  new Request(`https://app.example.com/api/d/${token}/start`, { method: "POST", body, headers: { "content-type": "application/json" } }),
  { params: Promise.resolve({ token }) },
);

beforeEach(() => {
  customerStart.mockReset().mockResolvedValue({ status: 200, body: { documentId: "d", versionId: "v", uploadUrl: "https://u" } });
  customerFinish.mockReset();
});

describe("POST /api/d/[token]/start (spec 4.4): no sign-in, the token is the proof, never cached", () => {
  it("passes the service client, params.token, the parsed body and a Date through, and returns the module's answer unchanged with no-store (mutation: always 200 -> FAILS)", async () => {
    const before = Date.now();
    customerStart.mockResolvedValueOnce({ status: 409, body: { error: "over_quota", phone: "(956) 555-0123" } });
    const res = await post(JSON.stringify({ itemKey: "insurance", size: 12 }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "over_quota", phone: "(956) 555-0123" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(customerStart).toHaveBeenCalledTimes(1);
    const [db, token, body, now] = customerStart.mock.calls[0]!;
    expect(db).toBe(SERVICE);
    expect(token).toBe(TOKEN);
    expect(body).toEqual({ itemKey: "insurance", size: 12 });
    expect(now).toBeInstanceOf(Date);
    expect((now as Date).getTime()).toBeGreaterThanOrEqual(before);
    expect(customerFinish).not.toHaveBeenCalled();
  });

  it("a success carries no-store too (mutation: no-store only on refusals -> FAILS)", async () => {
    const res = await post("{}");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ documentId: "d", versionId: "v", uploadUrl: "https://u" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("a body that is not JSON answers 400 bad_request, no-store, WITHOUT calling the module (mutation: pass null through -> FAILS)", async () => {
    for (const raw of ["not json", "", "{"]) {
      const res = await post(raw);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "bad_request" });
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
    expect(customerStart).not.toHaveBeenCalled();
  });

  it("is dynamic on the Node runtime (mutation: drop force-dynamic -> FAILS)", () => {
    expect([route.runtime, route.dynamic]).toEqual(["nodejs", "force-dynamic"]);
  });
});
