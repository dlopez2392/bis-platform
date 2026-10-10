import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const LABEL_ROLE_FILES = [
  "../../components/app-sidebar.tsx",
  "../../components/stat-tile.tsx",
].map((p) => path.join(here, p));

describe("Label-role rendering never imports the diacritic-stripping keyword matcher", () => {
  it("app-sidebar.tsx and stat-tile.tsx do not import consent/keywords.ts or consent/phrases.ts (mutation: import normalizeKeyword from consent/keywords.ts for 'display tidiness' → FAILS, catching exactly the defect F-014 names)", () => {
    for (const file of LABEL_ROLE_FILES) {
      const src = readFileSync(file, "utf8");
      expect(src, file).not.toMatch(/consent\/keywords/);
      expect(src, file).not.toMatch(/consent\/phrases/);
    }
  });
});
