// apps/web/src/lib/mcp/metadata.ts
// The OAuth metadata an MCP client reads after its first 401 (plan 2026-11-19-mcp-server.md §3.1). The protected
// resource is the MCP ENDPOINT (`<origin>/api/mcp`), built on the app's own origin (./auth.ts mcpResourceUrl):
// mcp-tools' protectedResourceHandlerClerk would name the bare origin, which is not what the token's `aud` must equal.
import { corsHeaders, generateClerkProtectedResourceMetadata } from "@clerk/mcp-tools/server";
import { mcpResourceUrl } from "./auth";

export function protectedResourceMetadata(req: Request): Response {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (!publishableKey) throw new Error("Missing NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY");
  const metadata = generateClerkProtectedResourceMetadata({ publishableKey, resourceUrl: mcpResourceUrl(req) });
  return Response.json(metadata, { headers: { "Cache-Control": "max-age=3600", ...corsHeaders } });
}
