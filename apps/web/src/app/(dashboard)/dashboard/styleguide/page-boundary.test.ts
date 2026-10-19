import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * The styleguide page is a SERVER component (force-dynamic). What it imports from a "use client" module
 * is, on the server, a client reference: rendering it as a JSX element works, but CALLING it throws
 * "Attempted to call ... from the server", and a non-component value is not the value at all. Item 8b-2's
 * final review I-1: the page called `buildWorkTrayColumns()` from work-tray-demo.tsx and crashed at render,
 * while the unit test, which renders without an RSC boundary, stayed green. This pins the rule statically
 * for every import of the page: a binding from a "use client" module is never CALLED there.
 * (The page's render through the real boundary is proven by CI's styleguide.spec.)
 */
const HERE = __dirname;
const SRC = resolve(HERE, "../../../..");
const PAGE = join(HERE, "page.tsx");

function resolveImport(spec: string): string | null {
  const base = spec.startsWith("@/") ? join(SRC, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(PAGE), spec) : null;
  if (!base) return null;
  for (const f of [`${base}.tsx`, `${base}.ts`, join(base, "index.tsx"), join(base, "index.ts")]) if (existsSync(f)) return f;
  return null;
}

const isClient = (file: string) => /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use client["']/.test(readFileSync(file, "utf8"));

/** Every value binding the page imports from a "use client" module, with the module it came from. */
function clientBindings(src: string): { name: string; from: string }[] {
  const out: { name: string; from: string }[] = [];
  for (const m of src.matchAll(/^import\s+(?!type\b)\{([^}]*)\}\s+from\s+"([^"]+)";/gm)) {
    const file = resolveImport(m[2]!);
    if (!file || !isClient(file)) continue;
    for (const raw of m[1]!.split(",")) {
      const part = raw.trim();
      if (!part || part.startsWith("type ")) continue;
      const local = part.split(/\s+as\s+/).pop()!.trim();
      out.push({ name: local, from: m[2]! });
    }
  }
  return out;
}

describe("styleguide/page.tsx: what it takes from a client module it only renders (final review I-1)", () => {
  const src = readFileSync(PAGE, "utf8");
  const body = src.replace(/^import[\s\S]*?;$/gm, "");

  it("finds the client modules it imports (positive control: the work tray's demo is one)", () => {
    expect(clientBindings(src).map((b) => b.from)).toContain("./work-tray-demo");
  });

  // Calls only: a call is what threw at render. (A non-component VALUE read from a client module is the same
  // class of fault; the page has one, NAV_LABEL_SPAN_CLASS, reported as a finding outside this fix.)
  it("no binding from a \"use client\" module is CALLED on the server (mutation: call buildWorkTrayColumns() in the page -> FAILS)", () => {
    const called: string[] = [];
    for (const { name, from } of clientBindings(src)) {
      if (new RegExp(`(^|[^\\w$.<])${name.replace(/\$/g, "\\$")}\\s*\\(`).test(body)) called.push(`${name} (from ${from})`);
    }
    expect(called).toEqual([]);
  });

  it("the work tray's demo is rendered with no props: its columns hold functions (tr, stand-in actions) a server page cannot pass (mutation: columns={...} -> FAILS)", () => {
    expect(body).toMatch(/<WorkTrayDemo\s*\/>/);
  });
});
