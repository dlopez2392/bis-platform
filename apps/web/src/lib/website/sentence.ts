import type { Period } from "./view-model";

export type SentenceSegment = { text: string; strong?: true };
type Ranked = { name: string; visitors: number; share: number };

const LEAD_MARGIN = 0.10;        // top vs runner-up, in share points
const SAME_THRESHOLD = 0.05;     // under this the change reads "about the same"
const PLAIN_COUNT_BELOW = 20;    // no percentages for a tiny site
const DEVICE_SHARE = 0.60;
const TENTHS = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

function periodWords(period: Period): string {
  return period === 7 ? "the week" : period === 14 ? "the two weeks" : "the month";
}
function deviceWords(name: string): string {
  const n = name.toLowerCase();
  return n === "mobile" ? "a phone" : n === "desktop" ? "a computer" : n === "tablet" ? "a tablet" : `a ${n}`;
}
const fmt = (n: number) => n.toLocaleString("en-US");

/**
 * The sentence panel. Built from the same numbers as the tiles, so it can
 * never disagree with them. Four restraint rules, each pinned by a test: a
 * tiny site gets a plain count and no percentages; under 5% reads "about the
 * same"; a top source or page is named only with a 10-point lead; a device
 * is named only at 60% share.
 */
export function websiteSentence(input: {
  period: Period; visitors: number; priorVisitors: number;
  topSource: Ranked | null; runnerUpSourceShare: number;
  topPage: Ranked | null; runnerUpPageShare: number;
  topDevice: Ranked | null;
}): SentenceSegment[] {
  const p = periodWords(input.period);
  const inThe = p.replace("the ", "");
  if (input.visitors === 0) return [{ text: `No one has visited your website in the last ${inThe} yet.` }];
  if (input.visitors < PLAIN_COUNT_BELOW || input.priorVisitors === 0) {
    const noun = input.visitors === 1 ? "person" : "people";
    return [{ text: `${fmt(input.visitors)} ${noun}`, strong: true }, { text: ` visited your website in the last ${inThe}.` }];
  }

  const out: SentenceSegment[] = [{ text: `${fmt(input.visitors)} people`, strong: true }, { text: " visited your website, " }];
  const change = (input.visitors - input.priorVisitors) / input.priorVisitors;
  if (Math.abs(change) < SAME_THRESHOLD) {
    out.push({ text: `about the same as ${p} before.` });
  } else {
    const pct = Math.round(Math.abs(change) * 100);
    out.push({ text: `${pct}% ${change > 0 ? "more" : "fewer"}`, strong: true }, { text: ` than ${p} before.` });
  }

  const clauses: SentenceSegment[][] = [];
  if (input.topSource && input.topSource.share - input.runnerUpSourceShare >= LEAD_MARGIN && input.topSource.name !== "Direct") {
    clauses.push([{ text: "Most of them found you on " }, { text: input.topSource.name, strong: true }]);
  }
  if (input.topPage && input.topPage.share - input.runnerUpPageShare >= LEAD_MARGIN) {
    clauses.push([{ text: "the page they read most was " }, { text: input.topPage.name, strong: true }]);
  }
  if (input.topDevice && input.topDevice.share >= DEVICE_SHARE) {
    const tenths = Math.round(input.topDevice.share * 10);
    clauses.push([{ text: tenths >= 10 ? `nearly all of them were on ${deviceWords(input.topDevice.name)}` : `${TENTHS[tenths]} in ten were on ${deviceWords(input.topDevice.name)}` }]);
  }
  if (clauses.length === 0) return out;

  out.push({ text: " " });
  clauses.forEach((clause, i) => {
    if (i > 0) out.push({ text: i === clauses.length - 1 ? ", and " : ", " });
    const first = clause[0]!;
    // Sentence case only for the first clause; the others continue the sentence.
    out.push(i === 0 ? { ...first, text: first.text.charAt(0).toUpperCase() + first.text.slice(1) } : first);
    out.push(...clause.slice(1));
  });
  out.push({ text: "." });
  return out;
}
