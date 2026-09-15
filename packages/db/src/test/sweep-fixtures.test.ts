import { describe, it, expect } from "vitest";
import { isAbandonedFixture, ABANDONED_AFTER_MS, type SweepCandidate } from "./sweep-fixtures";

/**
 * This predicate decides what gets deleted from the Supabase project that also
 * serves production, so it is worth testing on its own rather than only
 * through the sweep that calls it. It is pure for exactly that reason — these
 * cases run with no credentials and no network.
 *
 * The cases below are the ones that actually occurred or could: a genuine
 * leak, a fixture belonging to a run that is still going, and the three
 * near-misses that must never be swept.
 */
const NOW = Date.parse("2026-09-15T20:00:00Z");
const minutesAgo = (n: number) => new Date(NOW - n * 60_000).toISOString();

const fixture = (over: Partial<SweepCandidate> = {}): SweepCandidate => ({
  id: "00000000-0000-0000-0000-000000000001",
  name: "Fixture Co",
  clerk_org_id: "org_test_jcoa711w",
  created_at: minutesAgo(120),
  ...over,
});

describe("isAbandonedFixture", () => {
  it("sweeps a fixture an earlier run left behind", () => {
    // The real case: three of these were left in the database when a merge
    // cancelled main's CI mid-suite, and sat there for two hours.
    expect(isAbandonedFixture(fixture(), NOW)).toBe(true);
  });

  /**
   * The dangerous direction. While this was being written there were two live
   * `Fixture Co` accounts belonging to a run that was still going; sweeping
   * either would have failed someone else's CI with rows vanishing underneath
   * it — a failure that would look like anything except its real cause.
   */
  it("leaves a fixture belonging to a run that is still going", () => {
    expect(isAbandonedFixture(fixture({ created_at: minutesAgo(2) }), NOW)).toBe(false);
    expect(isAbandonedFixture(fixture({ created_at: minutesAgo(34) }), NOW)).toBe(false);
  });

  it("holds the line exactly at the threshold", () => {
    const at = new Date(NOW - ABANDONED_AFTER_MS).toISOString();
    const justPast = new Date(NOW - ABANDONED_AFTER_MS - 1000).toISOString();
    expect(isAbandonedFixture(fixture({ created_at: at }), NOW)).toBe(false);
    expect(isAbandonedFixture(fixture({ created_at: justPast }), NOW)).toBe(true);
  });

  /**
   * The name alone is not enough. A real business could legitimately be called
   * Fixture Co, and its clerk org id comes from Clerk rather than from
   * `withTestAccount`'s generator — so the `org_test_` prefix is what actually
   * proves the row is ours to delete.
   */
  it("never sweeps a real account, whatever it is called", () => {
    expect(isAbandonedFixture(fixture({ clerk_org_id: "org_2abcDEFghiJKL" }), NOW)).toBe(false);
    expect(isAbandonedFixture(fixture({ clerk_org_id: null }), NOW)).toBe(false);
    expect(isAbandonedFixture(fixture({ name: "Test Client One" }), NOW)).toBe(false);
    expect(isAbandonedFixture(fixture({ name: "Bespoke Intelligent Solutions" }), NOW)).toBe(false);
    // Near-misses on the prefix. The trailing underscore in `org_test_` is
    // load-bearing: without it "org_testimonials_inc" would match, and a real
    // company's account would be in scope for deletion.
    expect(isAbandonedFixture(fixture({ clerk_org_id: "org_testimonials_inc" }), NOW)).toBe(false);
    expect(isAbandonedFixture(fixture({ clerk_org_id: "ORG_TEST_upper" }), NOW)).toBe(false);
  });

  it("refuses to act on a timestamp it cannot read", () => {
    // An unparseable date must not resolve to NaN comparisons and sweep by
    // accident; the safe answer to "how old is this?" is "leave it alone".
    expect(isAbandonedFixture(fixture({ created_at: "not a date" }), NOW)).toBe(false);
    expect(isAbandonedFixture(fixture({ created_at: "" }), NOW)).toBe(false);
  });
});
