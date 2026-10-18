import { describe, it, expect } from "vitest";
import config from "../next.config";

describe("next.config.ts: a shared file's page (S-07 3b, spec 4.2; plan deviation 7)", () => {
  it("/s/:token is never indexed and never sends its address on; nothing else gains a header (mutations: drop either header; source '/s/:path*' -> FAILS)", async () => {
    expect(await config.headers!()).toEqual([
      { source: "/s/:token", headers: [{ key: "Referrer-Policy", value: "no-referrer" }, { key: "X-Robots-Tag", value: "noindex" }] },
    ]);
  });
});
