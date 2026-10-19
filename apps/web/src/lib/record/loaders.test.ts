import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@bis/db";
import { rows as SG } from "@/components/proposals/suggestion-specimens";

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
const listPendingProposalsForContactMock = vi.fn();
vi.mock("@bis/db", () => ({
  listContactTimelinePage: (...a: unknown[]) => listContactTimelinePageMock(...a),
  listPeopleNames: (...a: unknown[]) => listPeopleNamesMock(...a),
  getVoiceProfile: (...a: unknown[]) => getVoiceProfileMock(...a),
  listPendingProposalsForContact: (...a: unknown[]) => listPendingProposalsForContactMock(...a),
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

const { loadSummary, loadTimeline, loadRecent, DRAWER_RECENT, loadHeaderPlaces, softSmsGate, loadWaitingSuggestions } = await import("./loaders");
const db = {} as SupabaseClient;
/** The sources a mocked page read (item 8b-2: every page names them). */
const SOURCES = ["notes", "todos", "deals", "forms", "messages", "bookings", "calls"];
const ledger = { tag: "ledger" } as unknown as SupabaseClient;

describe("record loaders", () => {
  beforeEach(() => {
    contactFactsMock.mockReset();
    listContactTasksMock.mockReset().mockResolvedValue([]);
    holdOpenTaskIdsMock.mockReset().mockResolvedValue([]);
    listContactTimelinePageMock.mockReset().mockResolvedValue({ items: [], older: null, failed: [], sources: SOURCES });
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
      listContactTimelinePageMock.mockResolvedValue({ items: [taskEntry("t_hold", null, "h1"), taskEntry("t_done", "2026-10-01T00:00:00Z", "h2"), taskEntry("t_plain", null, null)], older: null, failed: [], sources: SOURCES });
      holdOpenTaskIdsMock.mockRejectedValue(new Error("ledger down"));
      const load = await loadTimeline(db, ledger, "acct1", "ct1");
      expect(load).toMatchObject({ status: "ready", holdOpen: ["t_hold"] });
      expect(holdOpenTaskIdsMock.mock.calls[0]![3]).toBe(ledger);
    } finally { errors.mockRestore(); }
  });

  it("some sources failing is still ready; all seven failing is the card's error (spec §9.4; mutation: error on any failure -> FAILS)", async () => {
    const seven = ["notes", "todos", "deals", "forms", "messages", "bookings", "calls"];
    listContactTimelinePageMock.mockResolvedValue({ items: [], older: null, failed: ["calls"], sources: seven });
    expect(await loadTimeline(db, ledger, "acct1", "ct1")).toMatchObject({ status: "ready", page: { failed: ["calls"] } });
    listContactTimelinePageMock.mockResolvedValue({ items: [], older: null, failed: seven, sources: seven });
    expect(await loadTimeline(db, ledger, "acct1", "ct1")).toEqual({ status: "error" });
  });

  it("'every source failed' is counted against the sources the page READ, not every source there is (item 8b-2; mutation: compare to TIMELINE_SOURCES.length -> the seven-of-eight page is an error, FAILS)", async () => {
    const seven = ["notes", "todos", "deals", "forms", "messages", "bookings", "calls"];
    listContactTimelinePageMock.mockResolvedValue({ items: [], older: null, failed: seven, sources: [...seven, "suggestions"] });
    expect(await loadTimeline(db, ledger, "acct1", "ct1")).toMatchObject({ status: "ready", page: { failed: seven } });
    listContactTimelinePageMock.mockResolvedValueOnce({ items: [], older: null, failed: seven, sources: [...seven, "suggestions"] });
    expect(await loadRecent(db, "acct1", "ct1")).toMatchObject({ status: "ready", page: { failed: seven } });
  });

  it("the cursor reaches the page read, and the names read asks for exactly the page's person ids (mutation: drop `before` -> FAILS)", async () => {
    const before = { v: "2026-10-09T16:12:00Z", id: "0f8a7b2c-1d2e-4f3a-8b4c-5d6e7f8a9b0c" };
    listContactTimelinePageMock.mockResolvedValue({ items: [
      { kind: "note", id: "n1", at: "2026-10-01T00:00:00Z", note: { id: "n1", body: "x", author_id: "user_dan", created_at: "2026-10-01T00:00:00Z" } },
    ], older: null, failed: [], sources: SOURCES });
    await loadTimeline(db, ledger, "acct1", "ct1", before);
    expect(listContactTimelinePageMock.mock.calls[0]!.slice(0, 4)).toEqual([db, "acct1", "ct1", before]);
    expect(listPeopleNamesMock).toHaveBeenCalledWith(db, ["user_dan"]);
  });

  it("the persona read goes through the page's own db client, never the ledger (M2; mutation: call getVoiceProfile(ledger, accountId) -> FAILS)", async () => {
    await loadTimeline(db, ledger, "acct1", "ct1");
    expect(getVoiceProfileMock).toHaveBeenCalledWith(db, "acct1");
    expect(getVoiceProfileMock.mock.calls[0]![0]).not.toBe(ledger);
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

  it("the drawer's Recent reads the head of the merged timeline, five rows, no cursor (mutation: drop limit -> 30 rows, FAILS)", async () => {
    expect(DRAWER_RECENT).toBe(5);
    await loadRecent(db, "acct1", "ct1");
    expect(listContactTimelinePageMock).toHaveBeenCalledWith(db, "acct1", "ct1", undefined, expect.objectContaining({ limit: 5 }));
  });

  it("Recent reads no hold and no ledger: the drawer has no Done (mutation: build it on loadTimeline -> FAILS)", async () => {
    listContactTimelinePageMock.mockResolvedValueOnce({ items: [{ kind: "task", id: "t1", at: "2026-10-01T00:00:00Z", contactId: "ct1",
      task: { id: "t1", completed_at: null, consent_event_id: "ev1", call_id: null, created_by: null } }], older: null, failed: [], sources: SOURCES });
    expect((await loadRecent(db, "acct1", "ct1")).status).toBe("ready");
    expect(holdOpenTaskIdsMock).not.toHaveBeenCalled();
  });

  it("Recent is an error only when all seven sources failed; six failed is ready, naming them (mutation: error on any failure -> FAILS)", async () => {
    const all = ["notes", "todos", "deals", "forms", "messages", "bookings", "calls"];
    listContactTimelinePageMock.mockResolvedValueOnce({ items: [], older: null, failed: all, sources: all });
    expect(await loadRecent(db, "acct1", "ct1")).toEqual({ status: "error" });
    listContactTimelinePageMock.mockResolvedValueOnce({ items: [], older: null, failed: all.slice(1), sources: all });
    expect(await loadRecent(db, "acct1", "ct1")).toMatchObject({ status: "ready", page: { failed: all.slice(1) } });
  });

  it("Recent never throws: a rejected read is the error; names and persona are soft (mutation: let the read throw -> FAILS)", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      listContactTimelinePageMock.mockRejectedValueOnce(new Error("down"));
      expect(await loadRecent(db, "acct1", "ct1")).toEqual({ status: "error" });
      listPeopleNamesMock.mockRejectedValueOnce(new Error("names down"));
      getVoiceProfileMock.mockRejectedValueOnce(new Error("persona down"));
      expect(await loadRecent(db, "acct1", "ct1")).toMatchObject({ status: "ready", names: {}, personaName: null });
      expect(errors.mock.calls.map((c) => String(c[0])).join("\n")).toContain("for account acct1");
    } finally { errors.mockRestore(); }
  });
});

/**
 * A request client answering the two stage reads (readSuggestionStages: opportunities, then
 * pipeline_stages). Records each table it was asked for, and each account filter, so a test can
 * prove the reads ran, on which client and for which account.
 */
function stageDb(answer: { opportunities?: { data?: unknown[]; error?: { message: string } }; pipeline_stages?: { data?: unknown[]; error?: { message: string } } } = {}) {
  const asked: string[] = [];
  const accounts: unknown[] = [];
  const client = {
    from(table: "opportunities" | "pipeline_stages") {
      asked.push(table);
      const res = answer[table] ?? { data: [] };
      const chain = {
        select: () => chain,
        eq: (col: string, v: unknown) => { if (col === "account_id") accounts.push(v); return chain; },
        in: () => chain,
        limit: async () => ({ data: res.data ?? null, error: res.error ?? null }),
      };
      return chain;
    },
  };
  return { db: client as unknown as SupabaseClient, asked, accounts };
}
const DEAL = { opportunities: { data: [{ id: "opp_1", pipeline_id: "pl_1" }] },
  pipeline_stages: { data: [{ id: "st_new", name: "New lead", position: 0, pipeline_id: "pl_1" }, { id: "st_quote", name: "Quote sent", position: 1, pipeline_id: "pl_1" }] } };
const stageEntry = { kind: "suggestion", id: "sg_stage", at: "2026-10-15T14:42:00.000Z", contactId: "con_1",
  suggestion: { proposal: { ...SG.stage, status: "accepted" }, applied: SG.stage.payload } };

describe("record loaders: suggestions (item 8b-2)", () => {
  beforeEach(() => {
    listContactTimelinePageMock.mockReset().mockResolvedValue({ items: [], older: null, failed: [], sources: SOURCES });
    listPeopleNamesMock.mockReset().mockResolvedValue({});
    getVoiceProfileMock.mockReset().mockResolvedValue(null);
    holdOpenTaskIdsMock.mockReset().mockResolvedValue([]);
    listPendingProposalsForContactMock.mockReset().mockResolvedValue([]);
  });

  it("the record page's timeline reads the suggestions source; the drawer's Recent does not (owner decision 1; mutation: pass it in loadRecent -> FAILS)", async () => {
    await loadTimeline(db, ledger, "acct1", "ct1");
    expect(listContactTimelinePageMock.mock.calls[0]![4]).toMatchObject({ suggestions: true });
    await loadRecent(db, "acct1", "ct1");
    expect(listContactTimelinePageMock.mock.calls[1]![4]).not.toHaveProperty("suggestions");
  });

  it("the timeline's stage suggestions get their stage names, read on the page's client for this account (mutation: drop the stage read -> FAILS)", async () => {
    const s = stageDb(DEAL);
    listContactTimelinePageMock.mockResolvedValue({ items: [stageEntry], older: null, failed: [], sources: [...SOURCES, "suggestions"] });
    const load = await loadTimeline(s.db, ledger, "acct1", "ct1");
    expect(load).toMatchObject({ status: "ready", suggestionStages: { st_new: { name: "New lead", position: 0 }, st_quote: { name: "Quote sent", position: 1 } } });
    expect([s.asked, s.accounts]).toEqual([["opportunities", "pipeline_stages"], ["acct1", "acct1"]]);
  });

  it("a page with no stage suggestion reads no stages, and the names are empty", async () => {
    const s = stageDb(DEAL);
    expect(await loadTimeline(s.db, ledger, "acct1", "ct1")).toMatchObject({ status: "ready", suggestionStages: {} });
    expect(s.asked).toEqual([]);
  });

  it("a failed stage read costs only the names, logged by card and account (mutation: let it throw -> the card's error, FAILS)", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      listContactTimelinePageMock.mockResolvedValue({ items: [stageEntry], older: null, failed: [], sources: [...SOURCES, "suggestions"] });
      const load = await loadTimeline(stageDb({ opportunities: { error: { message: "deals down" } } }).db, ledger, "acct1", "cust-42");
      expect(load).toMatchObject({ status: "ready", suggestionStages: {}, page: { items: [stageEntry] } });
      const logged = errors.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
      expect(logged).toContain("record page: activity stage names read failed for account acct1");
      expect(logged).not.toContain("cust-42");
    } finally { errors.mockRestore(); }
  });
});

describe("loadWaitingSuggestions: the record's Waiting for you (item 8b-2, spec 5.3)", () => {
  const NOW_ = new Date("2026-10-15T15:00:00.000Z");
  beforeEach(() => { listPendingProposalsForContactMock.mockReset(); });

  it("reads this customer's pending suggestions on the page's client, with the clock, and their stage names (mutation: drop the stage read -> FAILS)", async () => {
    const s = stageDb(DEAL);
    listPendingProposalsForContactMock.mockResolvedValue([SG.pending, SG.stage]);
    const load = await loadWaitingSuggestions(s.db, "acct1", "ct1", NOW_);
    expect(listPendingProposalsForContactMock).toHaveBeenCalledWith(s.db, "acct1", "ct1", NOW_);
    expect(load).toEqual({ status: "ready", rows: [SG.pending, SG.stage], stages: {
      stages: { st_new: { name: "New lead", position: 0 }, st_quote: { name: "Quote sent", position: 1 } },
      pipelineStages: [{ id: "st_new", name: "New lead", position: 0, pipelineId: "pl_1" }, { id: "st_quote", name: "Quote sent", position: 1, pipelineId: "pl_1" }],
    } });
  });

  it("reads no stages when no row is a stage suggestion", async () => {
    const s = stageDb(DEAL);
    listPendingProposalsForContactMock.mockResolvedValue([SG.pending]);
    expect(await loadWaitingSuggestions(s.db, "acct1", "ct1", NOW_)).toEqual({ status: "ready", rows: [SG.pending], stages: { stages: {}, pipelineStages: [] } });
    expect(s.asked).toEqual([]);
  });

  it("a failed read, or a failed stage read, is the section's error and never a throw, logged by card and account only (mutation: rethrow -> FAILS)", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      listPendingProposalsForContactMock.mockRejectedValueOnce(new Error("proposals down"));
      expect(await loadWaitingSuggestions(stageDb().db, "acct1", "cust-42", NOW_)).toEqual({ status: "error" });
      listPendingProposalsForContactMock.mockResolvedValueOnce([SG.stage]);
      expect(await loadWaitingSuggestions(stageDb({ ...DEAL, pipeline_stages: { error: { message: "stages down" } } }).db, "acct1", "cust-42", NOW_)).toEqual({ status: "error" });
      const logged = errors.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
      expect(logged).toContain("record page: waiting suggestions read failed for account acct1: Error: proposals down");
      expect(logged).toContain("stages down");
      expect(logged).not.toContain("cust-42");
      expect(logged).not.toContain(SG.stage.evidence);
    } finally { errors.mockRestore(); }
  });
});
