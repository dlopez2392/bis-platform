import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
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

// S-10 G7 (spec 2026-10-31-spanish-dashboard-design.md §5.2): the same rule
// for every screen, not two files. Three things in lib/ strip accents on
// purpose: consent/keywords.ts and consent/phrases.ts (so "PARAR" matches
// "PÁRAR" when a customer texts it) and sms/alerts.ts's `stripDiacritics`
// (so an owner's alert text stays GSM-7). Each is right where it is and wrong
// on a screen, where "Teléfono" must not render as "Telefono".
const SCREEN_ROOTS = ["../../app", "../../components"].map((p) => path.join(here, p));
const STRIPPERS = /consent\/keywords|consent\/phrases|\bstripDiacritics\b/;

function screenFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) screenFiles(full, out);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

export function strippingImports(files: { name: string; source: string }[]): string[] {
  return files.filter((f) => STRIPPERS.test(f.source)).map((f) => f.name);
}

describe("G7: no screen file reaches an accent-stripping helper", () => {
  it("flags a file that imports consent/keywords, consent/phrases or stripDiacritics (mutation: drop stripDiacritics from STRIPPERS → FAILS)", () => {
    expect(strippingImports([
      { name: "a.tsx", source: `import { normalizeKeyword } from "@/lib/consent/keywords";` },
      { name: "b.tsx", source: `import { matchPhrase } from "@/lib/consent/phrases";` },
      { name: "c.tsx", source: `import { stripDiacritics } from "@/lib/sms/alerts";` },
      { name: "d.tsx", source: `import { t } from "@/lib/i18n/t";` },
    ])).toEqual(["a.tsx", "b.tsx", "c.tsx"]);
  });

  it("holds for every file under src/app and src/components (mutation: import stripDiacritics in components/stat-tile.tsx → FAILS naming it)", () => {
    const files = SCREEN_ROOTS.flatMap((root) => screenFiles(root)).map((f) => ({ name: f, source: readFileSync(f, "utf8") }));
    expect(files.length).toBeGreaterThan(500);
    const bad = strippingImports(files);
    expect(bad, `these screen files reach an accent stripper: ${bad.join(", ")}`).toEqual([]);
  }, 30_000);
});
