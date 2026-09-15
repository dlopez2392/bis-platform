import { describe, it, expect, vi } from "vitest";
import { TEST_RUN_ID, fixtureName } from "./fixtures";

/**
 * `withTestAccount` gives every test a fresh ACCOUNT. It cannot give it a
 * fresh agency — there is exactly one `agencies` row and everything hangs off
 * it (verified on the live project: `select count(*) from agencies` = 1) —
 * so every unique key that does NOT include `account_id` is a namespace
 * shared by every run of this suite everywhere at once. Today that is
 * `blueprints_agency_id_name_key` (UNIQUE (agency_id, name)).
 *
 * A fixed literal in a test ("Starter") is therefore a global lock on that
 * name. Two suites running at the same time — two agents in one checkout, two
 * `verify` jobs on two branches, `pnpm check` twice — race on the same
 * blueprint row: one loses `captureBlueprint`'s check-then-insert and gets
 * `duplicate key value violates unique constraint
 * "blueprints_agency_id_name_key"`, and both see the other's version bumps on
 * the row they think is theirs.
 *
 * `fixtureName` is the fix: one token per test process, so each run owns its
 * own corner of that global namespace. These four assertions pin the whole
 * contract, because each half of it is load-bearing and they pull in opposite
 * directions — unique ACROSS runs, identical WITHIN one.
 */
describe("fixtureName — per-run names for agency-global unique keys", () => {
  it("never hands back the bare base name", () => {
    // The regression this is here to catch is someone putting the literal
    // back, so the bare string is the thing that must not be returned.
    expect(fixtureName("Starter")).not.toBe("Starter");
  });

  it("still contains the base, so a leaked row says what left it behind", () => {
    expect(fixtureName("Starter")).toContain("Starter");
  });

  it("is stable within one run, so two calls name the SAME blueprint", () => {
    // Not cosmetic: "recapturing the same name replaces the bundle and bumps
    // version" captures twice under one name and asserts it got one row back
    // at version 2. A name that changed per call would turn that test into two
    // unrelated blueprints and it would pass for the wrong reason.
    expect(fixtureName("Starter")).toBe(fixtureName("Starter"));
    expect(fixtureName("Determinism A")).not.toBe(fixtureName("Determinism B"));
  });

  it("gets a fresh token on every evaluation of the module", async () => {
    // What cross-run uniqueness REDUCES to: each test process evaluates this
    // module once, so "distinct per evaluation" is "distinct per process".
    // This assertion proves the token is generated, not a constant; it does
    // not by itself prove two OS processes differ. That half is proved
    // empirically, by running blueprints.test.ts twice concurrently — which
    // fails on the duplicate key without this helper and passes with it.
    vi.resetModules();
    const reloaded = await import("./fixtures");
    expect(reloaded.TEST_RUN_ID).not.toBe(TEST_RUN_ID);
    expect(reloaded.fixtureName("Starter")).not.toBe(fixtureName("Starter"));
  });
});
