import { calendarFileFor } from "@/lib/booking/calendar-file";
import { normalizeLocale } from "@/lib/forms/public-strings";
import { originFrom } from "@/lib/email/origin";
import { loadCalendarFileInput } from "./data";

/**
 * `/b/<publicId>/ics/<token>` — F-048's add-to-calendar file, linked from the
 * booking confirmation email and the booking page's success screen. The
 * cancel token is the capability, exactly as it is for the cancel page beside
 * this route; the file says no more than that page already shows (the time,
 * the business, the cancel link). Public: proxy.ts protects only /dashboard.
 *
 * A pure read (see `./data.ts`), so a link prefetched by a mail scanner
 * changes nothing. 404 for anything that is not a live booking, so an old
 * link can never put a cancelled appointment back on a phone. Never logs the
 * token.
 */
export const dynamic = "force-dynamic";

/** `newCancelToken`'s shape: 24 characters of `ALPHABET` (packages/db
 *  forms.ts). Anything else cannot be a token, and is refused unread. */
const TOKEN_RE = /^[a-km-np-z2-9]{24}$/;

const NOT_FOUND = () => new Response("Not found", {
  status: 404, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
});

export async function GET(
  req: Request, { params }: { params: Promise<{ publicId: string; token: string }> },
): Promise<Response> {
  const { token } = await params;
  if (!TOKEN_RE.test(token)) return NOT_FOUND();
  const locale = normalizeLocale(new URL(req.url).searchParams.get("locale") ?? undefined, "en");

  try {
    const input = await loadCalendarFileInput(token);
    const ics = input
      ? calendarFileFor({ ...input, locale, origin: originFrom(req.headers), now: new Date() })
      : null;
    if (!ics) return NOT_FOUND();
    return new Response(ics, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'attachment; filename="appointment.ics"',
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex",
      },
    });
  } catch (e) {
    console.error(`calendar file: read failed: ${e instanceof Error ? e.message : String(e)}`);
    return new Response("Something went wrong", { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
