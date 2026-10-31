import { Fragment } from "react";
import { splitByRanges, type HighlightRange } from "@/lib/contacts/search-highlight";

/**
 * F-092 part 1 (plan Task 7): once a search has decided a contact's name or phone matched, this is where
 * the matched letters get set apart from the rest of the displayed text — weight 600, colour and
 * background inherited (DESIGN.md: hierarchy by weight first, colour last, never a 5th surface or a
 * second colour). `<mark>` carries `data-search-hit` so the command palette, the contact list and the
 * relationship picker can be probed for a hit without duplicating this rule in each one.
 */
export function HighlightedText({ text, ranges }: { text: string; ranges: readonly HighlightRange[] }) {
  if (ranges.length === 0) return <>{text}</>;
  return (
    <>
      {splitByRanges(text, ranges).map((p, i) =>
        p.hit ? (
          <mark key={i} data-search-hit className="bg-transparent font-semibold text-inherit">
            {p.text}
          </mark>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        ),
      )}
    </>
  );
}
