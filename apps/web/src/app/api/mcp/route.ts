// SPIKE (PR 0, not merged): stateless MCP Streamable HTTP with Clerk OAuth.
import { clerkClient } from "@clerk/nextjs/server";
import { verifyClerkToken } from "@clerk/mcp-tools/next";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauthorized(req: Request): Response {
  const origin = new URL(req.url).origin;
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: {
      "content-type": "application/json",
      "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/api/mcp"`,
    },
  });
}

export async function POST(req: Request): Promise<Response> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (!token) return unauthorized(req);
  // /api/mcp is outside clerkMiddleware's matcher (proxy.ts): the middleware throws a 500 on a malformed
  // three-part bearer ("a.b.c") before any route runs, so the route authenticates the request itself.
  let info: ReturnType<typeof verifyClerkToken>;
  try {
    const state = await (await clerkClient()).authenticateRequest(req, { acceptsToken: "oauth_token" });
    info = verifyClerkToken(state.toAuth() as Parameters<typeof verifyClerkToken>[0], token);
  } catch (err) {
    console.error("[mcp-spike] verifyClerkToken threw", (err as Error).name);
    return unauthorized(req);
  }
  if (!info) return unauthorized(req);
  console.log("[mcp-spike] token ok", JSON.stringify({ scopes: info.scopes, clientId: info.clientId, userId: info.extra?.userId }));

  const server = new McpServer({ name: "bis-spike", version: "0.0.0" });
  server.registerTool(
    "whoami",
    { description: "Return the Clerk user id the bearer token belongs to." },
    async (extra) => ({
      content: [{ type: "text", text: JSON.stringify({ userId: extra.authInfo?.extra?.userId, scopes: extra.authInfo?.scopes, clientId: extra.authInfo?.clientId }) }],
    }),
  );
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(req, { authInfo: info });
}

export function GET(): Response {
  return new Response(null, { status: 405, headers: { allow: "POST" } });
}
export const DELETE = GET;
