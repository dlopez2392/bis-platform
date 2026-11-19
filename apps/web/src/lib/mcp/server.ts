// apps/web/src/lib/mcp/server.ts
// One MCP server per request, for one authenticated person (plan 2026-11-19-mcp-server.md §3.1: stateless, no
// session store). The low-level `Server`, not `McpServer`: McpServer.registerTool takes zod schemas and writes its own
// JSON Schema from them, so tools/list could not carry the staff specs' words byte for byte (mcp-tool-schemas.fixture.json).
// Here tools/list answers MCP_TOOLS as they are, and tools/call hands every name to runMcpTool, whose guard refuses
// anything not offered.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { MCP_TOOLS } from "./tools";
import { runMcpTool } from "./run";

export function buildMcpServer(clerkUserId: string): Server {
  const server = new Server({ name: "bis", version: "1.0.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...MCP_TOOLS] }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const out = await runMcpTool({ clerkUserId }, req.params.name, req.params.arguments ?? {});
    return { content: [{ type: "text" as const, text: JSON.stringify(out) }] };
  });
  return server;
}
