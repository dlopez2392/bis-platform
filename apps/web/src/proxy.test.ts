import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

describe("proxy.ts — the unsubscribe surfaces stay public (spec §4.3, E2)", () => {
  it("only /dashboard is protected, so /u/… and /api/unsubscribe/… need no sign-in (mutation: protect \"/u(.*)\" or \"/api(.*)\" → an unsubscribe demands a login, FAILS)", () => {
    const src = readFileSync(fileURLToPath(new URL("./proxy.ts", import.meta.url)), "utf8");
    expect(src.match(/createRouteMatcher\((\[[^\]]*\])\)/)?.[1]).toBe('["/dashboard(.*)"]');
  });
});
