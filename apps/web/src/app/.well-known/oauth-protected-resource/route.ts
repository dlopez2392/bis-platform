// SPIKE: root-form protected-resource metadata.
import { protectedResourceHandlerClerk, metadataCorsOptionsRequestHandler } from "@clerk/mcp-tools/next";
export const GET = protectedResourceHandlerClerk();
export const OPTIONS = metadataCorsOptionsRequestHandler();
