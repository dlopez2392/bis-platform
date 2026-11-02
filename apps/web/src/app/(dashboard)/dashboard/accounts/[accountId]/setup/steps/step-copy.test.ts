import { describe, it, expect } from "vitest";
import { STEP_COPY } from "./step-copy";

// S-10 T9b: split out of step-shared.tsx, whose `NumberChip` export is read
// by the CLIENT-reachable alert-phone-card.tsx (Branding), which made the
// whole file "client-reachable" to the import-graph closure and so unable
// to exempt STEP_COPY's module-level `m[...]` reads from G1/G3 by reference.
// STEP_COPY itself is read only by setup-panel.tsx/setup-rail.tsx/
// setup-shell.tsx, all genuinely agency-only (requireAgencyOnlyAccountAccess)
// — moving it here needs no new exemption mechanism, just the existing
// reference-based one applied to a file that is ACTUALLY agency-only.
describe("STEP_COPY", () => {
  it("has a title and help for every setup step (mutation: delete one entry → FAILS by name)", () => {
    for (const key of [
      "account", "branding", "hours", "voice_profile", "website_assistant",
      "number", "email", "forwarding", "test_call", "go_live",
    ] as const) {
      expect(STEP_COPY[key].title.length, key).toBeGreaterThan(0);
      expect(STEP_COPY[key].help.length, key).toBeGreaterThan(0);
    }
  });
});
