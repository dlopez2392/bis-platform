"use client";

import { Button } from "@/components/ui/button";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";
import { HighlightedText } from "@/components/highlighted-text";
import { nameRanges, phoneRanges } from "@/lib/contacts/search-highlight";
import type { HeldSearchState, SearchHitLite } from "./held-email-search";

/**
 * "Choose a record"'s own result list — split out from `held-email-list.tsx`
 * so it is testable by PROPS, with no fetch and no DOM: `idle` (query too
 * short, nothing drawn), `error` (the search call itself failed — a real
 * line, `searchFailed`, never the "no customer matches" of a real empty
 * result), and `ok` with zero or more hits, each naming the contact AND
 * their own address/phone underneath (`sublabel`) — two "Ana Ruiz"es are
 * never offered as though they were the same person.
 */
export function HeldSearchResults({
  state, pending, locale, onPick,
}: {
  state: HeldSearchState;
  pending: boolean;
  locale: Locale;
  onPick: (hit: SearchHitLite) => void;
}) {
  if (state.status === "idle") return null;
  if (state.status === "error") {
    return (
      <p role="alert" className="text-xs text-[var(--crit)]">
        {t(m, "conversations.held.searchFailed", locale)}
      </p>
    );
  }
  if (state.hits.length === 0) {
    return <p className="text-xs text-muted-foreground">{t(m, "conversations.held.searchEmpty", locale)}</p>;
  }
  // F-092 part 1 (plan Task 10): the matched letters/digits, against the QUERY THESE HITS ANSWERED
  // (state.query), never a query typed since — a stale render would otherwise mark the wrong thing.
  const { query } = state;
  return (
    <div className="flex flex-wrap gap-1.5">
      {state.hits.map((hit) => (
        <Button
          key={hit.id} type="button" variant="ghost" size="sm"
          className="h-auto min-h-11 flex-col items-start gap-0 py-1.5 md:min-h-8"
          disabled={pending}
          onClick={() => onPick(hit)}
        >
          <span><HighlightedText text={hit.label} ranges={nameRanges(hit.label, query)} /></span>
          {hit.sublabel ? (
            <span className="text-xs text-muted-foreground">
              <HighlightedText text={hit.sublabel} ranges={phoneRanges(hit.sublabel, query)} />
            </span>
          ) : null}
        </Button>
      ))}
    </div>
  );
}
