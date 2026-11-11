import { describe, it, expect } from "vitest";
import config from "../next.config";

describe("next.config.ts: a shared file's page (S-07 3b, spec 4.2; plan deviation 7)", () => {
  it("/s/:token is never indexed and never sends its address on; nothing else gains a header (mutations: drop either header; source '/s/:path*' -> FAILS)", async () => {
    expect(await config.headers!()).toEqual([
      { source: "/s/:token", headers: [{ key: "Referrer-Policy", value: "no-referrer" }, { key: "X-Robots-Tag", value: "noindex" }] },
    ]);
  });
});

describe("next.config.ts: next dev writes no agent files into the repo", () => {
  it("agentRules is false, so next dev never creates apps/web/AGENTS.md or CLAUDE.md (mutation: drop the line → FAILS)", () => {
    expect(config.agentRules).toBe(false);
  });
});
