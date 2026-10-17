import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { initNeverLogState, syncNeverLogState } from "./never-log-sync";

const A = { id: "n1", pattern: "billing@supplier.com", kind: "address" as const };
const B = { id: "n2", pattern: "supplier.com", kind: "domain" as const };

/**
 * Review fix round 1, Important 1: NeverLogList's local list follows the server's `entries` prop
 * whenever the server sends a new value (a revalidation after any Save on the page, an add in
 * another tab), instead of reading it once at mount.
 */
describe("syncNeverLogState (the list follows the server's entries)", () => {
  it("failed → loaded: a failed first read, then a successful re-read, draws the entries, not a false empty (mutation: keep the first state → FAILS)", () => {
    const failed = initNeverLogState(null);
    expect(failed.list).toEqual([]);
    const next = syncNeverLogState(failed, [A, B]);
    expect(next.list).toEqual([A, B]);
    expect(next.seen).toEqual([A, B]);
  });

  it("loaded → changed: a new server list replaces what was drawn (mutation: keep the first state → FAILS)", () => {
    const loaded = initNeverLogState([A]);
    expect(syncNeverLogState(loaded, [B, A]).list).toEqual([B, A]);
  });

  it("loaded → failed: a later failed read records the null (the list draws its error state) and drops the stale rows", () => {
    const loaded = initNeverLogState([A]);
    const next = syncNeverLogState(loaded, null);
    expect(next.seen).toBeNull();
    expect(next.list).toEqual([]);
  });

  it("the same prop is the same state object, so the component does not set state in a loop (mutation: always return a new object → FAILS)", () => {
    const entries = [A];
    const s = { seen: entries, list: [A, B] }; // a local add the server has not re-sent yet
    expect(syncNeverLogState(s, entries)).toBe(s);
  });

  it("NeverLogList draws from the synced state, not a list read once at mount (mutation: revert to useState(entries ?? []) → FAILS)", () => {
    const src = readFileSync(path.join(__dirname, "never-log-list.tsx"), "utf8");
    expect(src).toMatch(/import \{[^}]*syncNeverLogState[^}]*\} from "\.\/never-log-sync";/);
    expect(src).toMatch(/syncNeverLogState\(state, entries\)/);
    expect(src).not.toMatch(/useState<NeverLogView\[\]>\(entries/);
  });
});
