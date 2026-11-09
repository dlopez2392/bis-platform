// apps/web/src/app/api/voice/texml/texml-no-static-db.test.ts
// F-032 plan Task 9 (I-8; SC-18; rewritten for review m-D). The unit tests mock `@/lib/owner-line/lockout`, so they
// cannot see HOW it is imported. This walks every source under app/api/voice/texml/ and everything it imports AT
// MODULE SCOPE, following resolved `@/` and relative paths transitively, and fails, printing each chain, when any walk
// reaches the bare `@bis/db`: a module-scope DB import from a TeXML route breaks `next build` during page-data
// collection (route.ts's lazy-import comment). `@bis/db/*` subpaths are pure modules and stay allowed.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TEXML = fileURLToPath(new URL(".", import.meta.url));
const SRC = resolve(TEXML, "../../../..");                 // apps/web/src
const FORBIDDEN = /^@bis\/db$/;                            // subpaths (@bis/db/phone, ...) are pure and allowed

/**
 * Every specifier a module imports or re-exports at MODULE SCOPE: `import x from`, a bare `import "x"`,
 * `export … from`, either quote, a trailing comment. Skipped: what the build erases (`import type`, `export type`, an
 * import whose every name is `type`; tsconfig.json sets no `verbatimModuleSyntax`) and the dynamic `await import(...)`
 * inside a handler, which is the allowed form. Block comments are stripped first; a `//` line never matches, because
 * every statement pattern is anchored at the start of a line.
 */
function staticSpecifiers(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: string[] = [];
  const stmt = /^[ \t]*(import|export)\s+(?!type\b)([^;'"]*?)\s*from\s*(['"])([^'"]+)\3|^[ \t]*import\s*(['"])([^'"]+)\5/gm;
  for (const m of code.matchAll(stmt)) {
    if (m[6] !== undefined) { out.push(m[6]); continue; }
    const braces = (m[2] ?? "").match(/^\{([\s\S]*)\}$/);
    if (braces && braces[1]!.split(",").map((s) => s.trim()).filter(Boolean).every((s) => /^type\s/.test(s))) continue;
    out.push(m[4]!);
  }
  return out;
}

function resolveLocal(spec: string, fromFile: string): string | null {
  const base = spec.startsWith("@/") ? join(SRC, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(fromFile), spec) : null;
  if (base === null) return null;
  for (const c of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx"), base]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

/** Every chain from `file` to a forbidden specifier, through resolved local imports (cycle-safe). */
function forbiddenChains(file: string, seen = new Set<string>(), chain: string[] = []): string[] {
  if (seen.has(file)) return [];
  seen.add(file);
  const here = [...chain, relative(SRC, file).replace(/\\/g, "/")];
  return staticSpecifiers(readFileSync(file, "utf8")).flatMap((spec) => {
    if (FORBIDDEN.test(spec)) return [[...here, spec].join(" -> ")];
    const next = resolveLocal(spec, file);
    return next ? forbiddenChains(next, seen, here) : [];
  });
}

const entries = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  if (statSync(p).isDirectory()) return entries(p);
  return /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
});

describe("no TeXML route reaches @bis/db at module scope (SC-18; reviews I-8 and m-D)", () => {
  it("recognises every module-scope form and skips only what the build erases (mutation: drop the bare-import branch -> FAILS)", () => {
    const one = (s: string) => staticSpecifiers(s);
    expect([
      one(`import "@bis/db";`), one(`export { serviceDb } from "@bis/db";`), one(`import { a } from '@bis/db';`),
      one(`import { a } from "@bis/db"; // the db`), one(`import {\n  a,\n  b,\n} from "@bis/db";`),
      one(`import { type A, b } from "@bis/db";`),
    ]).toEqual([["@bis/db"], ["@bis/db"], ["@bis/db"], ["@bis/db"], ["@bis/db"], ["@bis/db"]]);
    expect([
      one(`import type { A } from "@bis/db";`), one(`import { type A, type B } from "@bis/db";`),
      one(`export type { A } from "@bis/db";`), one(`const { a } = await import("@bis/db");`),
      one(`// import { a } from "@bis/db";\n/* import { b } from "@bis/db"; */`),
    ]).toEqual([[], [], [], [], []]);
  });

  it("walks transitively: the real lockout module reaches @bis/db through the email gate (positive control; mutation: stop following @/ imports -> FAILS)", () => {
    expect(forbiddenChains(join(SRC, "lib/owner-line/lockout.ts"))).toContain(
      "lib/owner-line/lockout.ts -> lib/consent/email-gate.ts -> @bis/db");
  });

  it("no source under app/api/voice/texml/ reaches @bis/db at module scope, directly or through anything it imports (mutation: import scheduleOwnerLineLockoutEmails statically in owner-pin/route.ts -> FAILS naming the chain)", () => {
    const files = entries(TEXML);
    expect(files.some((f) => f.endsWith(join("owner-pin", "route.ts")))).toBe(true);   // the walk sees owner-pin
    expect(files.flatMap((f) => forbiddenChains(f))).toEqual([]);
  });
});
