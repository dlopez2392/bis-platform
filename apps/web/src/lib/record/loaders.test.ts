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
const listContactTimelinePageMock = vi.fn();
const listPeopleNamesMock = vi.fn();
const getVoiceProfileMock = vi.fn();
vi.mock("@bis/db", () => ({
  listContactTimelinePage: (...a: unknown[]) => listContactTimelinePageMock(...a),
  listPeopleNames: (...a: unknown[]) => listPeopleNamesMock(...a),
  getVoiceProfile: (...a: unknown[]) => getVoiceProfileMock(...a),
  TIMELINE_SOURCES: ["notes", "todos", "deals", "forms", "messages", "bookings", "calls"],
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
    listContactTimelinePageMock.mockReset().mockResolvedValue({ items: [], older: null, failed: [] });
    listPeopleNamesMock.mockReset().mockResolvedValue({});
    getVoiceProfileMock.mockReset().mockResolvedValue(null);
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

  it("each failed fact is logged by name and account, never the customer (mutation: drop onError -> FAILS; mutation: name the contact in the line -> FAILS)", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      contactFactsMock.mockImplementationOnce(async (_db, _a, _c, opts: { onError: (n: string, e: unknown) => void }) => {
        opts.onError("talked", new Error("calls down"));
        return { bookingsMade: { ok: true, value: 0 }, lastTalked: { ok: false }, openDeals: { ok: true, value: { count: 0, amount: null } } };
      });
      await loadSummary(db, "acct1", "cust-42");
      const logged = errors.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
      expect(logged).toContain("summary (talked)");
      expect(logged).toContain("acct1");
      expect(logged).toContain("calls down");
      // Spec §11: the account names the log line; the customer never does.
      expect(logged).not.toContain("cust-42");
    } finally { errors.mockRestore(); }
  });

  const taskEntry = (id: string, completed_at: string | null, consent_event_id: string | null) => ({
    kind: "task", id, at: "2026-10-01T00:00:00Z", task: { id, title: "x", due_at: null, completed_at, created_at: "2026-10-01T00:00:00Z",
      consent_event_id, call_id: null, assigned_to: null, created_by: null } });

  it("a failed hold read fails CLOSED onto every open linked To-do on the page, on the ledger client (mutation: pass [] on failure -> FAILS)", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      listContactTimelinePageMock.mockResolvedValue({ items: [taskEntry("t_hold", null, "h1"), taskEntry("t_done", "2026-10-01T00:00:00Z", "h2"), taskEntry("t_plain", null, null)], older: null, failed: [] });
      holdOpenTaskIdsMock.mockRejectedValue(new Error("ledger down"));
      const load = await loadTimeline(db, ledger, "acct1", "ct1");
      expect(load).toMatchObject({ status: "ready", holdOpen: ["t_hold"] });
      expect(holdOpenTaskIdsMock.mock.calls[0]![3]).toBe(ledger);
    } finally { errors.mockRestore(); }
  });

  it("some sources failing is still ready; all seven failing is the card's error (spec §9.4; mutation: error on any failure -> FAILS)", async () => {
    listContactTimelinePageMock.mockResolvedValue({ items: [], older: null, failed: ["calls"] });
    expect(await loadTimeline(db, ledger, "acct1", "ct1")).toMatchObject({ status: "ready", page: { failed: ["calls"] } });
    listContactTimelinePageMock.mockResolvedValue({ items: [], older: null, failed: ["notes", "todos", "deals", "forms", "messages", "bookings", "calls"] });
    expect(await loadTimeline(db, ledger, "acct1", "ct1")).toEqual({ status: "error" });
  });

  it("the cursor reaches the page read, and the names read asks for exactly the page's person ids (mutation: drop `before` -> FAILS)", async () => {
    const before = { v: "2026-10-09T16:12:00Z", id: "0f8a7b2c-1d2e-4f3a-8b4c-5d6e7f8a9b0c" };
    listContactTimelinePageMock.mockResolvedValue({ items: [
      { kind: "note", id: "n1", at: "2026-10-01T00:00:00Z", note: { id: "n1", body: "x", author_id: "user_dan", created_at: "2026-10-01T00:00:00Z" } },
    ], older: null, failed: [] });
    await loadTimeline(db, ledger, "acct1", "ct1", before);
    expect(listContactTimelinePageMock.mock.calls[0]!.slice(0, 4)).toEqual([db, "acct1", "ct1", before]);
    expect(listPeopleNamesMock).toHaveBeenCalledWith(db, ["user_dan"]);
  });

  it("names and the persona failing cost nothing but the names (spec §11: never an error; mutation: rethrow -> FAILS)", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      listPeopleNamesMock.mockRejectedValue(new Error("users down"));
      getVoiceProfileMock.mockRejectedValue(new Error("profile down"));
      expect(await loadTimeline(db, ledger, "acct1", "ct1")).toMatchObject({ status: "ready", names: {}, personaName: null });
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
