// What a call may do with appointments — one answer, read by the prompt
// (`system-prompt.ts`), the session's tool list (`session-config.ts` →
// `toolSchemas`) and `runTool`'s own guard (`tools/registry.ts`), so the model
// is never told one thing while holding the tools for another.

/**
 * - `full`: book new appointments and manage existing ones.
 * - `manage`: "Always take a message" (D-040, owner decisions 2026-10-08 and
 *   2026-10-09) replaces NEW booking only — an appointment the caller already
 *   has can still be found, moved or cancelled.
 * - `none`: the profile does not allow booking at all.
 */
export type BookingMode = "full" | "manage" | "none";

export function bookingMode(
  input: { bookingEnabled: boolean; afterHours: "hours_then_message" | "message_only" | undefined },
): BookingMode {
  if (!input.bookingEnabled) return "none";
  return input.afterHours === "message_only" ? "manage" : "full";
}
