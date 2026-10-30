import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  startAgencyVisit, agencyVisitLive, noteAgencyOpen, newestAgencyVisitStart, readAgencyActorName,
  readAccessLogPage, parseAccessLogPage, isAgencyVisitReason,
  AGENCY_VISIT_REASONS, ACCESS_LOG_KINDS, ACCESS_LOG_PAGE_SIZE, ACCESS_LOG_ITEMS_SHOWN,
} from "../access-log";

/**
 * F-118 part 1: the typed wrappers over 0105. No database: a fake client records every rpc (name and
 * arguments) and every table read (columns, filters, order, limit), and answers a scripted { data, error }.
 * A wrapper that sends the wrong argument name, drops a filter, swallows an error or passes an answer it
 * did not expect fails here by name. The PostgREST round trip is access-log-live.test.ts (CI only).
 */
type Answer = { data: unknown; error: { code?: string; message: string } | null };
type Rpc = { fn: string; args: Record<string, unknown> };
type Read = { table: string; cols: string; filters: [string, string, unknown][]; order: [string, unknown][]; limit: number | null; single: boolean };

function fake(answer: Answer) {
  const rpcs: Rpc[] = [];
  const reads: Read[] = [];
  const db = {
    rpc: async (fn: string, args: Record<string, unknown>) => { rpcs.push({ fn, args }); return answer; },
    from(table: string) {
      const r: Read = { table, cols: "", filters: [], order: [], limit: null, single: false };
      reads.push(r);
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        select: (cols: string) => { r.cols = cols; return b; },
        eq: (col: string, v: unknown) => { r.filters.push(["eq", col, v]); return b; },
        order: (col: string, o: unknown) => { r.order.push([col, o]); return b; },
        limit: (n: number) => { r.limit = n; return b; },
        maybeSingle: async () => { r.single = true; return answer; },
      });
      return b;
    },
  };
  return { db: db as unknown as SupabaseClient, rpcs, reads };
}
const ok = (data: unknown): Answer => ({ data, error: null });
const ACTOR = { clerkUserId: "user_1", sessionId: "sess_1" };

const ZERO = { contact: 0, group: 0, call: 0, conversation: 0, file: 0, form_answers: 0, customer_list_export: 0 };
const rawVisit = (id: string, o: Record<string, unknown> = {}) => ({
  id, actor_name: "Dan Lopez", reason: "support", started_at: "2026-10-29T10:00:00+00:00", ended_at: null,
  counts: ZERO, item_total: 0, items: [], ...o,
});

describe("access-log constants", () => {
  it("name the four reasons and nine kinds 0105's checks hold, and the reader's sizes", () => {
    expect(AGENCY_VISIT_REASONS).toEqual(["setup", "support", "fix", "billing"]);
    expect(ACCESS_LOG_KINDS).toEqual(["contact", "group", "call", "conversation", "document_view", "document_download",
      "document_share", "form_answers", "customer_list_export"]);
    expect([ACCESS_LOG_PAGE_SIZE, ACCESS_LOG_ITEMS_SHOWN]).toEqual([20, 100]);
    expect(isAgencyVisitReason("fix")).toBe(true);
    expect(isAgencyVisitReason("curious")).toBe(false);
    expect(isAgencyVisitReason(undefined)).toBe(false);
  });
});

describe("each wrapper sends exactly its function or table and its argument names", () => {
  it("startAgencyVisit: start_agency_visit with all five arguments, answering the id", async () => {
    const f = fake(ok("v1"));
    expect(await startAgencyVisit(f.db, "A", { ...ACTOR, name: "Dan" }, "support")).toBe("v1");
    expect(f.rpcs).toEqual([{ fn: "start_agency_visit", args: {
      p_account_id: "A", p_actor: "user_1", p_actor_name: "Dan", p_session: "sess_1", p_reason: "support" } }]);
  });

  it("agencyVisitLive: agency_visit_live with the person in p_actor and the session in p_session (mutation: swap them -> FAILS)", async () => {
    const f = fake(ok("v1"));
    expect(await agencyVisitLive(f.db, "A", ACTOR)).toBe("v1");
    expect(f.rpcs).toEqual([{ fn: "agency_visit_live", args: { p_account_id: "A", p_actor: "user_1", p_session: "sess_1" } }]);
  });

  it("noteAgencyOpen: note_agency_open with the record's id and no count", async () => {
    const f = fake(ok("ok"));
    expect(await noteAgencyOpen(f.db, "A", ACTOR, { kind: "contact", recordId: "c1" })).toBe("ok");
    expect(f.rpcs).toEqual([{ fn: "note_agency_open", args: {
      p_account_id: "A", p_actor: "user_1", p_session: "sess_1", p_kind: "contact", p_record_id: "c1", p_item_count: null } }]);
  });

  it("newestAgencyVisitStart: agency_visits.started_at for the account, person and session, newest first, one row (mutation: drop .eq(account_id) -> FAILS)", async () => {
    const f = fake(ok({ started_at: "2026-10-29T10:00:00+00:00" }));
    expect(await newestAgencyVisitStart(f.db, "A", ACTOR)).toBe("2026-10-29T10:00:00+00:00");
    expect(f.reads).toEqual([{ table: "agency_visits", cols: "started_at",
      filters: [["eq", "account_id", "A"], ["eq", "actor_clerk_user_id", "user_1"], ["eq", "clerk_session_id", "sess_1"]],
      order: [["started_at", { ascending: false }]], limit: 1, single: true }]);
  });

  it("readAgencyActorName: users.name and email by Clerk user id", async () => {
    const f = fake(ok({ name: "Dan Lopez", email: "dan@example.com" }));
    expect(await readAgencyActorName(f.db, "user_1")).toEqual({ name: "Dan Lopez", email: "dan@example.com" });
    expect(f.reads).toEqual([{ table: "users", cols: "name, email", filters: [["eq", "clerk_user_id", "user_1"]],
      order: [], limit: null, single: true }]);
  });

  it("readAccessLogPage: access_log_page with the cursor's two halves and the limit, default 20", async () => {
    const f = fake(ok({ total: 0, visits: [] }));
    expect(await readAccessLogPage(f.db, "A", null)).toEqual({ total: 0, visits: [], hasOlder: false });
    await readAccessLogPage(f.db, "A", { startedAt: "2026-10-29T10:00:00+00:00", id: "v9" }, 5);
    expect(f.rpcs).toEqual([
      { fn: "access_log_page", args: { p_account_id: "A", p_before_started: null, p_before_id: null, p_limit: 20 } },
      { fn: "access_log_page", args: { p_account_id: "A", p_before_started: "2026-10-29T10:00:00+00:00", p_before_id: "v9", p_limit: 5 } },
    ]);
  });
});

describe("startAgencyVisit's answers", () => {
  it("no such account (23503) is null; any other error throws naming the wrapper (mutation: return null on every error -> FAILS)", async () => {
    expect(await startAgencyVisit(fake({ data: null, error: { code: "23503", message: "fk" } }).db, "A", { ...ACTOR, name: null }, "fix")).toBeNull();
    await expect(startAgencyVisit(fake({ data: null, error: { code: "42501", message: "permission denied" } }).db, "A", { ...ACTOR, name: null }, "fix"))
      .rejects.toThrow(/startAgencyVisit/);
  });
  it("a non-string answer throws", async () => {
    await expect(startAgencyVisit(fake(ok(null)).db, "A", { ...ACTOR, name: null }, "fix")).rejects.toThrow(/startAgencyVisit/);
    await expect(startAgencyVisit(fake(ok(7)).db, "A", { ...ACTOR, name: null }, "fix")).rejects.toThrow(/startAgencyVisit/);
  });
});

describe("agencyVisitLive's answers", () => {
  it("null is no visit, a string is the visit, anything else and any error throw", async () => {
    expect(await agencyVisitLive(fake(ok(null)).db, "A", ACTOR)).toBeNull();
    await expect(agencyVisitLive(fake(ok(42)).db, "A", ACTOR)).rejects.toThrow(/agencyVisitLive/);
    await expect(agencyVisitLive(fake({ data: null, error: { message: "boom" } }).db, "A", ACTOR)).rejects.toThrow(/agencyVisitLive/);
  });
});

describe("noteAgencyOpen", () => {
  it("an export sends no record id and its count; a record sends its id and no count (mutation: always send ref.recordId -> FAILS)", async () => {
    const f = fake(ok("ok"));
    await noteAgencyOpen(f.db, "A", ACTOR, { kind: "customer_list_export", itemCount: 212 });
    await noteAgencyOpen(f.db, "A", ACTOR, { kind: "document_share", recordId: "d1" });
    expect(f.rpcs.map((r) => [r.args.p_kind, r.args.p_record_id, r.args.p_item_count])).toEqual([
      ["customer_list_export", null, 212],
      ["document_share", "d1", null],
    ]);
  });
  it("no_visit passes through; an unknown answer or an error throws naming the wrapper", async () => {
    expect(await noteAgencyOpen(fake(ok("no_visit")).db, "A", ACTOR, { kind: "call", recordId: "x" })).toBe("no_visit");
    await expect(noteAgencyOpen(fake(ok("maybe")).db, "A", ACTOR, { kind: "call", recordId: "x" })).rejects.toThrow(/noteAgencyOpen/);
    await expect(noteAgencyOpen(fake({ data: null, error: { message: "boom" } }).db, "A", ACTOR, { kind: "call", recordId: "x" }))
      .rejects.toThrow(/noteAgencyOpen/);
  });
});

describe("the two table reads' answers", () => {
  it("newestAgencyVisitStart: no row is null; an error throws", async () => {
    expect(await newestAgencyVisitStart(fake(ok(null)).db, "A", ACTOR)).toBeNull();
    await expect(newestAgencyVisitStart(fake({ data: null, error: { message: "boom" } }).db, "A", ACTOR)).rejects.toThrow(/newestAgencyVisitStart/);
    await expect(newestAgencyVisitStart(fake(ok({ started_at: 5 })).db, "A", ACTOR)).rejects.toThrow(/newestAgencyVisitStart/);
  });
  it("readAgencyActorName: no row is null; a null name passes; an error throws", async () => {
    expect(await readAgencyActorName(fake(ok(null)).db, "user_1")).toBeNull();
    expect(await readAgencyActorName(fake(ok({ name: null, email: "a@b.c" })).db, "user_1")).toEqual({ name: null, email: "a@b.c" });
    await expect(readAgencyActorName(fake({ data: null, error: { message: "boom" } }).db, "user_1")).rejects.toThrow(/readAgencyActorName/);
  });
});

describe("parseAccessLogPage", () => {
  it("maps snake_case to camelCase, and limit + 1 visits mean hasOlder with only limit kept", () => {
    const raw = {
      total: 7,
      visits: [
        rawVisit("v3", {
          ended_at: "2026-10-29T10:40:00+00:00", item_total: 2,
          counts: { ...ZERO, contact: 1, customer_list_export: 1 },
          items: [
            { kind: "customer_list_export", record_id: null, item_count: 12, first_opened_at: "2026-10-29T10:40:00+00:00" },
            { kind: "contact", record_id: "c1", item_count: null, first_opened_at: "2026-10-29T10:30:00+00:00" },
          ],
        }),
        rawVisit("v2", { actor_name: null, reason: "billing" }),
        rawVisit("v1"),
      ],
    };
    expect(parseAccessLogPage(raw, 2)).toEqual({
      total: 7,
      hasOlder: true,
      visits: [
        {
          id: "v3", actorName: "Dan Lopez", reason: "support", startedAt: "2026-10-29T10:00:00+00:00",
          endedAt: "2026-10-29T10:40:00+00:00", counts: { ...ZERO, contact: 1, customer_list_export: 1 }, itemTotal: 2,
          items: [
            { kind: "customer_list_export", recordId: null, itemCount: 12, firstOpenedAt: "2026-10-29T10:40:00+00:00" },
            { kind: "contact", recordId: "c1", itemCount: null, firstOpenedAt: "2026-10-29T10:30:00+00:00" },
          ],
        },
        { id: "v2", actorName: null, reason: "billing", startedAt: "2026-10-29T10:00:00+00:00", endedAt: null,
          counts: ZERO, itemTotal: 0, items: [] },
      ],
    });
    expect(parseAccessLogPage({ total: 1, visits: [rawVisit("v1")] }, 2).hasOlder).toBe(false);
  });

  it("throws on an unknown reason, an unknown kind, a missing count and a malformed page", () => {
    const item = (o: Record<string, unknown>) => ({ kind: "contact", record_id: "c1", item_count: null, first_opened_at: "t", ...o });
    expect(() => parseAccessLogPage({ total: 1, visits: [rawVisit("v1", { reason: "curious" })] }, 20)).toThrow(/parseAccessLogPage/);
    expect(() => parseAccessLogPage({ total: 1, visits: [rawVisit("v1", { items: [item({ kind: "peek" })] })] }, 20)).toThrow(/parseAccessLogPage/);
    const { file: _file, ...noFile } = ZERO;
    expect(() => parseAccessLogPage({ total: 1, visits: [rawVisit("v1", { counts: noFile })] }, 20)).toThrow(/parseAccessLogPage/);
    expect(() => parseAccessLogPage({ total: "1", visits: [] }, 20)).toThrow(/parseAccessLogPage/);
    expect(() => parseAccessLogPage({ total: 1 }, 20)).toThrow(/parseAccessLogPage/);
    expect(() => parseAccessLogPage(null, 20)).toThrow(/parseAccessLogPage/);
    // Positive control: the same shapes with valid values parse.
    expect(parseAccessLogPage({ total: 1, visits: [rawVisit("v1", { items: [item({})] })] }, 20).visits).toHaveLength(1);
  });

  it("readAccessLogPage throws naming itself on an error", async () => {
    await expect(readAccessLogPage(fake({ data: null, error: { message: "boom" } }).db, "A", null)).rejects.toThrow(/readAccessLogPage/);
  });
});
