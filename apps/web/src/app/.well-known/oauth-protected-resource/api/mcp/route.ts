// SPIKE: path-form (RFC 9728 section 3.1) protected-resource metadata for /api/mcp.
import { protectedResourceHandlerClerk, metadataCorsOptionsRequestHandler } from "@clerk/mcp-tools/next";
export const GET = protectedResourceHandlerClerk();
export const OPTIONS = metadataCorsOptionsRequestHandler();
