import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Source-text pin, the house pattern for the styleguide page (a server
 * component this repo has no render harness for). DESIGN.md's definition of
 * done: a new component or variant appears on /styleguide. The two Settings
 * skeletons are new variants of existing cards.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, "page.tsx"), "utf8");

describe("styleguide: the streamed Settings cards' loading states", () => {
  it("mounts both skeletons (mutation: drop either → FAILS)", () => {
    expect(src).toMatch(/<ClientAccessSkeleton\s*\/>/);
    expect(src).toMatch(/<LinkSiteSkeleton\b[^>]*\/>/);
  });
});
