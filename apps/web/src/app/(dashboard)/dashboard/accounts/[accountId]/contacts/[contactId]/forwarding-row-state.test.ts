import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { forwardingShown } from "./forwarding-row-state";

const SERVER = "r-0123456789abcdef01234567@reply.bis-rgv.com";
const MADE = "r-fedcba9876543210fedcba98@reply.bis-rgv.com";

/**
 * Fix round 2, Important 3: the row used to SEED its address from the first view and never look at
 * the prop again. A row that mounted as "get" and was then refreshed to "address" (the Owner emailed
 * from the composer, the email gate made the token, then any router.refresh() in Details) showed the
 * red error line. What the row shows is now derived on every render from the server's view and the
 * address a click made, here, as a pure function.
 */
describe("forwardingShown: the server's view, filled in by a click only where the server offered Get", () => {
  it("mounted as get, then the server sends address: the server's address shows, never the error (the review's case; mutation: seed once from the first view -> FAILS)", () => {
    expect(forwardingShown({ kind: "address", address: SERVER }, null)).toEqual({ kind: "address", address: SERVER });
  });

  it("get, then a click made one: the click's address shows (mutation: ignore made -> FAILS)", () => {
    expect(forwardingShown({ kind: "get" }, MADE)).toEqual({ kind: "address", address: MADE });
  });

  it("get and nothing made yet: the Get button", () => {
    expect(forwardingShown({ kind: "get" }, null)).toEqual({ kind: "get" });
  });

  it("the server's address outranks an older click's (a rotated token is the server's to say; mutation: made ?? view -> FAILS)", () => {
    expect(forwardingShown({ kind: "address", address: SERVER }, MADE)).toEqual({ kind: "address", address: SERVER });
  });

  it("after a click, a server that no longer offers one wins: Replies turned off, or the read failed (mutation: let made outrank every kind -> FAILS)", () => {
    expect(forwardingShown({ kind: "turnOn" }, MADE)).toEqual({ kind: "turnOn" });
    expect(forwardingShown({ kind: "none" }, MADE)).toEqual({ kind: "none" });
    expect(forwardingShown({ kind: "failed" }, MADE)).toEqual({ kind: "failed" });
  });

  it("the row renders from this helper's answer, keeps only the click's address in state, and never seeds state from the view (mutation: useState(view.kind === \"address\" …) -> FAILS)", () => {
    const row = readFileSync(path.resolve(__dirname, "./forwarding-address-row.tsx"), "utf8");
    expect(row).toMatch(/import\s*\{[^}]*\bforwardingShown\b[^}]*\}\s*from\s*"\.\/forwarding-row-state"/);
    expect(row).toMatch(/const shown = forwardingShown\(view, made\);/);
    expect(row).not.toMatch(/useState[^;]*view\./);
    expect(row).toMatch(/data-forwarding-row=\{shown\.kind\}/);
    // Every branch reads the derived value, never the raw prop.
    expect(row.slice(row.indexOf("return ("))).not.toMatch(/\bview\.(kind|address)\b/);
    const helper = readFileSync(path.resolve(__dirname, "./forwarding-row-state.ts"), "utf8");
    expect(helper).not.toMatch(/^\s*["']use (client|server)["']/m);
  });
});
