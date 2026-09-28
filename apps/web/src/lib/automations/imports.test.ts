import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * "Nothing new sends" made structural. A pass receives its providers on
 * `ctx`; it never imports a provider or a provider factory. The harness is
 * the ONLY module allowed to import the EMAIL factory; NO module here may
 * import the SMS factory or the Telnyx provider (consent chain PR-1: texts go
 * through `ctx.sms`, which is the send gate, and lib/consent/scans.test.ts
 * pins the gate as the only importer app-wide). Test files are exempt: they
 * mock those modules.
 *
 * Mutations: add `import { getSmsProvider } from "@/lib/sms"` to harness.ts
 * or to any pass file → FAILS; add the email factory to a pass file → FAILS.
 */
const ROOT = fileURLToPath(new URL(".", import.meta.url));
// Static `from "…"` and dynamic `import("…")` alike; `/index` spelled out
// or not; `.tsx` as well as `.ts`. Each rule names the files allowed past it.
const FORBIDDEN: readonly { rule: RegExp; allowed: readonly string[] }[] = [
  // The factories, by alias OR by relative path (`../../email` from passes/),
  // with or without `/index` and a `.js`/`.ts` suffix.
  { rule: /(?:from\s+|import\s*\(\s*)["'](?:@\/lib\/|(?:\.\.\/)+)email(?:\/index)?(?:\.[jt]s)?["']/, allowed: ["harness.ts"] },
  { rule: /(?:from\s+|import\s*\(\s*)["'](?:@\/lib\/|(?:\.\.\/)+)sms(?:\/index)?(?:\.[jt]s)?["']/, allowed: [] },
  { rule: /(?:from\s+|import\s*\(\s*)["'][^"']*\/resend["']/, allowed: ["harness.ts"] },   // the real email provider
  { rule: /(?:from\s+|import\s*\(\s*)["'][^"']*\/telnyx["']/, allowed: [] },              // the real sms provider
];

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
  it("only the harness imports the email factory, and NO module here imports the SMS factory or Telnyx", () => {
    const offenders: string[] = [];
    for (const file of walk(ROOT)) {
      const src = readFileSync(file, "utf-8");
      for (const { rule, allowed } of FORBIDDEN) {
        if (!allowed.includes(rel(file)) && rule.test(src)) offenders.push(`${rel(file)}: ${rule}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the scan actually reaches the pass files (guards the fixture)", () => {
    expect(walk(ROOT).map(rel)).toEqual(expect.arrayContaining(
      ["harness.ts", "context.ts", "registry.ts", "passes/reminders.ts", "passes/followups.ts",
       "passes/review-request.ts", "send-sms.ts", "passes/no-show-nudge.ts", "passes/sms-reminder.ts",
       "instant-reply.ts", "instant-reply-copy.ts", "passes/site-traffic.ts"],
    ));
  });
});
