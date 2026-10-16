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

const TOKEN = "B".repeat(43);
const post = (body: string, token = TOKEN) => route.POST(
  new Request(`https://app.example.com/api/d/${token}/finish`, { method: "POST", body, headers: { "content-type": "application/json" } }),
  { params: Promise.resolve({ token }) },
);

beforeEach(() => {
  customerFinish.mockReset().mockResolvedValue({ status: 200, body: { state: "checking" } });
  customerStart.mockReset();
});

describe("POST /api/d/[token]/finish (spec 4.4): no sign-in, the token is the proof, never cached", () => {
  it("passes the service client, params.token, the parsed body and a Date through, and returns the module's answer unchanged with no-store (mutation: always 200 -> FAILS)", async () => {
    const before = Date.now();
    customerFinish.mockResolvedValueOnce({ status: 410, body: { error: "revoked" } });
    const res = await post(JSON.stringify({ documentId: "d", versionId: "v" }));
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: "revoked" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(customerFinish).toHaveBeenCalledTimes(1);
    const [db, token, body, now] = customerFinish.mock.calls[0]!;
    expect(db).toBe(SERVICE);
    expect(token).toBe(TOKEN);
    expect(body).toEqual({ documentId: "d", versionId: "v" });
    expect(now).toBeInstanceOf(Date);
    expect((now as Date).getTime()).toBeGreaterThanOrEqual(before);
    expect(customerStart).not.toHaveBeenCalled();
  });

  it("a success carries no-store too (mutation: no-store only on refusals -> FAILS)", async () => {
    const res = await post("{}");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state: "checking" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("a body that is not JSON answers 400 bad_request, no-store, WITHOUT calling the module (mutation: pass null through -> FAILS)", async () => {
    for (const raw of ["not json", "", "{"]) {
      const res = await post(raw);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "bad_request" });
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
    expect(customerFinish).not.toHaveBeenCalled();
  });

  it("is dynamic on the Node runtime and may run 60 s, because it waits for the scan (2a: up to 30 s) (mutation: drop maxDuration -> FAILS)", () => {
    expect([route.runtime, route.dynamic, route.maxDuration]).toEqual(["nodejs", "force-dynamic", 60]);
  });
});
