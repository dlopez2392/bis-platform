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

/** The done screen's lines about business names that did not save; none when every one did. */
export function importBusinessNotes(totals: ImportTotals, locale: Locale): string[] {
  const notes: string[] = [];
  if (totals.businessTooLong > 0) {
    notes.push(plural(m, "contacts.import.businessTooLong", totals.businessTooLong, locale, { count: totals.businessTooLong }));
  }
  if (totals.businessLinkFailed) notes.push(t(m, "contacts.import.businessLinkFailed", locale));
  return notes;
}
