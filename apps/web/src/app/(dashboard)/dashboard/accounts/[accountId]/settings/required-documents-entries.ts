import { REQUIRABLE_DOCUMENT_CATEGORIES, type RequirableCategory } from "@bis/db/document-rules";

/**
 * S-10 T9b: split out of required-documents-card.tsx, whose own card is
 * agency-only (D6, 2026-10-16: rendered only from the Settings page,
 * requireAgencyOnlyAccountAccess) — but the client-reachable Documents
 * page's own summary (required-documents-summary.tsx) imports this ONE
 * pure helper, which made the import-graph closure call the WHOLE card
 * file (and its real `m[...]` reads) client-reachable too. No catalogue
 * read here at all, so none to exempt.
 *
 * The eight rows post hidden inputs built from `picked` rather than relying
 * on Radix's own Checkbox form participation, so the form posts exactly
 * what is drawn on screen (D8: eight categories, no "Other").
 */
export function requiredFormEntries(picked: ReadonlySet<RequirableCategory>): [string, string][] {
  return REQUIRABLE_DOCUMENT_CATEGORIES.filter((c) => picked.has(c)).map((c) => ["category", c]);
}
