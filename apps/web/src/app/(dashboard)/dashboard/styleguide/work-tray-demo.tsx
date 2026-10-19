"use client";

import { MONO_LABEL } from "@/components/proposals/suggestion-card";
import { WaitingSuggestions, type WaitingData } from "@/components/proposals/suggestion-row";
import { WaitingSuggestionsSkeleton } from "@/components/proposals/waiting-skeleton";
import {
  AgencySuggestionSection, SuggestionSection, SuggestionSectionSkeleton,
  type AgencySuggestionData, type SuggestionSectionData,
} from "@/components/proposals/suggestion-section";
import { groupSuggestions } from "@/lib/proposals/group";
import { buildSuggestionView } from "@/lib/proposals/view";
import { makeTr, type Tr } from "@/lib/record/copy";
import {
  CALL_AT, CALLS_BY_ID, CONTACT_NAMES, FIVE, NAMES, NOW, PIPELINE_STAGES, STAGES, ZONE, rows,
} from "@/components/proposals/suggestion-specimens";

/**
 * The To do tray grouped, "Waiting for you" in its five states, and the agency Work page's per-account
 * cards (item 8b-2, Task 7), in English, Spanish and the pseudo-locale. The views come from the real
 * `buildSuggestionView`, the groups from the real `groupSuggestions`: this page cannot drift from the tray.
 * A server component cannot hand this client one a function (suggestion-demo.tsx's own note), so the stand-in
 * actions below answer with the card's own words and write nothing.
 */
export type WorkTrayColumn = {
  key: string; tr: Tr; personaName: string;
  waiting: WaitingData; grouped: SuggestionSectionData; agency: AgencySuggestionData;
};

const LOCALES = [
  { key: "en", tr: makeTr("en") }, { key: "es", tr: makeTr("es") }, { key: "pseudo", tr: makeTr("en", true) },
] as const;

export function buildWorkTrayColumns(): WorkTrayColumn[] {
  return LOCALES.map(({ key, tr }) => {
    const build = (s: keyof typeof rows) => buildSuggestionView(rows[s], {
      tr, zone: ZONE, now: NOW, stages: STAGES, pipelineStages: PIPELINE_STAGES, callerName: "Ana Lopez",
      callStartedAt: CALL_AT, personaName: "Sofía", names: NAMES, viewerId: null,
    });
    const pending = build("pending");
    const cited = build("cited");
    const views = new Map([[pending.id, pending], [cited.id, cited]]);
    const groups = groupSuggestions([rows.pending, rows.cited], views, { tr, zone: ZONE, contactNames: CONTACT_NAMES, callsById: CALLS_BY_ID });
    return {
      key, tr, personaName: "Sofía",
      waiting: { ok: true, views: FIVE.map(build) },
      grouped: { ok: true, groups, capped: false },
      agency: { ok: true, accounts: [
        { accountId: "acc_a", brandName: "Acme HVAC", personaName: "Lupe", capped: true, groups, actions: standIn() },
        { accountId: "acc_b", brandName: "Rio Roofing", personaName: "Sofía", capped: false, groups, actions: standIn() },
      ] },
    };
  });
}

function standIn() {
  const answered = async () => ({ ok: true as const, status: "accepted" as const, toast: "Done" });
  return { accept: answered, editAccept: answered, discard: answered, undo: async () => ({ ok: true as const, message: "Undone." }) };
}

export function WorkTrayDemo({ columns }: { columns: WorkTrayColumn[] }) {
  return (
    <div className="flex w-full flex-col gap-8">
      {columns.map(({ key, tr, personaName, waiting, grouped, agency }) => (
        <div key={key} data-sg-work-tray={key} className="flex min-w-0 flex-col gap-4">
          <p className={MONO_LABEL}>{key}</p>
          <div className="grid w-full gap-6 md:grid-cols-3">
            <div data-sg-waiting={key} className="flex min-w-0 max-w-[360px] flex-col gap-3">
              <WaitingSuggestions tr={tr} data={waiting} seeAllHref="/dashboard/accounts/acc_1/tasks" {...standIn()} />
              <WaitingSuggestionsSkeleton />
            </div>
            <div data-sg-tray-grouped={key} className="flex min-w-0 max-w-[360px] flex-col gap-3">
              <SuggestionSection tr={tr} personaName={personaName} data={grouped} headingId={`tray-${key}`} {...standIn()} />
              <SuggestionSectionSkeleton tr={tr} grouped />
            </div>
            <div data-sg-agency={key} className="flex min-w-0 max-w-[420px] flex-col gap-3">
              <AgencySuggestionSection tr={tr} data={agency} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
