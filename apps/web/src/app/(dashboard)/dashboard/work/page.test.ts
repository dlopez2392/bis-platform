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
}));

function row(overrides: Partial<AgencyWorkRow> = {}): AgencyWorkRow {
  return {
    id: "task:1", source: "task", accountId: "acct-a", contactId: null,
    title: "Call back", dueAt: null, occurredAt: "2026-09-01T00:00:00Z",
    brandName: "Rio Roofing", timezone: "America/Chicago",
    ...overrides,
  };
}

describe("AgencyWorkPage", () => {
  beforeEach(() => {
    requireAgencyMock.mockReset().mockImplementation(async () => ({ userId: "user_1" }));
    listAgencyWorkMock.mockReset().mockResolvedValue([]);
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
});
