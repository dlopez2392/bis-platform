import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** Spec 3.1: the gateway is server-only. No "use client" file may import lib/ai (it reads OPENAI_API_KEY and
 *  holds the provider). A scan, because the repo has no `server-only` package in use (spec 3.1). */
const SRC = join(__dirname, "../..");   // apps/web/src
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "node_modules" ? [] : files(p);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}
/** A VALUE import from lib/ai (an `import type` is erased at build and reaches no browser; the AI card imports its view TYPE). */
const AI_VALUE_IMPORT = /import\s+(?!type\b)[^;'"]*?\s*from\s+["'](?:@\/lib\/ai\/|(?:\.{1,2}\/)+(?:[^"']*\/)?ai\/)[^"']*["']/;
function importsAiValue(src: string): boolean {
  return /^\s*["']use client["']/.test(src) && AI_VALUE_IMPORT.test(src);
}
function clientImportersOfAi(root: string): string[] {
  return files(root).filter((p) => importsAiValue(readFileSync(p, "utf8"))).map((p) => relative(root, p).split("\\").join("/"));
}

describe("lib/ai stays on the server (spec 3.1)", () => {
  it("no \"use client\" file imports a value from lib/ai (mutation: add `import { aiComplete } from \"@/lib/ai/gateway\";` under \"use client\" in settings/weekly-report-card.tsx -> FAILS naming it)", () => {
    expect(clientImportersOfAi(SRC)).toEqual([]);
  });
  it("the scan's own shapes: a value import counts, a multi-line one counts, a type import and a server file do not (mutation: drop (?!type\\b) -> FAILS)", () => {
    expect([
      importsAiValue(`"use client";\nimport { aiComplete } from "@/lib/ai/gateway";\n`),
      importsAiValue(`"use client";\nimport {\n  aiComplete,\n} from "../../lib/ai/gateway";\n`),
      importsAiValue(`"use client";\nimport type { AiCardView } from "@/lib/ai/settings-view";\n`),
      importsAiValue(`import { aiComplete } from "@/lib/ai/gateway";\n`),
    ]).toEqual([true, true, false, false]);
  });
});
