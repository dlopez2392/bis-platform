"use client";

import { SuggestionCard, SUGGESTION_CARD, MONO_LABEL } from "@/components/proposals/suggestion-card";
import { SuggestionActions } from "@/components/proposals/suggestion-actions";
import type { SuggestionView } from "@/lib/proposals/view";

/**
 * The suggestion card (item 8b-1) in its five states, per language, for the styleguide. The views are
 * built on the server by the real `buildSuggestionView` from typed-out rows; this file only supplies
 * stand-in actions (a server component cannot hand the card functions), which answer with the card's
 * own words and write nothing. Specimen words come from the catalogue, so this adds nothing to the ratchet.
 */
export function SuggestionDemo({ columns }: {
  columns: { key: string; caption: string; views: SuggestionView[]; edits: SuggestionView[] }[];
}) {
  return (
    <div className="grid w-full gap-6 md:grid-cols-3">
      {columns.map(({ key, caption, views, edits }) => {
        return (
          <div key={key} data-sg-suggestions={key} className="flex min-w-0 max-w-[360px] flex-col gap-3">
            <p className={MONO_LABEL}>{caption}</p>
            {views.map((view) => <SuggestionCard key={view.id} view={view} {...standIn(view)} />)}
            {edits.map((editing) => (
              <div key={editing.id} lang={editing.lang} data-sg-suggestion-edit={editing.edit.kind} className={SUGGESTION_CARD}>
                <SuggestionActions id={editing.id} edit={editing.edit} labels={editing.labels} initialMode="edit" {...standIn(editing)} />
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function standIn(view: SuggestionView) {
  const answered = async () => ({ ok: true as const, status: "accepted" as const, toast: view.labels.accept });
  return {
    accept: answered, editAccept: answered, discard: answered,
    undo: async () => ({ ok: true as const, message: view.labels.undo }),
  };
}
