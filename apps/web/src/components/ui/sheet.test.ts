import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(fileURLToPath(new URL("./sheet.tsx", import.meta.url)), "utf8");

describe("SheetContent's close button names itself in the reader's language (S-03 part 3, orchestrator ruling)", () => {
  it("the sr-only name is the closeLabel prop (mutation: keep the literal Close -> FAILS)", () => {
    expect(src).toMatch(/<span className="sr-only">\{closeLabel\}<\/span>/);
    expect(src).not.toMatch(/<span className="sr-only">Close<\/span>/);
  });
  it("defaults to Close, so every other sheet is unchanged (mutation: drop the default -> FAILS)", () => {
    expect(src).toMatch(/closeLabel = "Close"/);
  });
});
