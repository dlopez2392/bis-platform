import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgencyWorkRow } from "@bis/db";
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
// The contacts batch read (page.tsx's own second query, for the
// contactNames map) — same minimal chain shape tasks/page.test.ts's own
// dbForRequest mock uses, scoped to `.in()` since that is the only method
// this page's contacts lookup calls.
const FAKE_DB = {
  from: () => ({
    select: () => ({
      in: async () => ({ data: [], error: null }),
    }),
  }),
};
vi.mock("@bis/db", () => ({
  serviceDb: () => FAKE_DB,
  listAgencyWork: () => listAgencyWorkMock(),
  countLinesTurningCallersAway: (db: unknown, sinceIso: string) =>
    countLinesTurningCallersAwayMock(db, sinceIso),
}));

function row(overrides: Partial<AgencyWorkRow> = {}): AgencyWorkRow {
  return {
    id: "task:1", source: "task", accountId: "acct-a", contactId: null,
    title: "Call back", dueAt: null, occurredAt: "2026-09-01T00:00:00Z",
    brandName: "Rio Roofing", timezone: "America/Chicago", suppressed: false,
    ...overrides,
  };
}

describe("AgencyWorkPage", () => {
  beforeEach(() => {
    requireAgencyMock.mockReset().mockImplementation(async () => ({ userId: "user_1" }));
    listAgencyWorkMock.mockReset().mockResolvedValue([]);
    countLinesTurningCallersAwayMock.mockReset().mockResolvedValue(0);
  });

  it("guards before any read — a rejected agency check never reaches listAgencyWork", async () => {
    requireAgencyMock.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    const { default: AgencyWorkPage } = await import("./page");
    await expect(AgencyWorkPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(listAgencyWorkMock).not.toHaveBeenCalled();
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
});
