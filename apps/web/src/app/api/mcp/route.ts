// The read-only MCP server (docs/superpowers/plans/2026-11-19-mcp-server.md §3.1): MCP Streamable HTTP, STATELESS.
// Every POST carries its bearer token and is checked from zero; one server and one transport per request, JSON
// responses (no stream). Outside the proxy's matcher (proxy.ts): this route authenticates itself (lib/mcp/auth.ts).
// Inert until a business's Owner switches AI apps on: with no switch on, every tool answers no_business.
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticateMcp, mcpResourceUrl, unauthorized } from "@/lib/mcp/auth";
import { buildMcpServer } from "@/lib/mcp/server";
import { errorClass } from "@/lib/tools/belt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const caller = await authenticateMcp(req, mcpResourceUrl(req));
  if (!caller) return unauthorized(req);
  try {
    const server = buildMcpServer(caller.clerkUserId);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    return await transport.handleRequest(req, { authInfo: caller.authInfo });
  } catch (e) {
    console.error(`[mcp] request failed: ${errorClass(e)}`);
    return Response.json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null }, { status: 500 });
  }
}

/** A stateless server offers no stream to GET and no session to DELETE (MCP transports spec: 405 is allowed). */
export function GET(): Response {
  return new Response(null, { status: 405, headers: { allow: "POST" } });
}
export const DELETE = GET;
