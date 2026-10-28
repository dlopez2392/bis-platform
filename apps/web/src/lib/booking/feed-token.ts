import { createHash, createHmac } from "node:crypto";
import { isTokenShape, tokenHash } from "@/lib/document-requests/token";

/**
 * F-048 part 2: a person's calendar link. 32 bytes, base64url, 43 characters (requestToken's shape, so
 * isTokenShape and tokenHash serve both), DERIVED from the calendar_feeds row id under
 * CALENDAR_FEED_SECRET (owner decision D2: its own secret, at least 32 characters, no fallback). The
 * database keeps only sha256(token). Rotating the secret ends no link (the route looks up by hash); it
 * only stops the card showing a link again. Server only (node:crypto). Never logged.
 */
const SUFFIX = ".ics";
const MIN = 32;

function feedKey(): Buffer {
  const secret = process.env.CALENDAR_FEED_SECRET;
  if (!secret || secret.length < MIN) throw new Error("CALENDAR_FEED_SECRET is required (at least 32 characters)");
  return createHash("sha256").update(`bis-calendar-feed:${secret}`).digest();
}
export function feedSecretConfigured(): boolean {
  const s = process.env.CALENDAR_FEED_SECRET;
  return typeof s === "string" && s.length >= MIN;
}
export function feedToken(feedId: string): string {
  return createHmac("sha256", feedKey()).update(`calendar-feed:v1:${feedId.toLowerCase()}`).digest("base64url");
}
export const feedTokenHash = (token: string): string => tokenHash(token);
export function feedTokenFromFile(file: string): string | null {
  if (!file.endsWith(SUFFIX)) return null;
  const token = file.replace(/\.ics$/, "");
  return isTokenShape(token) ? token : null;
}
export const feedUrl = (origin: string, token: string): string => `${origin.replace(/\/+$/, "")}/cal/${token}${SUFFIX}`;
export const webcalUrl = (url: string): string => url.replace(/^https?:\/\//, "webcal://");
