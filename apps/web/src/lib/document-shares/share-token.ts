import { randomBytes } from "node:crypto";

/**
 * A share link's token (spec 4.1): 32 random bytes, base64url, 43 characters (2b's shape, so
 * isTokenShape and tokenHash in ../document-requests/token.ts serve both). Only sha256(token) is
 * stored; the link exists once, in the toast and the clipboard. Our code never logs it; the link
 * itself travels wherever staff send it, and Vercel's request log records /s/<token> and
 * /api/s/<token>/download for every visit (review F9; 2b's token.ts names the same residual for /d).
 * Server only.
 */
export const newShareToken = (): string => randomBytes(32).toString("base64url");
export const shareUrl = (origin: string, token: string): string => `${origin.replace(/\/+$/, "")}/s/${token}`;
