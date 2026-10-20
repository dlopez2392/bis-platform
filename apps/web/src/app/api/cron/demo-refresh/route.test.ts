import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET } from "./route";

/**
 * The morning demo rebuild's trigger (owner's decision, 2026-10-20). It only
 * asks GitHub to start seed-demo.yml; every refusal is pinned so the route can
 * never run open, and never from a deployment without the token.
 */
const fetchMock = vi.fn();
const authed = () => new Request("https://app.test/api/cron/demo-refresh", {
  headers: { authorization: "Bearer cron-secret" },
});

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("CRON_SECRET", "cron-secret");
  vi.stubEnv("DEMO_REFRESH_GITHUB_TOKEN", "gh-token");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("GET /api/cron/demo-refresh", () => {
  it("refuses to exist without CRON_SECRET, and calls nothing (mutation: drop the check -> FAILS)", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(authed())).status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a request without Vercel's bearer, and calls nothing", async () => {
    const res = await GET(new Request("https://app.test/api/cron/demo-refresh", { headers: { authorization: "Bearer nope" } }));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses without the GitHub token (Preview never has one), and calls nothing", async () => {
    vi.stubEnv("DEMO_REFRESH_GITHUB_TOKEN", "");
    expect((await GET(authed())).status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks GitHub to run seed-demo.yml on main with the confirmation typed (mutation: change the ref or input -> FAILS)", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const res = await GET(authed());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ dispatched: true });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.github.com/repos/dlopez2392/bis-platform/actions/workflows/seed-demo.yml/dispatches");
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe("Bearer gh-token");
    expect(JSON.parse(init.body)).toEqual({ ref: "main", inputs: { confirm: "seed" } });
  });

  it("reports a refused dispatch as 502 with GitHub's status, never as success", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 403 }));
    const res = await GET(authed());
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ dispatched: false, status: 403 });
  });
});
