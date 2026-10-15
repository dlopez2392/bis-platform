import { createHash, createHmac } from "node:crypto";

/**
 * The customer's link (spec 4.1; plan deviation 1): 32 bytes, base64url, DERIVED from the request id
 * under a server key, so staff can Copy link again and the quiet-hours release can rebuild it, while
 * the database keeps only sha256(token). The key is the forms token key's shape
 * (lib/forms/guards.ts:36-42) WITHOUT its service-key fallback: DOCUMENT_LINK_SECRET is required, at
 * least 32 characters, different in Production and Preview (ruling I10). Rotating it ends every open
 * link (they live 7 days). Our code never logs it; the link itself travels in the text or email we
 * send, and Vercel's request log records /d/<token> (plan review M1). Server only (node:crypto).
 */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

function linkKey(): Buffer {
  const secret = process.env.DOCUMENT_LINK_SECRET;
  if (!secret || secret.length < 32) throw new Error("DOCUMENT_LINK_SECRET is required (at least 32 characters)");
  return createHash("sha256").update(`bis-document-link:${secret}`).digest();
}

export function requestToken(requestId: string): string {
  return createHmac("sha256", linkKey()).update(`document-request:v1:${requestId.toLowerCase()}`).digest("base64url");
}
export const isTokenShape = (t: unknown): t is string => typeof t === "string" && TOKEN_RE.test(t);
export const tokenHash = (token: string): string => createHash("sha256").update(token).digest("hex");
export const requestUrl = (origin: string, requestId: string): string => `${origin.replace(/\/+$/, "")}/d/${requestToken(requestId)}`;
