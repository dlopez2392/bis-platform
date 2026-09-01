import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const globals = readFileSync(
  join(__dirname, "../../app/(dashboard)/globals.css"), "utf-8");

describe("design foundation: fonts", () => {
  it("exposes --font-display mapped to the Bricolage variable", () => {
    expect(globals).toMatch(/--font-display:\s*var\(--font-bricolage\)/);
  });
});
