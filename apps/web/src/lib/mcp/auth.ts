// apps/web/src/lib/mcp/auth.ts
// Who an MCP request is (plan 2026-11-19-mcp-server.md §3.1-§3.2 step 1). The OAuth access token proves a Clerk user
// id and NOTHING else: no org, no role, no business. Everything about which business and what role is read fresh from
// BIS's own tables on every request (./run.ts). /api/mcp is outside the proxy's matcher (proxy.ts), so this is the
// only place a token is checked.
import { clerkClient } from "@clerk/nextjs/server";
import { verifyClerkToken } from "@clerk/mcp-tools/next";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { originFrom } from "@/lib/email/origin";
import { errorClass } from "@/lib/tools/belt";

export const MCP_PATH = "/api/mcp";
export const MCP_METADATA_PATH = "/.well-known/oauth-protected-resource/api/mcp";

/** The app's own origin, the one every absolute link uses (APP_ORIGIN first, then the Host header: lib/email/origin.ts);
 *  the request's own URL only when neither exists. */
export function mcpOrigin(req: Request): string {
  return originFrom(req.headers) ?? new URL(req.url).origin;
}

/** The protected resource: this endpoint's absolute URL. The token's `aud` is checked against it (production's Clerk
 *  MCP setup names `https://app.bis-rgv.com/api/mcp`, plan §6 step 1). */
export function mcpResourceUrl(req: Request): string {
  return `${mcpOrigin(req)}${MCP_PATH}`;
}

/** 401 that starts the client's sign-in (RFC 9728 §5.1): where the protected-resource metadata is. */
export function unauthorized(req: Request): Response {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: {
      "content-type": "application/json",
      "WWW-Authenticate": `Bearer resource_metadata="${mcpOrigin(req)}${MCP_METADATA_PATH}"`,
    },
  });
}

/** The audiences a JWT names: [] when it names none, or when it is not a JWT (an opaque token carries no claims). */
function audiencesOf(token: string): string[] {
  const payload = token.split(".")[1];
  if (!payload) return [];
  try {
    const aud = (JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { aud?: unknown }).aud;
    if (typeof aud === "string") return [aud];
    if (Array.isArray(aud)) return aud.map((a) => (typeof a === "string" ? a : JSON.stringify(a)));
    return [];
  } catch {
    return [];
  }
}

/**
 * `verifyClerkToken` checks no audience (spike §7.4), so this does. Anywhere: an `aud` that names anything but this
 * endpoint is refused (a token minted for another OAuth client of the same Clerk instance). In production the `aud`
 * must also be present (Clerk's MCP setup turns the claim on, plan §6 step 1); the development instance issues none.
 */
function audienceAllowed(aud: string[], resourceUrl: string, env: NodeJS.ProcessEnv): boolean {
  if (aud.some((a) => a !== resourceUrl)) return false;
  return env.VERCEL_ENV === "production" ? aud.length > 0 : true;
}

export type McpCaller = { clerkUserId: string; authInfo: AuthInfo };

/**
 * The caller, or null for a 401. In order: a Bearer token; Clerk verifies it AS AN OAUTH ACCESS TOKEN (a session JWT
 * is refused, spike §7.3); `verifyClerkToken` turns Clerk's answer into the SDK's AuthInfo (it throws on any other
 * token type, which is a refusal here); the audience is read from the token string Clerk itself verified
 * (`state.token`, so the signature covers every byte decoded) and must be the one presented. Any throw (Clerk's own on
 * a malformed `a.b.c`) is a refusal, logged by class only.
 */
export async function authenticateMcp(
  req: Request, resourceUrl: string, env: NodeJS.ProcessEnv = process.env,
): Promise<McpCaller | null> {
  const header = req.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!presented) return null;
  try {
    const state = await (await clerkClient()).authenticateRequest(req, { acceptsToken: "oauth_token" });
    if (!state.isAuthenticated || typeof state.token !== "string" || state.token !== presented) return null;
    const info = verifyClerkToken(state.toAuth() as Parameters<typeof verifyClerkToken>[0], presented);
    const clerkUserId = info?.extra?.userId;
    if (!info || typeof clerkUserId !== "string" || clerkUserId === "") return null;
    if (!audienceAllowed(audiencesOf(state.token), resourceUrl, env)) return null;
    return { clerkUserId, authInfo: info };
  } catch (e) {
    console.error(`[mcp] token refused: ${errorClass(e)}`);
    return null;
  }
}
