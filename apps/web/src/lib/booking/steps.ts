/**
 * Where the visitor is in the booking flow, derived from state the page
 * already holds — no new state, and nothing to keep in step with anything.
 *
 * Pure and in `lib/` rather than beside the component because this app's
 * vitest has NO DOM (`vitest.config.ts` includes only `*.test.ts`, never
 * `.tsx`), so logic that lives in the component file cannot be unit-tested
 * at all.
 */
export type BookingStep = 1 | 2 | 3;

export const BOOKING_STEP_COUNT = 3;

export function bookingStep(
  state: { selectedSlot: string | null; succeeded: boolean },
): BookingStep {
  // Success is checked FIRST. The component's success branch early-returns and
  // never renders the picker, so a confirmed booking is step 3 regardless of
  // what `selectedSlot` still holds — checking the slot first would claim
  // step 2 on a booking the visitor has already completed.
  if (state.succeeded) return 3;
  if (state.selectedSlot) return 2;
  return 1;
}
