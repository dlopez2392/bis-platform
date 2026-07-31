import type { SubmissionConsent } from "@bis/db";

/**
 * `SubmissionRow.consent` is typed `SubmissionConsent[] | null`, and that type
 * lies about rows written before 360190f: those hold a single
 * `{given, text, at}` object rather than an array, and jsonb accepted both
 * happily. Anything that reads consent has to cope with the old shape or it
 * crashes on exactly the oldest records — the ones most likely to be the
 * subject of a "prove they agreed" question.
 *
 * Entries missing `text` are dropped: a consent record that cannot say what
 * was agreed to is not evidence of anything, and rendering a bare "Agreed"
 * beside no text would imply more than the row supports.
 */
export function normalizeConsent(value: unknown): SubmissionConsent[] {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const text = typeof record.text === "string" ? record.text.trim() : "";
    if (!text) return [];
    return [{
      // The old single-object shape carries no key. The index keeps React
      // happy and is stable for a row that never changes after it is written.
      key: typeof record.key === "string" && record.key ? record.key : `consent_${index}`,
      given: record.given === true,
      text,
      at: typeof record.at === "string" ? record.at : "",
    }];
  });
}
