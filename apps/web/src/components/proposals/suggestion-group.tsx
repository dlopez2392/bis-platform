import type { SuggestionGroup } from "@/lib/proposals/group";
import { SuggestionCard, MONO_LABEL } from "./suggestion-card";
import type { SuggestionActionProps } from "./suggestion-actions";

/**
 * One tray group (item 8b-2, spec 5.1): "Ana López · from the call on Tue, Oct 14" as a mono label over that
 * customer's cards from that call. A heading is a LABEL, never a card around cards (P12): the wrapper is a
 * plain column with no surface of its own. `level` is 3 under the tray's <h2>, 4 under an agency account's
 * <h3>.
 */
export function SuggestionGroupBlock({ group, level = 3, ...actions }: {
  group: SuggestionGroup; level?: 3 | 4;
} & SuggestionActionProps) {
  const Heading = level === 3 ? "h3" : "h4";
  return (
    <div data-suggestion-group={group.key} className="flex min-w-0 flex-col gap-3">
      <Heading className={`${MONO_LABEL} break-words`}>{group.heading}</Heading>
      {group.views.map((view) => <SuggestionCard key={view.id} view={view} {...actions} />)}
    </div>
  );
}
