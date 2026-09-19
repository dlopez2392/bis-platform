import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgencyWorkRow, CallProposal } from "@bis/db";
import { m } from "@/lib/messages";

// This is the first screen whose whole purpose is to span every account
// (task-6-brief.md), and the boundary — requireAgency() on the very first
// line, before any read — is the point of it. The mock below is a plain
// vi.fn() rather than a fixed resolved value, specifically so the first
// test can make it REJECT and prove nothing downstream runs.
const requireAgencyMock = vi.fn(async () => ({ userId: "user_1" }));
vi.mock("@/lib/auth", () => ({
  requireAgency: () => requireAgencyMock(),
}));

const listAgencyWorkMock = vi.fn(async (): Promise<AgencyWorkRow[]> => []);
// The banner's own read — defaults to 0 (no banner) so every pre-existing
// case below is unaffected by its addition. Real signature read from
// packages/db/src/screened-calls.ts: `(db, sinceIso) => Promise<number>`.
const countLinesTurningCallersAwayMock = vi.fn<
  (db: unknown, sinceIso: string) => Promise<number>
>(async () => 0);
// Work Queue Task 10's own read — defaults to [] (no suggestions section)
// so every pre-existing case below is unaffected by its addition. Real
// signature read from packages/db/src/call-proposals.ts.
const listPendingProposalsForAgencyMock = vi.fn(
  async (): Promise<(CallProposal & { brandName: string })[]> => [],
);
// Two distinct batch reads share this fake db: the contacts lookup
// (page.tsx's pre-existing second query) and, since this task's fix-wave
// (Important 1), the `pipeline_stages` lookup that resolves an
// opportunity_stage proposal's fromStageId/toStageId to real names — same
// minimal `.select().in()` chain shape tasks/page.test.ts's own
// dbForRequest mock uses, with no `.eq()` at all: this read is deliberately
// cross-tenant (pipeline_stages.id is a globally unique uuid PK, and the ids
// came from an already-cross-tenant service-role read the same way the
// contacts ids did). Routed by table name so a test can set each one's own
// resolved value independently.
const contactsInMock = vi.fn<
  (...args: unknown[]) => Promise<{ data: unknown[] | null; error: unknown }>
>(async () => ({ data: [], error: null }));
const pipelineStagesInMock = vi.fn<
  (...args: unknown[]) => Promise<{ data: unknown[] | null; error: unknown }>
>(async () => ({ data: [], error: null }));
const FAKE_DB = {
  from: (table: string) => {
    if (table === "pipeline_stages") {
      return { select: () => ({ in: (...args: unknown[]) => pipelineStagesInMock(...args) }) };
    }
    return { select: () => ({ in: (...args: unknown[]) => contactsInMock(...args) }) };
  },
};
vi.mock("@bis/db", () => ({
  serviceDb: () => FAKE_DB,
  listAgencyWork: () => listAgencyWorkMock(),
  countLinesTurningCallersAway: (db: unknown, sinceIso: string) =>
    countLinesTurningCallersAwayMock(db, sinceIso),
  listPendingProposalsForAgency: () => listPendingProposalsForAgencyMock(),
}));

function row(overrides: Partial<AgencyWorkRow> = {}): AgencyWorkRow {
  return {
    id: "task:1", source: "task", accountId: "acct-a", contactId: null,
    title: "Call back", dueAt: null, occurredAt: "2026-09-01T00:00:00Z",
    brandName: "Rio Roofing", timezone: "America/Chicago", suppressed: false,
    ...overrides,
  };
}

function proposal(overrides: Partial<CallProposal & { brandName: string }> = {}): CallProposal & { brandName: string } {
  return {
    id: "prop-1", accountId: "acct-a", callId: "call-1", contactId: null,
    kind: "task", payload: { title: "Call back", dueAt: null },
    evidence: "the caller asked for a callback", status: "pending",
    decidedAt: null, decidedBy: null, createdAt: "2026-09-01T00:00:00Z",
    brandName: "Rio Roofing",
    ...overrides,
  } as CallProposal & { brandName: string };
}

describe("AgencyWorkPage", () => {
  beforeEach(() => {
    requireAgencyMock.mockReset().mockImplementation(async () => ({ userId: "user_1" }));
    listAgencyWorkMock.mockReset().mockResolvedValue([]);
    countLinesTurningCallersAwayMock.mockReset().mockResolvedValue(0);
    listPendingProposalsForAgencyMock.mockReset().mockResolvedValue([]);
    contactsInMock.mockReset().mockResolvedValue({ data: [], error: null });
    pipelineStagesInMock.mockReset().mockResolvedValue({ data: [], error: null });
  });

  // Fix-wave Important 2 (task-11-brief): this page issues THREE serviceDb
  // reads, not one — `listAgencyWork`, `listPendingProposalsForAgency` (every
  // account's pending proposals, `evidence` and all — a verbatim quote from a
  // caller on someone else's line) and the `pipeline_stages` lookup. The
  // original version of this test named only `listAgencyWork`, so hoisting
  // the proposals read above `await requireAgency()` (preserving its own
  // `.catch` and concurrency) left this test, and all 45 of its neighbours,
  // green — PROVED live, see this task's own report.
  it("guards before any read — a rejected agency check never reaches listAgencyWork, listPendingProposalsForAgency or the pipeline_stages read", async () => {
    requireAgencyMock.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    const { default: AgencyWorkPage } = await import("./page");
    await expect(AgencyWorkPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(listAgencyWorkMock).not.toHaveBeenCalled();
    expect(listPendingProposalsForAgencyMock).not.toHaveBeenCalled();
    expect(pipelineStagesInMock).not.toHaveBeenCalled();
  });

  it("renders the chosen heading once the agency check passes", async () => {
    const { default: AgencyWorkPage } = await import("./page");
    const html = renderToStaticMarkup(await AgencyWorkPage());
    expect(html).toMatch(new RegExp(`<h1[^>]*>${m["work.agency.title"]}</h1>`));
  });

  it("never falls back to UTC for one account's invalid zone, while another account's own overdue task still resolves in ITS zone", async () => {
    // acct-bad's zone cannot resolve a day boundary at all — its row must
    // still render (Waiting, no date), not take the page down and not
    // borrow acct-good's zone or the server's.
    listAgencyWorkMock.mockResolvedValueOnce([
      row({ id: "task:bad", accountId: "acct-bad", timezone: "Not/AZone", dueAt: "2026-09-01T00:00:00Z" }),
      row({ id: "task:overdue", accountId: "acct-good", timezone: "America/Chicago", dueAt: "2026-09-01T00:00:00Z" }),
    ]);
    const { default: AgencyWorkPage } = await import("./page");
    const html = renderToStaticMarkup(await AgencyWorkPage());
    expect(html).toContain(m["work.bucket.waiting"]);
    expect(html).toContain(m["work.bucket.overdue"]);
  });

  it("renders the sold-empty-state sentence when every account's queue is empty", async () => {
    const { default: AgencyWorkPage } = await import("./page");
    const html = renderToStaticMarkup(await AgencyWorkPage());
    expect(html).toContain(m["work.empty"]);
    expect(html).toContain(m["work.agency.empty.body"]);
  });

  it("renders no line-down banner on the good day, when the count is zero", async () => {
    const { default: AgencyWorkPage } = await import("./page");
    const html = renderToStaticMarkup(await AgencyWorkPage());
    expect(html).not.toContain(m["work.linesDown.action"]);
  });

  it("renders the line-down banner when a number is turning callers away, and reads the window off the real clock", async () => {
    countLinesTurningCallersAwayMock.mockResolvedValueOnce(2);
    const before = Date.now();
    const { default: AgencyWorkPage } = await import("./page");
    const html = renderToStaticMarkup(await AgencyWorkPage());
    const after = Date.now();

    expect(html).toContain(m["work.linesDown.many"].replace("{n}", "2"));
    expect(html).toContain(m["work.linesDown.action"]);

    // A 24-hour-old `sinceIso`, computed from the clock this call actually
    // ran on — not a fixed literal that would drift true the day this test
    // was written and false every day after.
    expect(countLinesTurningCallersAwayMock).toHaveBeenCalledTimes(1);
    const sinceIso = countLinesTurningCallersAwayMock.mock.calls[0]![1] as string;
    const sinceMs = new Date(sinceIso).getTime();
    expect(sinceMs).toBeGreaterThanOrEqual(before - 24 * 60 * 60 * 1000 - 1000);
    expect(sinceMs).toBeLessThanOrEqual(after - 24 * 60 * 60 * 1000 + 1000);
  });

  it("runs the lines-down read CONCURRENTLY with listAgencyWork, not chained after it (mutation: await listAgencyWork before starting the lines-down read -> FAILS)", async () => {
    // Each mock's own promise resolves only once the OTHER has already been
    // invoked. A serial `await listAgencyWork(db)` then
    // `await countLinesTurningCallersAway(db, since)` would deadlock this
    // test (neither mock's condition would ever come true) and the test
    // would time out rather than pass — which is the point: a passing run
    // is only possible when both reads are in flight at once.
    let listCalled = false;
    let countCalled = false;
    listAgencyWorkMock.mockReset().mockImplementation(async () => {
      listCalled = true;
      while (!countCalled) await new Promise((r) => setTimeout(r, 1));
      return [];
    });
    countLinesTurningCallersAwayMock.mockReset().mockImplementation(async () => {
      countCalled = true;
      while (!listCalled) await new Promise((r) => setTimeout(r, 1));
      return 0;
    });

    const { default: AgencyWorkPage } = await import("./page");
    await expect(AgencyWorkPage()).resolves.toBeTruthy();
  }, 2000);

  it("swallows a failed lines-down read and still renders the whole queue (mutation: let the rejection propagate instead of catching it -> FAILS)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    listAgencyWorkMock.mockResolvedValueOnce([row()]);
    countLinesTurningCallersAwayMock.mockRejectedValueOnce(new Error("permission denied for table screened_calls"));

    const { default: AgencyWorkPage } = await import("./page");
    const html = renderToStaticMarkup(await AgencyWorkPage());

    // The queue itself is still there…
    expect(html).toContain("Call back");
    // …only the banner is missing…
    expect(html).not.toContain(m["work.linesDown.action"]);
    // …and the swallow left a trace, the way calls/page.tsx's own read does.
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("lines-down read failed"));
    spy.mockRestore();
  });

  // Work Queue Task 10 — pending suggestions, rendered beside the real
  // queue, never inside it.
  it("renders pending proposals in their own suggestions section", async () => {
    listPendingProposalsForAgencyMock.mockResolvedValueOnce([proposal()]);
    const { default: AgencyWorkPage } = await import("./page");
    const html = renderToStaticMarkup(await AgencyWorkPage());
    expect(html).toContain(m["proposals.work.heading"]);
  });

  it("renders no suggestions section when there are no pending proposals", async () => {
    const { default: AgencyWorkPage } = await import("./page");
    const html = renderToStaticMarkup(await AgencyWorkPage());
    expect(html).not.toContain(m["proposals.work.heading"]);
  });

  // THE PROOF THE WIRING ITSELF NEVER CONTAMINATES bucketAgencyWork's INPUT
  // — the exact integration point named in the task-10 brief. Real work
  // ("Call back") is bucketed alongside a genuinely distinct proposal; the
  // proposal's own content must render, but never inside the bucket section
  // it sits beside.
  //
  // Fix-wave (task-10-brief.md, Important 2): the prior version only
  // grepped the waiting section for the proposal's own
  // `payload.title`/`evidence` strings, which a bare `CallProposal` folded
  // into `buckets.waiting` never carries into `primaryLabel` (`row.source`
  // is `undefined` there, so it falls through to the generic
  // `m["work.booking"]` label) — a real phantom row could ship with every
  // assertion below still green. Asserting the section's own `<li>` COUNT
  // instead is invariant to how a fold is shaped.
  it("keeps the waiting section's own <li> count exactly at the real bucketed rows, even with a distinct proposal rendered alongside it (mutation: concat proposal-derived rows into `rows` before bucketing -> FAILS)", async () => {
    listAgencyWorkMock.mockResolvedValueOnce([row({ id: "task:1", title: "Call back" })]);
    listPendingProposalsForAgencyMock.mockResolvedValueOnce([proposal({
      id: "prop-unique", payload: { title: "UNIQUE_TASK_TITLE_5678", dueAt: null },
      evidence: "UNIQUE_CALLER_QUOTE_1234",
    })]);
    const { default: AgencyWorkPage } = await import("./page");
    const html = renderToStaticMarkup(await AgencyWorkPage());

    const waitingSection = html.match(/<section data-bucket="waiting"[\s\S]*?<\/section>/)?.[0] ?? "";
    expect((waitingSection.match(/<li[ >]/g) ?? []).length).toBe(1);
    // Proves the count assertion above tests separation, not that nothing
    // rendered at all — the proposal's own content IS on the page, in its
    // own section.
    expect(html).toContain("UNIQUE_TASK_TITLE_5678");
    expect(html).toContain("UNIQUE_CALLER_QUOTE_1234");
  });

  it("degrades to no suggestions section, not a broken page, when the proposals read fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    listAgencyWorkMock.mockResolvedValueOnce([row()]);
    listPendingProposalsForAgencyMock.mockRejectedValueOnce(new Error("permission denied for table call_proposals"));

    const { default: AgencyWorkPage } = await import("./page");
    const html = renderToStaticMarkup(await AgencyWorkPage());

    // The queue itself is still there…
    expect(html).toContain("Call back");
    // …only the suggestions section is missing…
    expect(html).not.toContain(m["proposals.work.heading"]);
    // …and the swallow left a trace.
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("proposals read failed"));
    spy.mockRestore();
  });

  it("runs the proposals read CONCURRENTLY with listAgencyWork, not chained after it (mutation: await listAgencyWork before starting the proposals read -> FAILS)", async () => {
    let listCalled = false;
    let proposalsCalled = false;
    listAgencyWorkMock.mockReset().mockImplementation(async () => {
      listCalled = true;
      while (!proposalsCalled) await new Promise((r) => setTimeout(r, 1));
      return [];
    });
    listPendingProposalsForAgencyMock.mockReset().mockImplementation(async () => {
      proposalsCalled = true;
      while (!listCalled) await new Promise((r) => setTimeout(r, 1));
      return [];
    });

    const { default: AgencyWorkPage } = await import("./page");
    await expect(AgencyWorkPage()).resolves.toBeTruthy();
  }, 2000);

  // Fix-wave (task-10-brief.md, Important 1) — proved against the REAL
  // page, not just the list component: page.tsx's own batched
  // `pipeline_stages` read is what resolves an opportunity_stage proposal's
  // fromStageId/toStageId to real names. Before this fix, this exact
  // scenario (empty buckets, one pending opportunity_stage proposal with
  // real evidence) rendered `m["work.empty"]` — "Nothing needs you right
  // now." — with the proposal nowhere on the page.
  it("never claims the queue is clear when a pending opportunity_stage proposal exists, and resolves its stage names via ONE batched pipeline_stages read", async () => {
    listPendingProposalsForAgencyMock.mockResolvedValueOnce([proposal({
      kind: "opportunity_stage",
      payload: { opportunityId: "opp_1", fromStageId: "stage_1", toStageId: "stage_2" },
      evidence: "move this to booked now",
    })]);
    pipelineStagesInMock.mockResolvedValueOnce({
      data: [
        { id: "stage_1", name: "New", position: 0 },
        { id: "stage_2", name: "Booked", position: 3 },
      ],
      error: null,
    });
    const { default: AgencyWorkPage } = await import("./page");
    const html = renderToStaticMarkup(await AgencyWorkPage());

    expect(html).not.toContain(m["work.empty"]);
    expect(html).toContain(m["proposals.work.heading"]);
    expect(html).toContain(
      m["proposals.stage.label"].replace("{from}", () => "New").replace("{to}", () => "Booked"),
    );
    expect(html).toContain("move this to booked now");
    // ONE batched read — not one per proposal, not one per account.
    expect(pipelineStagesInMock).toHaveBeenCalledTimes(1);
    expect(pipelineStagesInMock).toHaveBeenCalledWith("id", ["stage_1", "stage_2"]);
  });

  it("renders an honest summary that names no stage, but still shows the row, when the pipeline_stages read fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    listPendingProposalsForAgencyMock.mockResolvedValueOnce([proposal({
      kind: "opportunity_stage",
      payload: { opportunityId: "opp_1", fromStageId: "stage_1", toStageId: "stage_2" },
      evidence: "move this to booked now",
    })]);
    pipelineStagesInMock.mockResolvedValueOnce({
      data: null, error: { message: "permission denied for table pipeline_stages" },
    });
    const { default: AgencyWorkPage } = await import("./page");
    const html = renderToStaticMarkup(await AgencyWorkPage());

    expect(html).not.toContain(m["work.empty"]);
    expect(html).toContain(m["proposals.work.heading"]);
    expect(html).toContain(m["proposals.stage.unresolved"]);
    expect(html).not.toContain("stage_1");
    expect(html).not.toContain("stage_2");
    spy.mockRestore();
  });
});
