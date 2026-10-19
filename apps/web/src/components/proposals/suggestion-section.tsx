import { AGENCY_PER_ACCOUNT } from "@bis/db/proposal-rules";
import type { Tr } from "@/lib/record/copy";
import type { SuggestionView } from "@/lib/proposals/view";
import type { SuggestionGroup } from "@/lib/proposals/group";
import { Skeleton } from "@/components/ui/skeleton";
import { SuggestionCard, SUGGESTION_CARD, MONO_LABEL } from "./suggestion-card";
import type { SuggestionActionProps } from "./suggestion-actions";
import { SuggestionRetry } from "./suggestion-retry";
import { SuggestionGroupBlock } from "./suggestion-group";
import { focusFallback } from "./focus-fallback";

/**
 * The Suggestions section (item 8b-1, spec 4.5): a mono-label heading over separate cards. No card
 * wraps the stack (P12), no hero (rule 11). Loaded, empty (absent), error with Retry (rule 5), and a
 * skeleton shaped like the card for the page's loading file (rule 7; Task 8 wires it).
 *
 * Item 8b-2 (spec 5.1): the To do tray passes `groups`, by customer then by call, each a mono-label
 * heading over its cards; the call page keeps passing one ungrouped stack of `views`. The section is the
 * list the focus rule reads (`data-suggestion-list`), so a decided card's leaving hands focus to the next
 * card's Accept across a group boundary.
 */
export type SuggestionSectionData =
  | { ok: true; views: SuggestionView[]; capped: boolean }
  | { ok: true; groups: SuggestionGroup[]; capped: boolean }
  | { ok: false };

/** How many cards a loaded section holds, grouped or not. */
function cardCount(data: Extract<SuggestionSectionData, { ok: true }>): number {
  return "groups" in data ? data.groups.reduce((n, g) => n + g.views.length, 0) : data.views.length;
}

const SECTION = "flex flex-col gap-3";
const SUBHEAD = "text-sm text-muted-foreground";
/** The agency account's name in the UI role (600, 13.5px, the card's text), as a record card's title. */
const ACCOUNT_HEADING = "min-w-0 break-words text-[13.5px] font-semibold text-card-foreground";

/** "Showing the newest 200." under a capped stack (plan deviation 19). Exported for the styleguide. */
export function SuggestionCapLine({ tr }: { tr: Tr }) {
  return <p className={SUBHEAD}>{tr.text("suggestions.cap", { n: 200 })}</p>;
}

function ErrorLine({ tr }: { tr: Tr }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3">
      <p className="min-w-0 text-sm text-foreground">{tr.text("suggestions.loadFailed")}</p>
      <SuggestionRetry label={tr.text("common.retry")} />
    </div>
  );
}

const subhead = (tr: Tr, personaName: string) => tr.text("suggestions.subhead", { persona: personaName.trim() || "Sofía" });

function Heading({ id, tr }: { id: string; tr: Tr }) {
  return <h2 id={id} className={MONO_LABEL}>{tr.text("suggestions.heading")}</h2>;
}

export function SuggestionSection({
  tr, personaName, data, headingId = "suggestions", ...actions
}: {
  tr: Tr; personaName: string; data: SuggestionSectionData;
  /** The heading's id, which the section is labelled by; the call page keeps its #call-proposals anchor. */
  headingId?: string;
} & SuggestionActionProps) {
  if (data.ok && cardCount(data) === 0) return null;
  return (
    // The tray's last card leaves with the section: focus falls back to the page's heading (I3).
    <section lang={tr.locale} aria-labelledby={headingId} data-suggestion-list data-focus-fallback={focusFallback("h1")} className={SECTION}>
      <Heading id={headingId} tr={tr} />
      {data.ok ? (
        <>
          <p className={SUBHEAD}>{subhead(tr, personaName)}</p>
          {"groups" in data
            ? data.groups.map((g) => <SuggestionGroupBlock key={g.key} group={g} {...actions} />)
            : data.views.map((view) => <SuggestionCard key={view.id} view={view} {...actions} />)}
          {data.capped ? <SuggestionCapLine tr={tr} /> : null}
        </>
      ) : (
        <ErrorLine tr={tr} />
      )}
    </section>
  );
}

/** One account's part of the agency Work page: its brand name, its persona, its groups and its own bound actions. */
export type AgencySuggestionAccount = {
  accountId: string; brandName: string; personaName: string; capped: boolean;
  groups: SuggestionGroup[]; actions: SuggestionActionProps;
};
export type AgencySuggestionData = { ok: true; accounts: AgencySuggestionAccount[] } | { ok: false };

/**
 * The agency Work page's suggestions (item 8b-2, spec 5.2): the tray's cards, with their actions, under each
 * account's brand name (an <h3> in the UI role, design review I4: the account boundary must read as one,
 * not as a third mono label), then that account's groups as in the tray (mono <h4>), then "Showing the
 * newest 50 for this account." when the read held more. Each account section is its own focus list, and
 * each carries the actions the page bound to THAT account; the outer section is their focus scope, so an
 * account's last card hands focus to the next account's first Accept, then to this heading (I3). No card
 * wraps an account (P12). Absent when nothing is pending anywhere; the heading, one line and Retry when the
 * read failed (rule 5). `headingId`: two copies on one page (the styleguide) each need their own ids.
 */
export function AgencySuggestionSection({ tr, data, headingId = "agency-suggestions" }: {
  tr: Tr; data: AgencySuggestionData; headingId?: string;
}) {
  if (data.ok && data.accounts.length === 0) return null;
  return (
    <section lang={tr.locale} aria-labelledby={headingId} data-proposals data-suggestion-scope className="flex flex-col gap-6">
      <Heading id={headingId} tr={tr} />
      {data.ok ? data.accounts.map((a) => {
        const id = `${headingId}-${a.accountId}`;
        return (
          <section key={a.accountId} data-suggestion-account={a.accountId} data-suggestion-list aria-labelledby={id}
            data-focus-fallback={focusFallback(`#${headingId}`, "h1")} className={SECTION}>
            <h3 id={id} className={ACCOUNT_HEADING}>{a.brandName}</h3>
            <p className={SUBHEAD}>{subhead(tr, a.personaName)}</p>
            {a.groups.map((g) => <SuggestionGroupBlock key={g.key} group={g} level={4} {...a.actions} />)}
            {/* The per-account cap (spec 5.2; plan deviation 4): the read asks for 51 to state 50. */}
            {a.capped ? <p className={SUBHEAD}>{tr.text("suggestions.capAccount", { n: AGENCY_PER_ACCOUNT })}</p> : null}
          </section>
        );
      }) : <ErrorLine tr={tr} />}
    </section>
  );
}

/** Two cards shaped like the card while the section loads: a label line, the change, the evidence, the buttons.
 *  `grouped` (the To do tray, item 8b-2): a group heading's label bar above them, as the loaded tray has. */
export function SuggestionSectionSkeleton({ tr, grouped = false, headingId = "suggestions-loading" }: {
  tr: Tr; grouped?: boolean;
  /** Two skeletons on one page (the styleguide's locale columns) each need their own id. */
  headingId?: string;
}) {
  const line = "rounded-[var(--radius-ctl)]";
  return (
    <section lang={tr.locale} className={SECTION}>
      <Heading id={headingId} tr={tr} />
      <p role="status" className={SUBHEAD}>{tr.text("suggestions.loading")}</p>
      {grouped ? <Skeleton data-tray-group-bar aria-hidden className={`h-3 w-56 max-w-full ${line}`} /> : null}
      {[0, 1].map((i) => (
        <div key={i} data-skeleton className={SUGGESTION_CARD} aria-hidden>
          <Skeleton className={`h-3 w-2/5 ${line}`} />
          <Skeleton className={`h-4 w-4/5 ${line}`} />
          <Skeleton className={`h-4 w-3/5 ${line}`} />
          {/* Wraps: three fixed widths in one row were the card's min-content (330px) at phone width. */}
          <div className="flex flex-wrap gap-2">
            <Skeleton className={`h-8 w-20 ${line}`} />
            <Skeleton className={`h-8 w-28 ${line}`} />
            <Skeleton className={`h-8 w-20 ${line}`} />
          </div>
        </div>
      ))}
    </section>
  );
}
