import { MERGE_COUNT_KEYS, type MergeCountKey } from "@bis/db";
import { m } from "@/lib/messages";
import type { PluralKey } from "@/lib/i18n/t";
import type { Tr } from "@/lib/record/copy";
import type { Locale } from "@/lib/i18n/locale";

/**
 * F-006 part 1 (plan Task 9): the compare screen's "Moves to {name}: {list}" (contacts.merge.moves)
 * and the merge timeline row's own list (timeline.merged) share this one builder — the eight counted
 * phrases (contacts.merge.count.*), each respecting its own One twin (`tr.count`, never the "other"
 * form unconditionally), joined the DESIGN way (Intl.ListFormat, never a hand-rolled comma rule). A
 * zero count is left out (DESIGN.md: a count we did not move is omitted, never zeroed); `{}` answers
 * "" (the caller then reads contacts.merge.nothingMoves or timeline.mergedEmpty instead).
 */
const COUNT_KEY: Record<MergeCountKey, PluralKey<typeof m>> = {
  messages: "contacts.merge.count.messages",
  calls: "contacts.merge.count.calls",
  bookings: "contacts.merge.count.bookings",
  documents: "contacts.merge.count.documents",
  opportunities: "contacts.merge.count.opportunities",
  notes: "contacts.merge.count.notes",
  tasks: "contacts.merge.count.tasks",
  form_submissions: "contacts.merge.count.form_submissions",
};

/** A count that is not a positive number (missing, zero, negative, NaN)
 *  never moved anything — shared by `mergeCountsList` (which phrase to
 *  include) and `mergeCountsTotal` (m5, review fix round: the two used to
 *  apply this filter separately, and could silently disagree about a
 *  malformed count — e.g. a negative value was EXCLUDED from the list but
 *  still added to the total, same as a `notes: -1` bug subtracting from
 *  the sentence's own grammatical number). */
function positiveCount(n: number | undefined): number {
  return typeof n === "number" && n > 0 ? n : 0;
}

export function mergeCountsList(counts: Partial<Record<MergeCountKey, number>>, tr: Tr, locale: Locale): string {
  const phrases = MERGE_COUNT_KEYS.flatMap((key) => {
    const n = positiveCount(counts[key]);
    return n > 0 ? [tr.count(COUNT_KEY[key], n)] : [];
  });
  if (phrases.length === 0) return "";
  return new Intl.ListFormat(locale === "es" ? "es-US" : "en-US", { type: "conjunction" }).format(phrases);
}

/**
 * S-10 T9a: the sum of every counted category, for the ONE agreement
 * decision a sentence wrapped around `mergeCountsList`'s own output still
 * has to make on its own — "1 nota pasó aquí" (singular) vs "1 nota y 1
 * llamada pasaron aquí" (plural, even though each category's own count is
 * 1). `mergeCountsList` already gives each PHRASE its own singular/plural
 * form (`tr.count`); this is the grammatical number of the SENTENCE the
 * list sits inside, which depends on how many items moved in total, not on
 * how many categories are nonzero. Shares `positiveCount` with
 * `mergeCountsList` (m5) so the two can never disagree about which counts
 * are real.
 */
export function mergeCountsTotal(counts: Partial<Record<MergeCountKey, number>>): number {
  return MERGE_COUNT_KEYS.reduce((sum, key) => sum + positiveCount(counts[key]), 0);
}
