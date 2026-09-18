import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * What the agency row read returns. Mutable rather than re-mocked per test —
 * `lib/zone.ts` wraps the read in React's `cache()`, so the module is
 * re-imported fresh in each test below to get a clean cache.
 */
let agencyResult: { data: unknown; error: { message: string } | null } = {
  data: { timezone: "America/Chicago" }, error: null,
};
let selectCalls = 0;
let thrown: Error | null = null;

vi.mock("@bis/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@bis/db")>();
  return {
    ...actual, // `resolveZone` stays REAL — the chain is what is under test.
    serviceDb: () => ({
      from: () => ({
        select: () => {
          selectCalls++;
          if (thrown) throw thrown;
          return {
            limit: () => ({ maybeSingle: async () => agencyResult }),
          };
        },
      }),
    }),
  };
});

/** Fresh module per test, so `cache()` starts empty each time. */
async function freshRenderZone() {
  vi.resetModules();
  return (await import("./zone")).renderZone;
}

beforeEach(() => {
  agencyResult = { data: { timezone: "America/Chicago" }, error: null };
  selectCalls = 0;
  thrown = null;
  vi.restoreAllMocks();
});

/**
 * `renderZone` is the ONE place five screens now get their zone from, and the
 * one place that decides how the agency's zone is read.
 *
 * WHY serviceDb AT ALL, and why it is tested here rather than assumed:
 * `agencies` carries exactly one RLS policy, `app.is_agency()`. Read through
 * the request-scoped client, the agency step of the chain would be invisible
 * to every CLIENT-role reader — so the same call would show one day to the
 * agency and another to the client. These tests pin that the agency step is
 * reached unconditionally, which is the whole reason for the exception.
 */
describe("renderZone — the account's own zone always wins", () => {
  it("uses the account's zone and does not call it a guess (mutation: return the agency's zone first -> FAILS)", async () => {
    const renderZone = await freshRenderZone();
    agencyResult = { data: { timezone: "Asia/Tokyo" }, error: null };
    const r = await renderZone("America/New_York");
    expect(r).toEqual({
      zone: "America/New_York", guessed: false,
      label: "America/New_York", source: "account",
    });
  });

  it("an account genuinely set to UTC is NOT a guess (mutation: key `guessed` on `zone === 'UTC'` -> FAILS)", async () => {
    const renderZone = await freshRenderZone();
    const r = await renderZone("UTC");
    expect(r.guessed).toBe(false);
    expect(r.source).toBe("account");
  });
});

describe("renderZone — the agency step, which a client could not read for itself", () => {
  it("falls to the agency's zone and marks it a guess (mutation: skip the agency and go straight to UTC -> FAILS)", async () => {
    const renderZone = await freshRenderZone();
    agencyResult = { data: { timezone: "America/Chicago" }, error: null };
    const r = await renderZone("Not/AZone");
    expect(r).toEqual({
      zone: "America/Chicago", guessed: true,
      label: "America/Chicago", source: "agency",
    });
  });

  /**
   * NOT ASSERTED HERE, DELIBERATELY: that `cache()` collapses repeat reads
   * within one request.
   *
   * React's `cache()` memoizes per REQUEST SCOPE, and a bare vitest call has
   * none — three calls really do make three reads under this harness, and
   * one read under Next.js. An assertion either way would be measuring the
   * test environment rather than the code, and a test that passes for a
   * reason unrelated to its own name is the shape this repo keeps finding
   * and deleting. The `cache()` wrapper earns its place on the account
   * dashboard, which resolves the zone twice per render; it is left to the
   * type system and to review, not pinned by a test that cannot fail on its
   * claim.
   *
   * What IS asserted below is the thing that actually costs something and IS
   * observable: that the agency is not consulted at all on the common path.
   */
  it("does not touch the agency row when the account's own zone is usable (mutation: drop the short-circuit in renderZone -> selectCalls becomes 1 -> FAILS)", async () => {
    // The naive spelling — `resolveZone(accountZone, await readAgencyZone())`
    // — evaluates the agency read as an ARGUMENT, so it ran on every render
    // of all five screens and then discarded the result for every account
    // the platform has. Caught by this test's own sibling below before it
    // ever shipped.
    const renderZone = await freshRenderZone();
    await renderZone("America/Chicago");
    await renderZone("America/New_York");
    expect(selectCalls).toBe(0);
  });

  it("treats an agency row with a BROKEN zone as no answer, not as an answer (mutation: trust agencies.timezone unchecked -> RangeError reaches the render -> FAILS)", async () => {
    // `agencies.timezone` is the same ungated free-text column
    // `accounts.timezone` was, and was never gated at all — #89 only shut the
    // account door.
    const renderZone = await freshRenderZone();
    agencyResult = { data: { timezone: "Also/Broken" }, error: null };
    const r = await renderZone("Not/AZone");
    expect(r).toEqual({
      zone: "UTC", guessed: true, label: "UTC", source: "fallback",
    });
    // Proves the result is usable rather than merely shaped right: this is
    // the construction that would throw on a zone `Intl` rejects.
    expect(() => new Intl.DateTimeFormat("en-US", { timeZone: r.zone })).not.toThrow();
  });
});

/**
 * TOTAL BY CONSTRUCTION. This runs inside a page render, where an exception
 * blanks a dashboard — a strictly worse outcome than a labelled wrong date.
 */
describe("renderZone — never throws into a render", () => {
  it("survives the agency read erroring and still answers (mutation: rethrow instead of logging -> FAILS)", async () => {
    const renderZone = await freshRenderZone();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    agencyResult = { data: null, error: { message: "permission denied" } };
    const r = await renderZone("Not/AZone");
    expect(r.zone).toBe("UTC");
    expect(r.source).toBe("fallback");
    expect(err).toHaveBeenCalled();
  });

  it("survives the client itself throwing (mutation: drop the try/catch -> FAILS)", async () => {
    const renderZone = await freshRenderZone();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    thrown = new Error("network down");
    const r = await renderZone("Not/AZone");
    expect(r.zone).toBe("UTC");
    expect(err).toHaveBeenCalled();
  });

  it("an erroring agency read does NOT disturb a well-configured account (mutation: return UTC whenever the agency read fails -> FAILS)", async () => {
    // The account's own zone is reached before the agency is ever consulted,
    // so a broken agency read must cost a correctly-configured account
    // nothing at all.
    const renderZone = await freshRenderZone();
    thrown = new Error("network down");
    const r = await renderZone("America/Chicago");
    expect(r).toEqual({
      zone: "America/Chicago", guessed: false,
      label: "America/Chicago", source: "account",
    });
    // …and it never even asked.
    expect(selectCalls).toBe(0);
  });

  it("a missing agency row reads as no answer (mutation: treat a null row as a usable zone -> FAILS)", async () => {
    const renderZone = await freshRenderZone();
    agencyResult = { data: null, error: null };
    const r = await renderZone("Not/AZone");
    expect(r.source).toBe("fallback");
  });
});
