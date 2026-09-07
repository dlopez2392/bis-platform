import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * "Nothing new sends" made structural. A pass receives its providers on
 * `ctx`; it never imports a provider or a provider factory. The harness is
 * the ONLY module allowed to, and the production guard (VERCEL_ENV AND
 * NODE_ENV, in the two factories) is therefore the only thing any automation
 * send ever goes through. Test files are exempt: they mock those modules.
 *
 * Mutation: add `import { getSmsProvider } from "@/lib/sms"` to any pass file.
 */
const ROOT = fileURLToPath(new URL(".", import.meta.url));
// Static `from "…"` and dynamic `import("…")` alike; `/index` spelled out
// or not; `.tsx` as well as `.ts`.
const FORBIDDEN: readonly RegExp[] = [
  // The factories, by alias OR by relative path (`../../email` from passes/),
  // with or without `/index` and a `.js`/`.ts` suffix.
  /(?:from\s+|import\s*\(\s*)["'](?:@\/lib\/|(?:\.\.\/)+)email(?:\/index)?(?:\.[jt]s)?["']/,
  /(?:from\s+|import\s*\(\s*)["'](?:@\/lib\/|(?:\.\.\/)+)sms(?:\/index)?(?:\.[jt]s)?["']/,
  /(?:from\s+|import\s*\(\s*)["'][^"']*\/resend["']/,              // the real email provider
  /(?:from\s+|import\s*\(\s*)["'][^"']*\/telnyx["']/,              // the real sms provider
];
const ALLOWED = new Set(["harness.ts"]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    const isSource = full.endsWith(".ts") || full.endsWith(".tsx");
    const isTest = full.endsWith(".test.ts") || full.endsWith(".test.tsx");
    return isSource && !isTest ? [full] : [];
  });
}
const rel = (file: string) => file.slice(ROOT.length).replace(/\\/g, "/");

describe("automations — providers come from ctx, never from imports", () => {
  it("no module under lib/automations except the harness imports a provider or a factory", () => {
    const offenders: string[] = [];
    for (const file of walk(ROOT)) {
      if (ALLOWED.has(rel(file))) continue;
      const src = readFileSync(file, "utf-8");
      for (const rule of FORBIDDEN) if (rule.test(src)) offenders.push(`${rel(file)}: ${rule}`);
    }
    expect(offenders).toEqual([]);
  });

  it("the scan actually reaches the pass files (guards the fixture)", () => {
    expect(walk(ROOT).map(rel)).toEqual(expect.arrayContaining(
      ["harness.ts", "context.ts", "registry.ts", "passes/reminders.ts", "passes/followups.ts",
       "passes/review-request.ts", "send-sms.ts"],
    ));
  });
});
