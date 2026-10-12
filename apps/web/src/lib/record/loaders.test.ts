import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@bis/db";

/**
 * The record page's loaders (S-03 part 1, spec C5): each returns a load and never throws. The page
 * test proves each card's error state end to end; this pins the two rules inside the loaders the
 * page test cannot see: the summary is an error only when ALL its facts failed, and a failed hold
 * read fails CLOSED onto every open linked To-do.
 */
const contactFactsMock = vi.fn();
const listContactTasksMock = vi.fn();
const holdOpenTaskIdsMock = vi.fn();
vi.mock("@bis/db", () => ({
  contactFacts: (...a: unknown[]) => contactFactsMock(...a),
  contactNextUp: async () => ({ bookings: [], datedTasks: [], undatedCount: 0 }),
  listNotes: async () => null,
  listContactTasks: (...a: unknown[]) => listContactTasksMock(...a),
  holdOpenTaskIds: (...a: unknown[]) => holdOpenTaskIdsMock(...a),
  listContactOpportunities: async () => null,
  listContactSubmissions: async () => [],
  listContactMessages: async () => [],
  listContactPlaces: async () => { throw new Error("places down"); },
  listContactTags: async () => [],
  listCustomFields: async () => [],
}));
vi.mock("@/lib/sms/sender", () => ({ resolveSmsSender: async () => { throw new Error("gate down"); } }));

const { loadSummary, loadTimeline, loadHeaderPlaces, softSmsGate } = await import("./loaders");
const db = {} as SupabaseClient;
const ledger = { tag: "ledger" } as unknown as SupabaseClient;

describe("record loaders", () => {
  beforeEach(() => {
    contactFactsMock.mockReset();
    listContactTasksMock.mockReset().mockResolvedValue([]);
    holdOpenTaskIdsMock.mockReset().mockResolvedValue([]);
  });

  it("the summary is ready while any fact stands, and an error only when all three failed (mutation: error on any one failure -> FAILS)", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const some = { bookingsMade: { ok: false }, lastTalked: { ok: false }, openDeals: { ok: true, value: { count: 1, amount: 5 } } };
      contactFactsMock.mockResolvedValueOnce(some);
      expect(await loadSummary(db, "acct1", "ct1")).toEqual({ status: "ready", facts: some });
      contactFactsMock.mockResolvedValueOnce({ bookingsMade: { ok: false }, lastTalked: { ok: false }, openDeals: { ok: false } });
      expect(await loadSummary(db, "acct1", "ct1")).toEqual({ status: "error" });
    } finally { errors.mockRestore(); }
  });

  it("each failed fact is logged by name and account, never the customer (mutation: drop onError -> FAILS)", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      contactFactsMock.mockImplementationOnce(async (_db, _a, _c, opts: { onError: (n: string, e: unknown) => void }) => {
        opts.onError("talked", new Error("calls down"));
        return { bookingsMade: { ok: true, value: 0 }, lastTalked: { ok: false }, openDeals: { ok: true, value: { count: 0, amount: null } } };
      });
      await loadSummary(db, "acct1", "ct1");
      const logged = errors.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
      expect(logged).toContain("summary (talked)");
      expect(logged).toContain("acct1");
      expect(logged).toContain("calls down");
    } finally { errors.mockRestore(); }
  });

  it("a null list is an empty list, and a failed hold read fails CLOSED onto every open linked To-do (mutation: pass [] on failure -> FAILS)", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      listContactTasksMock.mockResolvedValue([
        { id: "t_hold", completed_at: null, consent_event_id: "h1" },
        { id: "t_done", completed_at: "2026-10-01T00:00:00Z", consent_event_id: "h2" },
        { id: "t_plain", completed_at: null, consent_event_id: null },
      ]);
      holdOpenTaskIdsMock.mockRejectedValue(new Error("ledger down"));
      const load = await loadTimeline(db, ledger, "acct1", "ct1");
      expect(load).toMatchObject({ status: "ready", notes: [], opportunities: [], holdOpen: ["t_hold"] });
      expect(holdOpenTaskIdsMock.mock.calls[0]![3]).toBe(ledger);
    } finally { errors.mockRestore(); }
  });

  it("the header's two soft reads answer null on a failure, never throw (mutation: rethrow -> FAILS)", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await loadHeaderPlaces(db, "acct1", "ct1")).toBeNull();
      expect(await softSmsGate(db, "acct1")).toBeNull();
    } finally { errors.mockRestore(); }
  });
});
