import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  countFromOutcomes, ANSWERED_OUTCOMES, LEAD_OUTCOME, ABANDONED_OUTCOME, listLeadInstantsBetween, weeklyMetrics,
  listAnsweredCallStartsBetween, listAbandonedCallStartsBetween,
  type WeeklyWindow,
} from "./weekly-metrics";

// `listLeadInstantsBetween`, `listAnsweredCallStartsBetween` and
// `weeklyMetrics` (below) are the only exports
// here that touch @bis/db — every test above exercises pure functions and
// never calls either, so stubbing these reads leaves them untouched.
const dbMocks = vi.hoisted(() => ({
  listSubmissionCreationsBetween: vi.fn(),
  listCallStartsByOutcomeBetween: vi.fn(),
  listBookingCreationsBetween: vi.fn(),
  listTrafficDays: vi.fn(),
}));
vi.mock("@bis/db", () => ({
  listSubmissionCreationsBetween: (...a: unknown[]) => dbMocks.listSubmissionCreationsBetween(...a),
  listCallStartsByOutcomeBetween: (...a: unknown[]) => dbMocks.listCallStartsByOutcomeBetween(...a),
  listBookingCreationsBetween: (...a: unknown[]) => dbMocks.listBookingCreationsBetween(...a),
  listTrafficDays: (...a: unknown[]) => dbMocks.listTrafficDays(...a),
}));

/**
 * These two constants ARE the definitions the client's email reports, so they
 * are pinned rather than left to be read off an implementation. `CallOutcome`
 * is `booked | lead | message | abandoned | spam | transferred` (0037 added
 * the sixth, and `ANSWERED_OUTCOMES` counts it — the caller reached a person,
 * so the phone was answered).
 */
describe("what counts as an answered call", () => {
  it("counts booked, lead and message — never spam, never abandoned", () => {
    expect(countFromOutcomes(
      ["booked", "lead", "message", "abandoned", "spam"], ANSWERED_OUTCOMES)).toBe(3);
  });

  it("counts spam as nothing at all, so it cannot flatter the number", () => {
    expect(countFromOutcomes(["spam", "spam", "spam"], ANSWERED_OUTCOMES)).toBe(0);
  });

  it("counts an abandoned call as nothing — nobody handled it", () => {
    expect(countFromOutcomes(["abandoned", "abandoned"], ANSWERED_OUTCOMES)).toBe(0);
  });
});

describe("what counts as a lead from a call", () => {
  it("counts only the lead outcome", () => {
    expect(countFromOutcomes(["booked", "lead", "lead", "message", "spam"], LEAD_OUTCOME)).toBe(2);
  });

  // Both tallies come from ONE read of the same array, so this pins that they
  // are different questions: a booked call was answered but is not a lead.
  it("is a different question from answered — a booking is not a lead", () => {
    const week = ["booked", "booked", "message"];
    expect(countFromOutcomes(week, ANSWERED_OUTCOMES)).toBe(3);
    expect(countFromOutcomes(week, LEAD_OUTCOME)).toBe(0);
  });
});

/**
 * 0037 adds a sixth outcome, and this constant is one of the two places in
 * the product where a call outcome becomes a NUMBER a client reads. Getting
 * it wrong here does not throw — it just under-reports the week.
 */
describe("a transferred call is an answered call", () => {
  it("counts transferred alongside booked, lead and message", () => {
    // The honest reading: the caller reached a person. Whatever else is true
    // of that call, the phone was answered, and a client whose week contained
    // four such calls must not be told it contained none.
    expect(countFromOutcomes(
      ["booked", "lead", "message", "transferred", "abandoned", "spam"], ANSWERED_OUTCOMES)).toBe(4);
    expect(countFromOutcomes(["transferred", "transferred"], ANSWERED_OUTCOMES)).toBe(2);
  });

  it("is still not a lead — reaching a person captures no contact details", () => {
    // Same distinction the booked/lead pair already draws: the two tallies
    // come from ONE read of the same array and answer different questions.
    expect(countFromOutcomes(["transferred", "transferred"], LEAD_OUTCOME)).toBe(0);
  });
});

/**
 * F-076 (now slice): the dashboard's CRM-only hero reuses this definition of
 * "leads captured" (submissions + `LEAD_OUTCOME` calls) rather than
 * re-deriving its own — the owner's explicit instruction after the first
 * version of this fix used "every new contact" instead.
 */
describe("listLeadInstantsBetween — the raw instants behind weeklyMetrics().leads", () => {
  beforeEach(() => {
    dbMocks.listSubmissionCreationsBetween.mockReset();
    dbMocks.listCallStartsByOutcomeBetween.mockReset();
  });

  it("merges real-submission and lead-outcome-call instants into one array (mutation: return only one half -> FAILS)", async () => {
    dbMocks.listSubmissionCreationsBetween.mockResolvedValue(["2027-01-01T00:00:00.000Z"]);
    dbMocks.listCallStartsByOutcomeBetween.mockResolvedValue(["2027-01-02T00:00:00.000Z", "2027-01-03T00:00:00.000Z"]);

    const result = await listLeadInstantsBetween(
      {} as never, "acct_1", "2027-01-01T00:00:00.000Z", "2027-02-01T00:00:00.000Z",
    );

    expect(result.sort()).toEqual([
      "2027-01-01T00:00:00.000Z", "2027-01-02T00:00:00.000Z", "2027-01-03T00:00:00.000Z",
    ]);
  });

  it("passes the SAME LEAD_OUTCOME constant weeklyMetrics() uses, not a second hard-coded array (mutation: pass ANSWERED_OUTCOMES instead -> FAILS)", async () => {
    dbMocks.listSubmissionCreationsBetween.mockResolvedValue([]);
    dbMocks.listCallStartsByOutcomeBetween.mockResolvedValue([]);

    await listLeadInstantsBetween({} as never, "acct_1", "2027-01-01T00:00:00.000Z", "2027-02-01T00:00:00.000Z");

    expect(dbMocks.listCallStartsByOutcomeBetween).toHaveBeenCalledWith(
      expect.anything(), "acct_1", LEAD_OUTCOME, "2027-01-01T00:00:00.000Z", "2027-02-01T00:00:00.000Z",
      expect.anything(),
    );
  });

  it("scopes both reads to the account and window given", async () => {
    dbMocks.listSubmissionCreationsBetween.mockResolvedValue([]);
    dbMocks.listCallStartsByOutcomeBetween.mockResolvedValue([]);

    await listLeadInstantsBetween({} as never, "acct_specific", "from-iso", "to-iso");

    expect(dbMocks.listSubmissionCreationsBetween).toHaveBeenCalledWith(
      expect.anything(), "acct_specific", "from-iso", "to-iso",
    );
  });
});

/**
 * The agency's own test handsets (`PHONE_SPAM_EXEMPT_CALLERS`, read through
 * `agencyHandsets()`) are not customers: on 2026-10-06 they were 13 of the BIS
 * account's 16 non-spam calls. Both call-backed reads leave them out, and
 * read the list from the environment themselves, so no caller can forget to.
 */
describe("the agency's own test calls are not client activity", () => {
  beforeEach(() => {
    dbMocks.listSubmissionCreationsBetween.mockReset().mockResolvedValue([]);
    dbMocks.listCallStartsByOutcomeBetween.mockReset().mockResolvedValue([]);
    vi.stubEnv("PHONE_SPAM_EXEMPT_CALLERS", "+19565550101, +19565550102");
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("calls answered reads ANSWERED_OUTCOMES and leaves the handsets out (mutation: drop excludeCallers -> FAILS)", async () => {
    await listAnsweredCallStartsBetween({} as never, "acct_1", "from-iso", "to-iso");
    expect(dbMocks.listCallStartsByOutcomeBetween).toHaveBeenCalledWith(
      expect.anything(), "acct_1", ANSWERED_OUTCOMES, "from-iso", "to-iso",
      { excludeCallers: ["+19565550101", "+19565550102"] },
    );
  });

  it("the call half of leads leaves them out too", async () => {
    await listLeadInstantsBetween({} as never, "acct_1", "from-iso", "to-iso");
    expect(dbMocks.listCallStartsByOutcomeBetween).toHaveBeenCalledWith(
      expect.anything(), "acct_1", LEAD_OUTCOME, "from-iso", "to-iso",
      { excludeCallers: ["+19565550101", "+19565550102"] },
    );
  });

  // #182 follow-up to #182: the calls chart card's "screened" state reads
  // `listAbandonedCallStartsBetween` for its fallback "N caller(s) hung up"
  // line — the agency's own test handset hanging up on itself must not
  // count as a customer walking away, same convention as "calls answered"
  // and "leads" above (mutation: drop `excludeCallers` from the call ->
  // FAILS, since the call would then carry no 3rd argument at all).
  it("the abandoned-calls read behind the calls chart's fallback line leaves them out too", async () => {
    await listAbandonedCallStartsBetween({} as never, "acct_1", "from-iso", "to-iso");
    expect(dbMocks.listCallStartsByOutcomeBetween).toHaveBeenCalledWith(
      expect.anything(), "acct_1", ABANDONED_OUTCOME, "from-iso", "to-iso",
      { excludeCallers: ["+19565550101", "+19565550102"] },
    );
  });

  it("a junk entry is dropped, never spliced into the query; unset excludes nothing", async () => {
    vi.stubEnv("PHONE_SPAM_EXEMPT_CALLERS", "+19565550101,9565550102,+1956),x");
    await listAnsweredCallStartsBetween({} as never, "acct_1", "from-iso", "to-iso");
    expect(dbMocks.listCallStartsByOutcomeBetween).toHaveBeenLastCalledWith(
      expect.anything(), "acct_1", ANSWERED_OUTCOMES, "from-iso", "to-iso",
      { excludeCallers: ["+19565550101"] },
    );

    vi.stubEnv("PHONE_SPAM_EXEMPT_CALLERS", "");
    await listAnsweredCallStartsBetween({} as never, "acct_1", "from-iso", "to-iso");
    expect(dbMocks.listCallStartsByOutcomeBetween).toHaveBeenLastCalledWith(
      expect.anything(), "acct_1", ANSWERED_OUTCOMES, "from-iso", "to-iso",
      { excludeCallers: [] },
    );
  });
});

/**
 * Review correction: the first version of this fix made `weeklyMetrics()`
 * and the dashboard AGREE on "leads captured" only by convention — two
 * separate computations that happened to produce the same number today,
 * with nothing stopping them from drifting apart tomorrow. `weeklyMetrics`
 * now calls `listLeadInstantsBetween` directly for `leads`, so this is
 * SHARED BY CONSTRUCTION: these tests mock the exact same two primitives
 * `listLeadInstantsBetween`'s own suite above does, and prove
 * `weeklyMetrics().leads` is nothing but that function's result length —
 * not a value independently re-derived from the week's raw call outcomes
 * (the OLD shape). `calls` is now shared the same way, through
 * `listAnsweredCallStartsBetween`.
 */
describe("weeklyMetrics().leads is listLeadInstantsBetween's length (shared by construction)", () => {
  const WINDOW: WeeklyWindow = {
    fromIso: "2027-01-01T00:00:00.000Z", toIso: "2027-01-08T00:00:00.000Z",
    fromDay: "2027-01-01", toDay: "2027-01-07",
  };

  // `weeklyMetrics` reads `listCallStartsByOutcomeBetween` twice — once for
  // LEAD_OUTCOME (leads), once for ANSWERED_OUTCOMES (calls) — so the mock
  // answers by the outcome set it was asked for.
  function callReads(r: { lead: string[]; answered: string[] }) {
    dbMocks.listCallStartsByOutcomeBetween.mockImplementation(
      async (_db: unknown, _acct: unknown, outcomes: readonly string[]) =>
        outcomes === LEAD_OUTCOME ? r.lead : outcomes === ANSWERED_OUTCOMES ? r.answered : [],
    );
  }

  beforeEach(() => {
    dbMocks.listSubmissionCreationsBetween.mockReset();
    dbMocks.listCallStartsByOutcomeBetween.mockReset();
    dbMocks.listBookingCreationsBetween.mockReset().mockResolvedValue([]);
    dbMocks.listTrafficDays.mockReset();
  });

  it("leads = submissions + lead-outcome calls, read through listLeadInstantsBetween — never re-derived from the answered calls (mutation: leads counts the ANSWERED_OUTCOMES read -> FAILS, because that read below returns five)", async () => {
    dbMocks.listSubmissionCreationsBetween.mockResolvedValue(["s1", "s2"]);
    callReads({ lead: ["c1"], answered: ["a1", "a2", "a3", "a4", "a5"] });

    const result = await weeklyMetrics({} as never, "acct_1", WINDOW, false);

    expect(result.leads).toBe(3);
  });

  it("a different split of the SAME two reads changes weeklyMetrics().leads by exactly that much — proving it tracks listLeadInstantsBetween's length, not a fixed or cached number", async () => {
    dbMocks.listSubmissionCreationsBetween.mockResolvedValue([]);
    callReads({ lead: ["c1", "c2", "c3", "c4"], answered: [] });

    const result = await weeklyMetrics({} as never, "acct_1", WINDOW, false);

    expect(result.leads).toBe(4);
  });

  it("calls is listAnsweredCallStartsBetween's length — the read the dashboard and topbar share (mutation: count every call row again -> FAILS)", async () => {
    dbMocks.listSubmissionCreationsBetween.mockResolvedValue([]);
    callReads({ lead: [], answered: ["a1", "a2", "a3"] });

    const [report, direct] = await Promise.all([
      weeklyMetrics({} as never, "acct_1", WINDOW, false),
      listAnsweredCallStartsBetween({} as never, "acct_1", WINDOW.fromIso, WINDOW.toIso),
    ]);

    expect(report.calls).toBe(direct.length);
    expect(report.calls).toBe(3);
    expect(report.leads).toBe(0);
  });

  it("a mutation in EITHER half of listLeadInstantsBetween changes weeklyMetrics().leads too — the two are not two tests of two parallel implementations", async () => {
    // Half A only.
    dbMocks.listSubmissionCreationsBetween.mockResolvedValue(["s1"]);
    callReads({ lead: [], answered: [] });
    const [reportA, directA] = await Promise.all([
      weeklyMetrics({} as never, "acct_1", WINDOW, false),
      listLeadInstantsBetween({} as never, "acct_1", WINDOW.fromIso, WINDOW.toIso),
    ]);
    expect(reportA.leads).toBe(directA.length);
    expect(reportA.leads).toBe(1);

    // Half B only — a different count, so a mutation that drops either
    // half from `listLeadInstantsBetween` would move BOTH numbers here,
    // not just one.
    dbMocks.listSubmissionCreationsBetween.mockResolvedValue([]);
    callReads({ lead: ["c1", "c2"], answered: [] });
    const [reportB, directB] = await Promise.all([
      weeklyMetrics({} as never, "acct_1", WINDOW, false),
      listLeadInstantsBetween({} as never, "acct_1", WINDOW.fromIso, WINDOW.toIso),
    ]);
    expect(reportB.leads).toBe(directB.length);
    expect(reportB.leads).toBe(2);
  });
});
