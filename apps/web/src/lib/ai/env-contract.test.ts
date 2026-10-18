import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Spec 6: two optional names, documented; the fake never configured for a Vercel deployment; Playwright's app uses it. */
const ROOT = join(__dirname, "../../../../..");   // apps/web/src/lib/ai -> the repo root
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("the AI gateway's env contract (spec 6)", () => {
  it(".env.example names AI_PROVIDER and AI_GATEWAY_OFF, each under its own comment (mutation: drop either line -> FAILS)", () => {
    const lines = read(".env.example").split(/\r?\n/);
    for (const name of ["AI_PROVIDER", "AI_GATEWAY_OFF"]) {
      const at = lines.findIndex((l) => l === `${name}=`);
      expect([name, at > 0]).toEqual([name, true]);
      expect([name, lines[at - 1]!.startsWith("#")]).toEqual([name, true]);
    }
  });

  it("apps/web's Vercel config and Next config never set AI_PROVIDER (spec 6; the Root Directory is apps/web, so these two are the deployment's; mutation: add it to apps/web/vercel.json -> FAILS)", () => {
    for (const p of ["apps/web/vercel.json", "apps/web/next.config.ts"]) expect([p, read(p).includes("AI_PROVIDER")]).toEqual([p, false]);
  });

  it("Playwright's app runs on the fake, so no e2e run makes a real model call (spec 8.1; mutation: drop the line -> FAILS)", () => {
    expect(read("apps/web/playwright.config.ts")).toMatch(/^\s+AI_PROVIDER: "fake",$/m);
  });

  it("apps/web/vitest.config.ts pins AI_PROVIDER and AI_GATEWAY_OFF to the empty string in its env, so a developer's shell or .env.local cannot switch the unit suite to the fake or to off (item 8a-1 review; mutation: drop either name -> FAILS)", () => {
    const text = read("apps/web/vitest.config.ts");
    expect(text).toMatch(/AI_PROVIDER:\s*""/);
    expect(text).toMatch(/AI_GATEWAY_OFF:\s*""/);
  });
});
