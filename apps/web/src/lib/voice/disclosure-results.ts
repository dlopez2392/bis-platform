// S-47a §5.3: the results card's numbers, decided here and rendered by disclosure-results-view.tsx.
// Pure. Never a verdict: it says when there is too little to tell, and otherwise shows the numbers only.
import type { DisclosureResults, DisclosureHalf } from "@bis/db";

/** Below this many counted calls in EITHER half, the card says there is not enough to tell. */
export const DISCLOSURE_MIN_PER_HALF = 30;

export type DisclosureColumnView = {
  counted: number; bookedPct: number | null; hungUpPct: number | null; askedPersonPct: number | null;
};
export type DisclosureResultsView =
  | { state: "empty"; notCounted: number }
  | { state: "loaded"; said: DisclosureColumnView; didnt: DisclosureColumnView; notEnough: boolean; notCounted: number };

const pct = (part: number, of: number): number | null => (of === 0 ? null : Math.round((100 * part) / of));

function column(h: DisclosureHalf): DisclosureColumnView {
  return {
    counted: h.counted,
    bookedPct: pct(h.booked, h.counted),
    hungUpPct: pct(h.abandoned, h.counted),
    askedPersonPct: pct(h.askedPerson, h.counted),
  };
}

export function disclosureResultsView(r: DisclosureResults): DisclosureResultsView {
  if (r.said.counted === 0 && r.didnt.counted === 0) return { state: "empty", notCounted: r.notCounted };
  return {
    state: "loaded",
    said: column(r.said), didnt: column(r.didnt),
    notEnough: r.said.counted < DISCLOSURE_MIN_PER_HALF || r.didnt.counted < DISCLOSURE_MIN_PER_HALF,
    notCounted: r.notCounted,
  };
}
