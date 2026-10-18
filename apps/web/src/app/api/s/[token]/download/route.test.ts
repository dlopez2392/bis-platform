import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const shareDownload = vi.fn();
vi.mock("@/lib/document-shares/public-share", () => ({ shareDownload: (...a: unknown[]) => shareDownload(...a) }));
const SERVICE = { tag: "service" };
vi.mock("@bis/db", () => ({ serviceDb: () => SERVICE }));

const route = await import("./route");
const { hashIp } = await import("@/lib/forms/guards");

const TOKEN = "A".repeat(43);
const post = (headers: Record<string, string> = {}, token = TOKEN) => route.POST(
  new Request(`https://app.example.com/api/s/${token}/download`, { method: "POST", headers }),
  { params: Promise.resolve({ token }) },
);
const THREE = (res: Response) => [res.headers.get("cache-control"), res.headers.get("referrer-policy"), res.headers.get("x-robots-tag")];
const WANT_HEADERS = ["no-store", "no-referrer", "noindex"];

let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.stubEnv("FORM_TOKEN_SECRET", "unit-only-form-secret");
  shareDownload.mockReset().mockResolvedValue({ status: 200, body: { url: "https://signed.example/x" } });
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  errSpy.mockRestore();
});

describe("POST /api/s/[token]/download (spec 4.2): no sign-in, the token is the proof", () => {
  it("passes the service client, params.token, the forms limiter's HASH of the address and a Date (mutation: the raw address -> FAILS)", async () => {
    const before = Date.now();
    await post({ "x-vercel-forwarded-for": "203.0.113.9" });
    expect(shareDownload).toHaveBeenCalledTimes(1);
    const [db, token, ipHash, now] = shareDownload.mock.calls[0]!;
    expect(db).toBe(SERVICE);
    expect(token).toBe(TOKEN);
    expect(ipHash).toBe(hashIp("203.0.113.9"));
    expect(ipHash).not.toContain("203.0.113.9");
    expect(now).toBeInstanceOf(Date);
    expect((now as Date).getTime()).toBeGreaterThanOrEqual(before);
  });

  it.each([
    [200, { url: "https://signed.example/x" }],
    [410, { error: "unavailable" }],
    [429, { error: "rate_limited" }],
    [503, { error: "failed" }],
  ])("answers the module's %i and body unchanged, with all three headers (mutations: always 200; drop a header -> FAILS)", async (status, body) => {
    shareDownload.mockResolvedValueOnce({ status, body });
    const res = await post();
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual(body);
    expect(THREE(res)).toEqual(WANT_HEADERS);
  });

  it("no address key (no form secret, no service key) answers 503 failed with the headers and never calls the module", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("FORM_TOKEN_SECRET", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const res = await post({ "x-vercel-forwarded-for": "203.0.113.9" });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "failed" });
    expect(THREE(res)).toEqual(WANT_HEADERS);
    expect(shareDownload).not.toHaveBeenCalled();
    for (const c of errSpy.mock.calls) expect(c.map(String).join(" ")).not.toContain(TOKEN);
  });

  it("is dynamic on the Node runtime", () => {
    expect([route.runtime, route.dynamic]).toEqual(["nodejs", "force-dynamic"]);
  });
});
