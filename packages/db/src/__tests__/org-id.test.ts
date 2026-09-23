import { describe, it, expect } from "vitest";
import { TEST_ORG_ID_PREFIX, isTestOrgId } from "../org-id";

/**
 * The prefix is the SOLE safety condition the fixture sweep keys on
 * (`src/test/sweep-fixtures.ts`), and production now refuses to mint an
 * account under it (`createClientAccount`). Both sides read this one
 * predicate, so this file is where its exact shape is pinned: a literal,
 * case-sensitive `startsWith`, and nothing cleverer.
 *
 * Pure — no credentials, no network.
 */
describe("isTestOrgId", () => {
  it("is true for an id this repo's fixtures mint", () => {
    expect(isTestOrgId("org_test_abc123")).toBe(true);
  });

  it("is false for a Clerk-shaped id", () => {
    // `org_` plus base58 — what a real organisation carries, and the id the
    // sweep must never match. This is the case that moves if the prefix is
    // ever widened to `org_`.
    expect(isTestOrgId("org_2abcDEFghiJKL")).toBe(false);
  });

  it("is case-sensitive", () => {
    expect(isTestOrgId("ORG_TEST_x")).toBe(false);
  });

  it("matches a prefix, not a substring", () => {
    expect(isTestOrgId("orgXtest_y")).toBe(false);
  });

  it("is false for an empty id", () => {
    expect(isTestOrgId("")).toBe(false);
  });

  it("is false for a null or undefined id", () => {
    // `SweepCandidate.clerk_org_id` is `string | null` under strict TS, and
    // the sweep's predicate calls this with the column straight off the row.
    expect(isTestOrgId(null)).toBe(false);
    expect(isTestOrgId(undefined)).toBe(false);
  });

  it("exports the literal prefix the fixtures and the LIKE query are written against", () => {
    expect(TEST_ORG_ID_PREFIX).toBe("org_test_");
  });
});
