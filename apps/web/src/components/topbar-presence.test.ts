// apps/web/src/components/topbar-presence.test.ts
import { describe, it, expect } from "vitest";
import { onCallText } from "./topbar-presence";

/**
 * D-063 follow-up (coordinator, cheap/minor): hard-coding "Sofía" in
 * topbar-presence.tsx passed every existing test in this repo — there was
 * none reaching this component at all. `onCallText` is the pure function
 * pulled out of TopbarPresence specifically so this has a test seam without
 * needing a render harness (the repo has no .tsx test convention today).
 */
describe("onCallText", () => {
  it("names the account's OWN configured persona (mutation: hard-code 'Sofía' → FAILS)", () => {
    expect(onCallText("Max")).toBe("Max · on a call");
  });

  it("falls back to 'Sofía' when the persona name is missing", () => {
    expect(onCallText(null)).toBe("Sofía · on a call");
    expect(onCallText(undefined)).toBe("Sofía · on a call");
  });

  it("falls back to 'Sofía' when the persona name is blank (whitespace only)", () => {
    expect(onCallText("   ")).toBe("Sofía · on a call");
  });

  it("trims surrounding whitespace off a real persona name", () => {
    expect(onCallText("  Max  ")).toBe("Max · on a call");
  });

  it("does not re-interpret '$&' in a persona name as a replacement pattern", () => {
    // String.replace treats a STRING second argument as a pattern ($&, $1,
    // …); a function second argument never is. A persona containing one of
    // those sequences must appear verbatim.
    expect(onCallText("Bob's $& Shop")).toBe("Bob's $& Shop · on a call");
  });
});
