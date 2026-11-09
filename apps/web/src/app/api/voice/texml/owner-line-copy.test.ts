// F-032 Task 7 review M-2: the owner line's spoken words travel in a small module so the answer route never loads
// the whole catalogue (562 KB) on Telnyx's answer deadline. The catalogue stays the reviewed source: these tests pin
// the small module to it, key for key and byte for byte, so the i18n gates that read messages.ts still cover it.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { m } from "@/lib/messages";
import { OWNER_LINE_SAY } from "./owner-line-copy";

describe("the owner line's spoken words are the catalogue's (M-2)", () => {
  const catalogue = Object.entries(m).filter(([k]) => k.startsWith("ownerLine.say."));

  it("carries exactly the catalogue's ownerLine.say.* keys, each with its Spanish twin", () => {
    expect(Object.keys(OWNER_LINE_SAY).sort()).toEqual(catalogue.map(([k]) => k).sort());
    const bases = Object.keys(OWNER_LINE_SAY).filter((k) => !k.endsWith(".es"));
    expect(bases.length).toBe(7);
    for (const k of bases) expect(Object.keys(OWNER_LINE_SAY)).toContain(`${k}.es`);
  });

  it("every value is byte-identical to the catalogue's", () => {
    for (const [k, v] of catalogue) expect(OWNER_LINE_SAY[k as keyof typeof OWNER_LINE_SAY]).toBe(v);
  });

  it("no source file under app/api/voice/texml imports the whole catalogue (mutation: import @/lib/messages in owner-line-xml.ts -> FAILS)", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) files.push(p);
      }
    };
    walk(__dirname);
    expect(files.length).toBeGreaterThanOrEqual(8);
    const offenders = files.filter((f) => /from\s+["']@\/lib\/messages["']/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
