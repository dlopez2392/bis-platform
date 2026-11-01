import { m } from "@/lib/messages";
import { plural, t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";

/**
 * The CSV import's running totals across its batches (final review I-C). Each
 * batch answers real counts from `applyImportBatch`; this sums them, including
 * the business names that could not be saved, so the done screen reports what
 * actually happened and never a number it did not receive.
 */
export type ImportBatchCounts = {
  created: number; updated: number; flagged: number;
  /** Rows whose business name was over 120 characters, so no business was linked. */
  businessTooLong?: number;
  /** The batch's one business write failed after its contacts were saved. */
  businessLinkFailed?: boolean;
};
export type ImportTotals = {
  created: number; updated: number; flagged: number; businessTooLong: number; businessLinkFailed: boolean;
};

export const NO_IMPORT_YET: ImportTotals = {
  created: 0, updated: 0, flagged: 0, businessTooLong: 0, businessLinkFailed: false,
};

export function addImportBatch(totals: ImportTotals, batch: ImportBatchCounts): ImportTotals {
  return {
    created: totals.created + batch.created,
    updated: totals.updated + batch.updated,
    flagged: totals.flagged + batch.flagged,
    businessTooLong: totals.businessTooLong + (batch.businessTooLong ?? 0),
    businessLinkFailed: totals.businessLinkFailed || batch.businessLinkFailed === true,
  };
}

/**
 * S-10 leftovers (#317 follow-up, item 5): the done screen's headline — "Added {created},
 * updated {updated}." — as two independently-pluralized clauses, never one template with both
 * placeholders. Created and updated are independent counts: a single Spanish sentence cannot
 * say "se agregó 1" (singular) and "se actualizaron 3" (plural) at once, which the review's
 * own "Se agregaron 1" finding named. English needs no second form (its verb does not
 * conjugate by number), so this changes nothing visible there.
 */
export function doneLine(totals: ImportTotals, locale: Locale): string {
  const created = plural(m, "contacts.import.doneCreated", totals.created, locale, { count: totals.created });
  const updated = plural(m, "contacts.import.doneUpdated", totals.updated, locale, { count: totals.updated });
  return `${created}, ${updated}`;
}

/** The done screen's flagged-duplicates line, with the singular/plural pair "1 flagged" vs
 *  "N flagged" needs at count 1 (S-10 leftovers item 5) — null when there is nothing to flag,
 *  exactly as the wizard already shows it only when non-zero. */
export function flaggedLine(totals: ImportTotals, locale: Locale): string | null {
  return totals.flagged > 0
    ? plural(m, "contacts.import.flagged", totals.flagged, locale, { flagged: totals.flagged })
    : null;
}

/** The done screen's lines about business names that did not save; none when every one did. */
export function importBusinessNotes(totals: ImportTotals, locale: Locale): string[] {
  const notes: string[] = [];
  if (totals.businessTooLong > 0) {
    notes.push(plural(m, "contacts.import.businessTooLong", totals.businessTooLong, locale, { count: totals.businessTooLong }));
  }
  if (totals.businessLinkFailed) notes.push(t(m, "contacts.import.businessLinkFailed", locale));
  return notes;
}
