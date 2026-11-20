// Clerk's authorization-server metadata, relayed (RFC 8414; plan 2026-11-19-mcp-server.md §3.1), for an MCP client
// that asks this origin rather than the issuer the protected-resource metadata names.
import { authServerMetadataHandlerClerk, metadataCorsOptionsRequestHandler } from "@clerk/mcp-tools/next";

export const dynamic = "force-dynamic";
export const GET = authServerMetadataHandlerClerk();
export const OPTIONS = metadataCorsOptionsRequestHandler();
