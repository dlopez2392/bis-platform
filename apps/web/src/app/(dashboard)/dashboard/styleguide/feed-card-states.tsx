"use client";

import type { FeedCardView } from "@/app/(dashboard)/dashboard/accounts/[accountId]/calendar/feed-card-data";
import { FeedCard } from "@/app/(dashboard)/dashboard/accounts/[accountId]/calendar/feed-card";

/**
 * F-048 part 2: the Calendar page's "Bookings on your phone" card in every state it can be in (DESIGN.md's
 * definition of done). A client component for billing-card-states.tsx's reason: the card's action props are
 * plain functions. Nothing here derives a real link or reaches the database: the link is a fixed, obviously
 * fake 43-character token, and every action is a local no-op that answers ok (Make a new link and Turn off
 * still show their Undo toast). Each demo column is w-full and min-w-0, so at 375px the card shrinks and the
 * long link scrolls inside its Input instead of widening the page.
 */
const demoOk = async () => ({ ok: true as const, undo: { feedId: "demo", revokedAt: "2026-10-28T12:00:00Z", replacementId: null } });
const demoUndo = async () => ({ ok: true as const, undo: null });

const TOKEN = "demo_calendar_link_not_a_real_one".padEnd(43, "0");
const URL_ = `https://app.bis-rgv.com/cal/${TOKEN}.ics`;
const live = (over: Partial<Extract<FeedCardView, { kind: "live" }>> = {}): FeedCardView => ({
  kind: "live", url: URL_, webcal: URL_.replace(/^https:\/\//, "webcal://"),
  lastFetchedAt: new Date(Date.now() - 2 * 3600_000).toISOString(), technician: false, ...over,
});

/** The styleguide section's title, kept as data so page.tsx gains no uncatalogued copy (the i18n ratchet). */
export const FEED_CARD_SECTION = "Bookings on your phone (Calendar page)";

/** Data, not JSX copy: the labels are the styleguide's own captions (the i18n ratchet scans JSX only). */
export const FEED_CARD_DEMOS: { id: string; label: string; view: FeedCardView }[] = [
  { id: "none", label: "No link yet — Make my link", view: { kind: "none" } },
  { id: "live", label: "Live — Copy link is the one primary", view: live() },
  { id: "live-technician", label: "Live, Technician — assigned customers only", view: live({ technician: true }) },
  { id: "live-never-checked", label: "Live, never checked by a calendar", view: live({ lastFetchedAt: null }) },
  { id: "stale", label: "Can't be shown again — the secret changed", view: { kind: "stale" } },
  { id: "agency", label: "Agency — each team member makes their own", view: { kind: "agency" } },
  { id: "unavailable", label: "Not set up — no CALENDAR_FEED_SECRET", view: { kind: "unavailable" } },
  { id: "error", label: "Error — the rest of the page still loads", view: { kind: "error" } },
];

export function FeedCardStates() {
  return (
    <div className="flex w-full min-w-0 flex-wrap items-start gap-6">
      {FEED_CARD_DEMOS.map((d) => (
        <div key={d.id} className="flex w-full max-w-md min-w-0 flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{d.label}</span>
          <FeedCard view={d.view} locale="en" make={demoUndo} replace={demoOk} turnOff={demoOk} undo={demoUndo} />
        </div>
      ))}
    </div>
  );
}
