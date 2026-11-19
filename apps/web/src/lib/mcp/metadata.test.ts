// The OAuth metadata the MCP client reads after its first 401 (plan 2026-11-19-mcp-server.md §3.1; spike §7.2).
// Driven through the three real route modules with real Requests; only Clerk's own metadata fetch is stubbed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as rootPrm from "@/app/.well-known/oauth-protected-resource/route";
import * as pathPrm from "@/app/.well-known/oauth-protected-resource/api/mcp/route";
import * as asMeta from "@/app/.well-known/oauth-authorization-server/route";

// pk_test_ + base64("topical-redfish-40.clerk.accounts.dev$"): the shape Clerk's keys have, decoded by mcp-tools.
const PK = `pk_test_${Buffer.from("topical-redfish-40.clerk.accounts.dev$").toString("base64")}`;
const FAPI = "https://topical-redfish-40.clerk.accounts.dev";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", PK);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("protected-resource metadata (RFC 9728), path form and root form", () => {
  it.each([["path form", pathPrm], ["root form", rootPrm]])(
    "%s names the MCP ENDPOINT as the resource, not the bare origin (mutation: protectedResourceHandlerClerk, which names the origin -> FAILS)",
    async (_label, mod) => {
      const res = mod.GET(new Request("https://app.bis-rgv.com/.well-known/oauth-protected-resource/api/mcp"));
      expect(res.status).toBe(200);
      const body = await res.json() as { resource: string; authorization_servers: string[] };
      expect(body.resource).toBe("https://app.bis-rgv.com/api/mcp");
      expect(body.authorization_servers).toEqual([FAPI]);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
    },
  );

  it("the resource is built on APP_ORIGIN when it is set, as every absolute link is (mutation: use the request URL's origin -> FAILS)", async () => {
    vi.stubEnv("APP_ORIGIN", "https://app.bis-rgv.com");
    const res = pathPrm.GET(new Request("https://bis-platform-abc.vercel.app/.well-known/oauth-protected-resource/api/mcp"));
    expect(((await res.json()) as { resource: string }).resource).toBe("https://app.bis-rgv.com/api/mcp");
  });

  it("answers CORS preflight on both forms (mutation: drop OPTIONS -> FAILS)", () => {
    for (const mod of [pathPrm, rootPrm, asMeta]) {
      const res = mod.OPTIONS();
      expect(res.status).toBe(200);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
    }
  });
});

describe("authorization-server metadata (RFC 8414)", () => {
  it("relays Clerk's own document from the instance the publishable key names (mutation: a hard-coded issuer -> FAILS)", async () => {
    const fetchMock = vi.fn(async () => Response.json({ issuer: FAPI, registration_endpoint: `${FAPI}/oauth/register` }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await asMeta.GET();
    expect(fetchMock).toHaveBeenCalledWith(`${FAPI}/.well-known/oauth-authorization-server`);
    expect(await res.json()).toEqual({ issuer: FAPI, registration_endpoint: `${FAPI}/oauth/register` });
  });
});
