// apps/web/src/lib/mcp/tools.ts
// What the read-only MCP server offers (plan 2026-11-19-mcp-server.md D3, §3.3): the four staff reads in the MCP
// shape (lib/tools/belt.ts mcpShape, so their words are the owner line's, byte for byte), plus my_businesses. No
// write tool exists here, so no prompt can call one. Pinned by mcp-tool-schemas.fixture.json.
import type { AiAppLogKind } from "@bis/db";
import { mcpShape } from "@/lib/tools/belt";
import { STAFF_TOOL_SPECS, type StaffToolName } from "@/lib/tools/staff/specs";

export const MY_BUSINESSES_TOOL = {
  name: "my_businesses",
  description: "The businesses you can ask about here: each has id and name. When you have more than one, pass its id as business to the other tools.",
  inputSchema: { type: "object", properties: {}, required: [] },
  annotations: { readOnlyHint: true },
} as const;

export const MCP_TOOLS = [...STAFF_TOOL_SPECS.map(mcpShape), MY_BUSINESSES_TOOL] as const;
export type McpToolName = StaffToolName | typeof MY_BUSINESSES_TOOL.name;
export const MCP_TOOL_NAMES: readonly McpToolName[] = MCP_TOOLS.map((t) => t.name);

/** The access-log item each tool writes (PR A's AI_APP_LOG_KINDS). Typed on the name, so a new tool has no kind until
 *  someone writes one, and the typecheck says so. */
export const LOG_KIND_OF: Record<McpToolName, AiAppLogKind> = {
  calls_and_messages: "ai_app_calls_and_messages",
  appointments: "ai_app_appointments",
  needs_attention: "ai_app_needs_attention",
  lookup_customer: "ai_app_lookup_customer",
  my_businesses: "ai_app_my_businesses",
};
