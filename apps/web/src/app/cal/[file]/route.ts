import { createHash } from "node:crypto";
import { serviceDb } from "@bis/db";
import { originFrom } from "@/lib/email/origin";
import { feedSecretConfigured, feedTokenFromFile } from "@/lib/booking/feed-token";
import { loadCalendarFeed } from "@/lib/booking/calendar-feed";

/**
 * `/cal/<token>.ics`: a person's calendar feed (F-048 part 2), subscribed to by iPhone, Google and Outlook.
 * Public and unauthenticated: the path holds a dot, so proxy.ts never runs Clerk on it (proxy.ts:39), and
 * the token is the capability. Every refusal (bad shape, unknown, turned off, removed, access off,
 * archived, and a missing or short CALENDAR_FEED_SECRET, which fails closed before any read) is the SAME
 * 404, so nobody learns whether a token ever existed. `private, no-cache` + a weak ETag over the body: no
 * shared cache stores a person's bookings, and a refresh with nothing new is a 304. Never logs the token
 * or the secret.
 */
export const dynamic = "force-dynamic";

const NOT_FOUND = () => new Response("Not found", {
  status: 404, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
});

type Ctx = { params: Promise<{ file: string }> };

async function answer(req: Request, { params }: Ctx, withBody: boolean): Promise<Response> {
  if (!feedSecretConfigured()) return NOT_FOUND();
  const { file } = await params;
  const token = feedTokenFromFile(file);
  if (!token) return NOT_FOUND();
  try {
    const r = await loadCalendarFeed(serviceDb(), token, new Date(), originFrom(req.headers));
    if (r.kind === "not_found") return NOT_FOUND();
    if (r.kind === "rate_limited") {
      return new Response("Too many requests", {
        status: 429, headers: { "Retry-After": String(r.retryAfterSeconds), "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
      });
    }
    const etag = `W/"${createHash("sha256").update(r.body).digest("hex").slice(0, 32)}"`;
    const headers = {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="bookings.ics"',
      "Cache-Control": "private, no-cache",
      ETag: etag,
      "X-Robots-Tag": "noindex",
      "Referrer-Policy": "no-referrer",
    };
    const inm = req.headers.get("if-none-match");
    if (inm && inm.split(",").map((s) => s.trim()).some((v) => v === etag || v === "*")) {
      return new Response(null, { status: 304, headers });
    }
    return new Response(withBody ? r.body : null, { status: 200, headers });
  } catch (e) {
    console.error(`calendar feed: read failed: ${e instanceof Error ? e.message : String(e)}`);
    return new Response("Something went wrong", { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export function GET(req: Request, ctx: Ctx): Promise<Response> { return answer(req, ctx, true); }
export function HEAD(req: Request, ctx: Ctx): Promise<Response> { return answer(req, ctx, false); }
