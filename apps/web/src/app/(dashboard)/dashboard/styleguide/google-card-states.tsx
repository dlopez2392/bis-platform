"use client";

import type { GoogleCardView } from "@/app/(dashboard)/dashboard/accounts/[accountId]/calendar/google-card-data";
import { GoogleCard, GoogleCardSkeleton } from "@/app/(dashboard)/dashboard/accounts/[accountId]/calendar/google-card";

/**
 * S-22 slice 1, PR 3: the Calendar page's "Google Calendar" card in every state it can be in (DESIGN.md's
 * definition of done). A client component for feed-card-states.tsx's reason: the Disconnect prop is a plain
 * function (a local no-op that answers ok, so its toast shows). Nothing here reads the database or Google; the
 * email and the connect link are fixed and fake. Each column is w-full and min-w-0, so at 375px the card
 * shrinks rather than widening the page.
 */
const demoDisconnect = async () => ({ ok: true as const });
const link = { kind: "link", href: "#styleguide-google-connect" } as const;
const checked = () => new Date(Date.now() - 2 * 3600_000).toISOString();
const v = (body: GoogleCardView["body"], outcome: GoogleCardView["outcome"] = null): GoogleCardView => ({ outcome, body });

/** The styleguide section's title, kept as data so page.tsx gains no uncatalogued copy (the i18n ratchet). */
export const GOOGLE_CARD_SECTION = "Google Calendar (Calendar page)";

/** Data, not JSX copy: the labels are the styleguide's own captions (the i18n ratchet scans JSX only). */
export const GOOGLE_CARD_DEMOS: { id: string; label: string; view: GoogleCardView | null }[] = [
  { id: "skeleton", label: "Loading — shaped like the connected card", view: null },
  { id: "empty", label: "Not connected — Connect is the one primary", view: v({ kind: "empty", connect: link }) },
  { id: "connected", label: "Connected — dot + word, Disconnect is ghost", view: v({ kind: "connected", email: "owner@example.com", lastCheckedAt: checked() }) },
  { id: "connected-just-now", label: "Connected, after the trip to Google", view: v({ kind: "connected", email: "owner@example.com", lastCheckedAt: null }, "connected") },
  { id: "needs-reconnect", label: "Needs reconnecting — Reconnect is the one primary", view: v({ kind: "needsReconnect", email: "owner@example.com", connect: link }) },
  { id: "denied", label: "Box left unticked — nothing changed", view: v({ kind: "empty", connect: link }, "denied") },
  { id: "paused", label: "Paused client — no Connect", view: v({ kind: "empty", connect: { kind: "paused" } }, "paused") },
  { id: "wrong-origin", label: "Another address — names where to connect", view: v({ kind: "empty", connect: { kind: "wrongOrigin", origin: "https://app.bis-rgv.com" } }) },
  { id: "error", label: "Error — the rest of the page still loads", view: v({ kind: "error" }) },
];

export function GoogleCardStates() {
  return (
    <div className="flex w-full min-w-0 flex-wrap items-start gap-6">
      {GOOGLE_CARD_DEMOS.map((d) => (
        <div key={d.id} className="flex w-full max-w-md min-w-0 flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{d.label}</span>
          {d.view ? <GoogleCard view={d.view} locale="en" disconnect={demoDisconnect} /> : <GoogleCardSkeleton />}
        </div>
      ))}
    </div>
  );
}
