/** Sentinel value used by the single_select custom-field control to mean
 *  "cleared" — Radix Select cannot represent an empty-string item value,
 *  so this stands in for the native `<option value="">` reset option.
 *
 *  Lives here rather than in `actions.ts` because a file-level "use server"
 *  module may only export async functions. Keeping the directive at file
 *  scope means a new action cannot accidentally ship without it. */
export const CLEAR_FIELD_SENTINEL = "__clear__";
