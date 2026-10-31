import { foldChar } from "@bis/db/dedupe-keys";
import { contactSearchPlan } from "@bis/db/contact-search";

/**
 * F-092 part 1 (spec section 5's "map matches back onto the displayed text"): once the server has decided a
 * contact matched a search, this pure, client-safe module decides WHERE in the contact's own displayed name or
 * phone number to draw attention. It never searches or ranks; it only re-derives the fold `contactSearchFilter`
 * and `contactSearchPlan` already apply, this time against one already-matched string, so the UI can mark the
 * exact letters or digits a person typed — never a guess, never the whole field.
 */

/** A half-open range of UTF-16 offsets into the DISPLAYED text (end exclusive). */
export type HighlightRange = readonly [start: number, end: number];

// A combining mark (a decomposed accent, e.g. "e" + U+0301) folds to "" on its own; it belongs to the base
// letter immediately before it, so a hit that ends on that letter must stretch to cover the mark too.
const MARK = /\p{M}/u;

/** Every place a typed word (folded exactly as search folds it) appears in `text`, as ranges of the ORIGINAL,
 *  unfolded text. Each typed token can hit more than once; overlapping or touching hits are merged into one. */
export function nameRanges(text: string, query: string): HighlightRange[] {
  const { tokens } = contactSearchPlan(query);
  if (tokens.length === 0 || text === "") return [];
  let folded = "";
  const from: number[] = [];
  const to: number[] = [];
  let i = 0;
  for (const ch of text) {
    // Per code point, exactly as nameFold folds: `ch.length` (not 1) advances past a surrogate pair correctly.
    const f = foldChar(ch);
    if (f !== "") {
      folded += f;
      from.push(i);
      to.push(i + ch.length);
    } else if (MARK.test(ch) && to.length > 0) {
      to[to.length - 1] = i + ch.length;
    }
    i += ch.length;
  }
  const out: [number, number][] = [];
  for (const t of tokens) {
    for (let at = folded.indexOf(t); at !== -1; at = folded.indexOf(t, at + 1)) {
      out.push([from[at]!, to[at + t.length - 1]!]);
    }
  }
  return merge(out);
}

/** Where the searched digits sit in a number as it is DISPLAYED (with its own punctuation): the matched key's
 *  digits first, else the national ten (the legacy-Mexican-mobile fallback `contactSearchPlan` already computed),
 *  else `keptKey` (af5976fa's own digits, kept for a row the list found through that clause when the new key
 *  does not cover them: a short "+1 956" or "+521 899 12" term, T5's `ContactSearchPlan.keptKey`). At most one
 *  range: a phone search matches a single contiguous run of digits, never several — the last such run. */
export function phoneRanges(text: string, query: string): HighlightRange[] {
  const { phone, keptKey } = contactSearchPlan(query);
  if ((!phone && !keptKey) || text === "") return [];
  const pos: number[] = [];
  let digits = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch >= "0" && ch <= "9") {
      digits += ch;
      pos.push(i);
    }
  }
  for (const needle of [phone?.key, phone?.national, keptKey]) {
    if (!needle) continue;
    // The LAST run, never the first (final review M-4b): the search matched the stored key, which has the
    // country code folded off, so a first run that starts on that "1" ("+1 (956) 555-1956" for "1956") is not
    // what matched. The last run always starts as late as any run can, so it sits after the country code
    // whenever any run does.
    const at = digits.lastIndexOf(needle);
    if (at !== -1) return [[pos[at]!, pos[at + needle.length - 1]! + 1]];
  }
  return [];
}

/** Sort by start, then join any pair that overlaps OR touches (next start <= current end) into one range. */
function merge(ranges: [number, number][]): HighlightRange[] {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [[sorted[0]![0], sorted[0]![1]]];
  for (let i = 1; i < sorted.length; i++) {
    const [s, e] = sorted[i]!;
    const last = out[out.length - 1]!;
    if (s <= last[1]) {
      if (e > last[1]) last[1] = e;
    } else {
      out.push([s, e]);
    }
  }
  return out;
}

/** `text` cut at `ranges` (assumed already sorted and merged, as `nameRanges`/`phoneRanges` return them) into
 *  alternating plain and hit parts. `parts.map(p => p.text).join("")` always equals `text`; no part is "". */
export function splitByRanges(
  text: string,
  ranges: readonly HighlightRange[],
): { text: string; hit: boolean }[] {
  const out: { text: string; hit: boolean }[] = [];
  let pos = 0;
  for (const [start, end] of ranges) {
    if (start > pos) out.push({ text: text.slice(pos, start), hit: false });
    if (end > start) out.push({ text: text.slice(start, end), hit: true });
    pos = Math.max(pos, end);
  }
  if (pos < text.length) out.push({ text: text.slice(pos), hit: false });
  return out;
}
