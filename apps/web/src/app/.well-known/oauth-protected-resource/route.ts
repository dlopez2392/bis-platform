// Protected-resource metadata for the MCP endpoint (RFC 9728; plan 2026-11-19-mcp-server.md §3.1). The path form
// (/.well-known/oauth-protected-resource/api/mcp) is what the 401's resource_metadata names; the root form answers the
// same document for a client that looks there first.
import { metadataCorsOptionsRequestHandler } from "@clerk/mcp-tools/next";
import { protectedResourceMetadata } from "@/lib/mcp/metadata";

export const dynamic = "force-dynamic";
export const GET = protectedResourceMetadata;
export const OPTIONS = metadataCorsOptionsRequestHandler();
