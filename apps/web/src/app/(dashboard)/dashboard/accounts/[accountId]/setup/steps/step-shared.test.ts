import { describe, it, expect } from "vitest";
import { STEP_PATH } from "./step-shared";

// F-046 part 1 (plan Task 7): nothing pinned STEP_PATH before. The Calendar page's first card is now the
// agenda, so the hours step names the settings card's own anchor (`calendar-settings.tsx`'s outer card,
// pinned in `calendar-settings.test.ts`), keeping `?from=setup` for the BackToSetup breadcrumb.
describe("STEP_PATH", () => {
  it("the hours step lands on the booking settings card, from setup (mutation: the bare /calendar?from=setup → FAILS)", () => {
    expect(STEP_PATH.hours).toBe("/calendar?from=setup#booking-settings");
  });
});
