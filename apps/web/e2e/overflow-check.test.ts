import { describe, it, expect } from "vitest";
import { clipFailure, pseudoTitleFallbackFailure } from "./overflow-check";

describe("clipFailure", () => {
  it("is null when the element fits — scrollWidth <= clientWidth (positive control: the original defect measured an element that could never produce the OTHER branch, so this never ran for real)", () => {
    expect(clipFailure(100, 100, "x")).toBeNull();
    expect(clipFailure(80, 100, "x")).toBeNull();
  });

  it("reports a clip when scrollWidth exceeds clientWidth, naming what clipped (mutation: flip `>` to `<` → FAILS, a real clip would be reported as fine)", () => {
    const msg = clipFailure(140, 100, 'nav label "Phone numbers"');
    expect(msg).not.toBeNull();
    expect(msg).toContain('nav label "Phone numbers"');
    expect(msg).toMatch(/clips/);
  });
});

describe("pseudoTitleFallbackFailure", () => {
  it("is null when nothing clips, regardless of title (mutation: drop the scrollWidth<=clientWidth early return → a non-clipping, title-less element FAILS)", () => {
    expect(pseudoTitleFallbackFailure(100, 100, null, "Phone numbers")).toBeNull();
    expect(pseudoTitleFallbackFailure(90, 100, "wrong title entirely", "Phone numbers")).toBeNull();
  });

  it("is null when it clips and the title carries the exact full text", () => {
    expect(pseudoTitleFallbackFailure(140, 100, "Números de teléfono", "Números de teléfono")).toBeNull();
  });

  it("fails when it clips and the title is missing or wrong (mutation: drop the `=== text` check → a clipped label with no title PASSES, hiding the exact defect this check exists for)", () => {
    const missing = pseudoTitleFallbackFailure(140, 100, null, "Números de teléfono");
    expect(missing).not.toBeNull();
    expect(missing).toMatch(/does not match/);

    const wrong = pseudoTitleFallbackFailure(140, 100, "wrong title", "Números de teléfono");
    expect(wrong).not.toBeNull();
    expect(wrong).toMatch(/does not match/);
  });
});
