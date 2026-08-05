/** Sentinel value for "no blueprint" in the create-account dialog's blueprint
 *  select — Radix Select cannot represent an empty-string item value, so this
 *  stands in for the native `<option value="">` reset option (same problem,
 *  same fix, as `CLEAR_FIELD_SENTINEL` in
 *  `[accountId]/contacts/[contactId]/constants.ts`).
 *
 *  Lives here rather than in `actions.ts` because a file-level "use server"
 *  module may only export async functions. */
export const NO_BLUEPRINT_SENTINEL = "__none__";
