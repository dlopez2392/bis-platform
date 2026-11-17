"use client";

import { DailyBriefCard, DailyBriefCardError, DailyBriefCardSkeleton } from "@/components/preferences/daily-brief-card";
import type { DailyBriefRowView } from "@/components/preferences/daily-brief-view";

/**
 * F-082 PR 4: the "Your daily brief" card on Mis preferencias, in every state it can take: two businesses (one off,
 * one on and already sent), the empty state, the error state and the skeleton, then the same card in Spanish. The
 * switch is the repo's first, so it is shown here: a 44x24 track on `--surface-2` off and `--accent` on, status as
 * dot + word, no primary button on the card (DESIGN rule 8). Demo switches answer ok and write nothing.
 */
const ROWS: DailyBriefRowView[] = [
  { accountId: "demo-1", businessName: "Rio Roofing", on: false, lastSentDay: null },
  { accountId: "demo-2", businessName: "956 Woodworks", on: true, lastSentDay: "2026-11-17" },
];
const ok = async () => ({ ok: true as const });

export function DailyBriefDemo() {
  return (
    <div className="space-y-6">
      <DailyBriefCard rows={ROWS} locale="en" pseudo={false} setBrief={ok} />
      <DailyBriefCard rows={[]} locale="en" pseudo={false} setBrief={ok} />
      <DailyBriefCardError locale="en" pseudo={false} />
      <DailyBriefCardSkeleton />
      <DailyBriefCard rows={ROWS} locale="es" pseudo={false} setBrief={ok} />
    </div>
  );
}
