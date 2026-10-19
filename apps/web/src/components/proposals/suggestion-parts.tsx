import { Fragment } from "react";
import type { Part } from "@/lib/proposals/kinds/types";

/**
 * A suggestion's sentence, part by part (item 8b-1): the model's own words keep their `lang` (P18), and a
 * run that is drawn but not read (the field change's arrow) is aria-hidden with its spoken words beside it
 * for a screen reader (design review minor 3). One renderer for the card and the agency Work page's row.
 */
export function SuggestionParts({ parts }: { parts: Part[] }) {
  return (
    <>
      {parts.map((p, i) => (p.spoken !== undefined ? (
        <Fragment key={i}><span aria-hidden="true">{p.text}</span><span className="sr-only">{p.spoken}</span></Fragment>
      ) : p.lang ? (
        <span key={i} lang={p.lang}>{p.text}</span>
      ) : (
        <Fragment key={i}>{p.text}</Fragment>
      )))}
    </>
  );
}
