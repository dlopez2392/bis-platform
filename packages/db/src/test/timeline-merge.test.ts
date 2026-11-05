import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  compareTimelineEntries, listContactTimelinePage, listPeopleNames, TIMELINE_SOURCES, type TimelineEntry,
} from "../record";
import { instantKey, TIMELINE_PAGE_SIZE, decodeBigintCursorId } from "../timeline-cursor";

const note = (id: string, at: string): TimelineEntry =>
  ({ kind: "note", id, at, contactId: "c", note: { id, body: "x", author_id: null, created_at: at } });

describe("compareTimelineEntries: (at desc, id desc) across tables (spec C3)", () => {
  it("newest first to the microsecond, whatever the spelling (mutation: compare Date.parse -> the 1 µs pair ties, FAILS)", () => {
    const rows = [note("00000000-0000-4000-8000-000000000001", "2026-10-09T16:12:00.000001+00:00"),
      note("00000000-0000-4000-8000-000000000002", "2026-10-09T16:12:00Z"),
      note("00000000-0000-4000-8000-000000000003", "2026-10-09T16:12:00.000002Z")];
    expect([...rows].sort(compareTimelineEntries).map((r) => r.id.slice(-1))).toEqual(["3", "1", "2"]);
  });
  it("a tie on the instant falls to the higher id first, as Postgres orders uuids (mutation: ascending ids -> FAILS)", () => {
    const at = "2026-10-09T16:12:00.5+00:00";
    const rows = [note("0a000000-0000-4000-8000-000000000000", at), note("0b000000-0000-4000-8000-000000000000", at)];
    expect([...rows].sort(compareTimelineEntries).map((r) => r.id.slice(0, 2))).toEqual(["0b", "0a"]);
  });
});

// ---------------------------------------------------------------------------------------------
// The merge itself, over a fake client (no connection). The fake does what the SQL does: each
// source's (column desc, id desc) order, its strict (at, id) cursor parsed back out of the `.or()`
// filter timelineBeforeFilter wrote, `.in()` and `.limit()`. The cursor's SQL is Task 2's, proven
// live in timeline-sources.test.ts; record.test.ts proves this page live in CI.
// ---------------------------------------------------------------------------------------------
type Row = Record<string, unknown>;
type Read = { table: string; limit?: number; or?: string; in?: [string, unknown[]] };
const u = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const CURSOR = /^(\w+)\.lt\."([^"]+)",and\(\w+\.eq\."[^"]+",id\.lt\.([0-9a-f-]+)\)$/;
// The bigint-id sources' foreign-cursor fallback (timeline-cursor.ts's withBigintTimelinePage):
// `col.lt."V",col.eq."V"` — inclusive on time alone, no id at all (never a uuid sent to a bigint column).
const INCLUSIVE = /^(\w+)\.lt\."([^"]+)",\1\.eq\."([^"]+)"$/;

function fakeDb(tables: Record<string, Row[]>, fail: { throwOn?: string[]; errorOn?: string[] } = {}) {
  const reads: Read[] = [];
  const from = (table: string) => {
    if (fail.throwOn?.includes(table)) throw new Error(`${table} down`);
    const read: Read = { table };
    reads.push(read);
    let rows = [...(tables[table] ?? [])];
    let column: string | null = null;
    const b = {
      select: () => b, eq: () => b, neq: () => b,
      // Only the one shape production code actually sends through this fake: `.not(col, "is", null)`
      // (listContactMergeLog's undone_at read). Anything else stays a no-op, as before.
      not: (c: string, op: string, v: unknown) => {
        if (op === "is" && v === null) rows = rows.filter((r) => r[c] !== null && r[c] !== undefined);
        return b;
      },
      in: (c: string, vs: unknown[]) => { read.in = [c, vs]; rows = rows.filter((r) => vs.includes(r[c])); return b; },
      order: (c: string) => { if (c !== "id") column = c; return b; },
      or: (f: string) => {
        read.or = f;
        const m = CURSOR.exec(f);
        if (m) {
          const [, col, v, id] = m as unknown as [string, string, string, string];
          rows = rows.filter((r) => {
            const k = instantKey(r[col] as string);
            return k < instantKey(v) || (k === instantKey(v) && (r.id as string) < id);
          });
          return b;
        }
        const im = INCLUSIVE.exec(f);
        if (im) {
          const [, col, v] = im as unknown as [string, string, string];
          rows = rows.filter((r) => instantKey(r[col] as string) <= instantKey(v));
          return b;
        }
        throw new Error(`fake: unexpected filter ${f}`);
      },
      limit: (n: number) => { read.limit = n; return b; },
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
        if (fail.errorOn?.includes(table)) {
          return Promise.resolve({ data: null, error: { message: `${table} refused` } }).then(ok, ko);
        }
        const col = column;
        const sorted = col === null ? rows : [...rows].sort((a, c) => {
          const ka = instantKey(a[col] as string);
          const kc = instantKey(c[col] as string);
          return ka !== kc ? (ka < kc ? 1 : -1) : (a.id as string) < (c.id as string) ? 1 : -1;
        });
        return Promise.resolve({ data: sorted.slice(0, read.limit ?? sorted.length), error: null }).then(ok, ko);
      },
    };
    return b;
  };
  return { db: { from } as unknown as SupabaseClient, reads };
}

const day = (d: number) => `2026-10-0${d}T15:00:00+00:00`;
const CONV = u(900);
const noteRow = (id: string, at: string): Row => ({ id, body: "n", pinned: false, author_id: null, created_at: at });
const callRow = (id: string, at: string): Row =>
  ({ id, started_at: at, outcome: "booked", duration_secs: 60, reason: null, summary: "", language: "en" });
const msgRow = (id: string, at: string, channel: string): Row => ({
  id, conversation_id: CONV, channel, direction: "outbound", status: "delivered", provider_message_id: null,
  subject: null, body: "x", error: null, created_at: at, author_kind: "person", author_id: "user_a",
});
// Bigint-id sources (0103, 0106): `id` is a plain small integer, like the real tables' own
// `generated always as identity`, never a uuid — exactly the shape that broke `timelineBeforeFilter`.
const archiveRow = (id: number, at: string): Row =>
  ({ id, contact_id: u(99), action: "archived", author_kind: "person", author_id: "user_a", sign: null, created_at: at });
const mergeRow = (id: number, mergedAt: string, undoneAt: string | null = null): Row => ({
  id, keep_id: u(99), other_id: u(199), merged_by: "user_a", merged_at: mergedAt,
  undo_until: "2099-01-01T00:00:00+00:00", undone_at: undoneAt, undone_by: undoneAt ? "user_a" : null, moved_counts: {},
});
const sevenSources = (): Record<string, Row[]> => ({
  notes: [noteRow(u(1), day(1))],
  tasks: [{ id: u(2), title: "t", due_at: null, completed_at: null, created_at: day(2), consent_event_id: null,
    call_id: null, assigned_to: null, created_by: "user_a" }],
  opportunities: [{ id: u(3), name: "d", status: "open", monetary_value: "10.00", created_at: day(3), created_by: null }],
  form_submissions: [{ id: u(4), form_id: u(40), contact_id: u(99), answers: [], attribution: {}, consent: null,
    locale: null, spam_reason: null, processing_error: null, created_at: day(4), forms: { name: "Quote request" },
    author_kind: "ai" }],
  conversations: [{ id: CONV }],
  messages: [msgRow(u(5), day(5), "sms")],
  bookings: [{ id: u(6), created_at: day(6), starts_at: "2027-03-02T15:00:00+00:00", status: "confirmed", note: null,
    author_kind: "customer", author_id: null, rescheduled_from_id: null }],
  calls: [callRow(u(7), day(7))],
});

describe("listContactTimelinePage over a fake client (spec §7, C3, C4)", () => {
  it("merges the seven sources newest first, each its own kind, a call by started_at (mutation: leave calls out of the merge -> FAILS)", async () => {
    const { db } = fakeDb(sevenSources());
    const page = await listContactTimelinePage(db, u(100), u(99));
    expect(page.items.map((i) => i.kind)).toEqual(["call", "booking", "message", "submission", "deal", "task", "note"]);
    expect(page.items.map((i) => i.id)).toEqual([u(7), u(6), u(5), u(4), u(3), u(2), u(1)]);
    expect(page).toMatchObject({ older: null, failed: [] });
    expect(page.items.find((i) => i.kind === "submission"))
      .toMatchObject({ submission: { formName: "Quote request", author_kind: "ai", answers: [] } });
    expect(page.items.find((i) => i.kind === "task")).toMatchObject({ task: { created_by: "user_a" } });
  });

  it("asks messages for email and text only, so the inbox's form and voice copies are not rows (C4; mutation: drop the channels option -> FAILS)", async () => {
    const { db, reads } = fakeDb({ conversations: [{ id: CONV }],
      messages: [msgRow(u(1), day(1), "form"), msgRow(u(2), day(2), "voice"), msgRow(u(3), day(3), "email")] });
    const page = await listContactTimelinePage(db, u(100), u(99));
    expect(page.items.map((i) => i.id)).toEqual([u(3)]);
    expect(reads.find((r) => r.table === "messages")?.in).toEqual(["channel", ["email", "sms"]]);
  });

  it("rows at one instant in two sources across a page boundary are neither lost nor repeated (mutation: ascending ids in the merge -> the higher id is lost, FAILS; drop `before` for calls -> the call repeats, FAILS)", async () => {
    const same = "2026-10-09T16:12:00.123456+00:00";
    const { db } = fakeDb({ notes: [noteRow(u(10), same)], calls: [callRow(u(11), same)] });
    const p1 = await listContactTimelinePage(db, u(100), u(99), undefined, { limit: 1 });
    expect(p1.items.map((i) => i.id)).toEqual([u(11)]);
    expect(p1.older).toEqual({ v: same, id: u(11) });
    const p2 = await listContactTimelinePage(db, u(100), u(99), p1.older!, { limit: 1 });
    expect(p2.items.map((i) => i.id)).toEqual([u(10)]);
    expect(p2.older).toBeNull();
  });

  it("reads limit + 1 from every source and says there is an older page only when a 31st row exists (mutation: read `limit` -> older is null at 31, FAILS; `>=` -> older at exactly 30, FAILS)", async () => {
    const notes = (n: number) =>
      Array.from({ length: n }, (_, i) => noteRow(u(i + 1), `2026-10-01T15:${String(i).padStart(2, "0")}:00+00:00`));
    const full = fakeDb({ conversations: [{ id: CONV }], notes: notes(31) });
    const p = await listContactTimelinePage(full.db, u(100), u(99));
    expect(p.items).toHaveLength(TIMELINE_PAGE_SIZE);
    expect(p.items[29]!.id).toBe(u(2));
    expect(p.older).toEqual({ v: p.items[29]!.at, id: u(2) });
    const paged = full.reads.filter((r) => r.table !== "conversations");
    // S-07 1b (owner ruling R2) + S-07 2a (spec 3.5) + S-07 2b (plan deviation 6) + S-07 2c: the documents
    // source reads `documents`, 0078's document_version_timeline, 0079's document_scan_timeline, 0080's
    // document_requests and 0081's two document_requirement_skips reads (a skip at created_at, an un-skip at
    // unskipped_at), and 0085's two document_share_timeline reads (a share at created_at, an open at
    // first_opened_at), so there are seven reads more than there are sources, each at limit + 1. F-006
    // part 1 (plan Task 9): the `merge` source is a SECOND paged read of `contact_merges` too (one on
    // merged_at, one on undone_at), one more than there are sources; its ONE extra names read is skipped
    // here (no merge row, so no other id to look up).
    // 8b-2 / 8c / F-115 Task 4: `sources`, not TIMELINE_SOURCES, is what this page read (suggestions,
    // ai_acts and changes are read only when asked).
    expect(p.sources).toEqual(TIMELINE_SOURCES.filter((s) => s !== "suggestions" && s !== "ai_acts" && s !== "changes"));
    expect(paged.map((r) => r.limit)).toEqual(Array(p.sources.length + 8).fill(TIMELINE_PAGE_SIZE + 1));
    expect(paged.filter((r) => r.table === "document_requests").map((r) => r.limit)).toEqual([TIMELINE_PAGE_SIZE + 1]);
    expect(paged.filter((r) => r.table === "document_requirement_skips").map((r) => r.limit)).toEqual([TIMELINE_PAGE_SIZE + 1, TIMELINE_PAGE_SIZE + 1]);
    expect(paged.filter((r) => r.table === "document_version_timeline").map((r) => r.limit)).toEqual([TIMELINE_PAGE_SIZE + 1]);
    expect(paged.filter((r) => r.table === "document_scan_timeline").map((r) => r.limit)).toEqual([TIMELINE_PAGE_SIZE + 1]);
    expect(paged.filter((r) => r.table === "document_share_timeline").map((r) => r.limit)).toEqual([TIMELINE_PAGE_SIZE + 1, TIMELINE_PAGE_SIZE + 1]);
    const exact = await listContactTimelinePage(fakeDb({ notes: notes(30) }).db, u(100), u(99));
    expect(exact.items).toHaveLength(30);
    expect(exact.older).toBeNull();
  });

  it("a source that throws or is refused is named in `failed`, in source order, and the rest still load (spec §7; mutation: let one source's error reject the page -> FAILS)", async () => {
    const { db } = fakeDb(sevenSources(), { throwOn: ["calls"], errorOn: ["messages"] });
    const errors: string[] = [];
    const page = await listContactTimelinePage(db, u(100), u(99), undefined, { onError: (s) => errors.push(s) });
    // S-06 part 3: the chats source reads messages too, so it fails with it.
    expect(page.failed).toEqual(["messages", "calls", "chats"]);
    expect([...errors].sort()).toEqual(["calls", "chats", "messages"]);
    expect(page.items.map((i) => i.kind)).toEqual(["booking", "submission", "deal", "task", "note"]);
  });

  it("the chats source's COUNT read refused, its anchor read fine: chats is named in `failed`, never a chat row with a made-up count (Task 7 M1; mutation: swallow the count read's error -> a chat row counted 1 and failed [], FAILS)", async () => {
    const anchor: Row = { id: u(50), conversation_id: CONV, channel: "webchat", created_at: day(5),
      meta: { webchat: { chat_id: u(51), index: 0, matched_existing: false } } };
    const tables = { conversations: [{ id: CONV, contact_id: u(99) }], messages: [anchor] };
    // Control: with every read answering, the anchor IS a chat row, so the case below tests the count read.
    const ok = await listContactTimelinePage(fakeDb(tables).db, u(100), u(99));
    expect([ok.failed, ok.items.map((i) => i.kind)]).toEqual([[], ["chat"]]);
    // Only the count read (its select is `chat_id:meta->webchat->>chat_id`) answers an error.
    const base = fakeDb(tables).db as unknown as { from: (t: string) => Record<string, (...a: unknown[]) => unknown> };
    const refused: unknown = new Proxy({}, { get: (_t, p) => (p === "then"
      ? (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve({ data: null, error: { message: "counts refused" } }).then(res, rej)
      : () => refused) });
    const db = { from: (t: string) => {
      const b = base.from(t);
      if (t !== "messages") return b;
      const select = b.select!;
      return { ...b, select: (cols: unknown) => (String(cols).startsWith("chat_id:") ? refused : select(cols)) };
    } } as unknown as SupabaseClient;
    const errors: string[] = [];
    const page = await listContactTimelinePage(db, u(100), u(99), undefined, { onError: (s) => errors.push(s) });
    expect(page.failed).toEqual(["chats"]);
    expect(errors).toEqual(["chats"]);
    expect(page.items.filter((i) => i.kind === "chat")).toEqual([]);
  });

  it("every source failing is still a page, not a throw (mutation: Promise.all without the per-source catch -> rejects, FAILS)", async () => {
    // F-006 part 1 (plan Task 9): "contact_merges" throws too, so the merge source fails with the rest.
    const all = ["notes", "tasks", "opportunities", "form_submissions", "conversations", "bookings", "calls", "documents", "contact_archive_log", "contact_merges"];
    const page = await listContactTimelinePage(fakeDb({}, { throwOn: all }).db, u(100), u(99));
    const NINE = ["notes", "todos", "deals", "forms", "messages", "bookings", "calls", "documents", "chats", "archive", "merge"];
    expect(page).toEqual({ items: [], older: null, failed: NINE, sources: NINE });
    // 8b-2: asked for, the suggestions source is read too, and fails with the rest.
    const asked = await listContactTimelinePage(fakeDb({}, { throwOn: [...all, "proposals"] }).db, u(100), u(99), undefined, { suggestions: true });
    expect(asked).toEqual({ items: [], older: null, failed: [...NINE, "suggestions"], sources: [...NINE, "suggestions"] });
  });

  it("the suggestions source reads accepted and edited rows on decided_at, at limit + 1, only when asked (8b-2; mutation: the entry's at from created_at -> the rows swap and carry the wrong instants, FAILS)", async () => {
    const prop = (id: string, status: string, created: string, decided: string | null): Row => ({
      id, account_id: u(100), source: "call", call_id: u(800), contact_id: u(99), kind: "task",
      payload: { title: `t${id.slice(-1)}`, dueAt: null }, applied_payload: status === "pending" ? null : { title: "done", dueAt: null },
      applied_ref: null, evidence: "x", evidence_ref: {}, evidence_lang: "en", status, expired_reason: null,
      decided_at: decided, decided_by: decided ? "user_a" : null, undone_at: null, undone_by: null,
      expires_at: "2031-03-04T05:06:07+00:00", created_at: created,
    });
    // Made in one order, decided in the other: the row sits at its DECISION.
    const proposals = [prop(u(21), "accepted", day(1), day(6)), prop(u(22), "edited", day(2), day(5)), prop(u(23), "pending", day(3), null)];
    const { db, reads } = fakeDb({ conversations: [{ id: CONV }], proposals });
    const page = await listContactTimelinePage(db, u(100), u(99), undefined, { suggestions: true });
    expect(page.items.map((i) => [i.kind, i.id, i.at])).toEqual([["suggestion", u(21), day(6)], ["suggestion", u(22), day(5)]]);
    expect(reads.filter((r) => r.table === "proposals").map((r) => [r.limit, r.in])).toEqual([[TIMELINE_PAGE_SIZE + 1, ["status", ["accepted", "edited"]]]]);
    const plain = fakeDb({ conversations: [{ id: CONV }], proposals });
    await listContactTimelinePage(plain.db, u(100), u(99));
    expect(plain.reads.filter((r) => r.table === "proposals")).toEqual([]);
  });

  it("a refused read of the removed-file relation fails the documents source, not a swallowed empty (spec 3.5; mutation: .catch(() => []) on listDocumentScanTimeline -> FAILS)", async () => {
    const { db } = fakeDb({ conversations: [{ id: CONV }] }, { errorOn: ["document_scan_timeline"] });
    const errors: string[] = [];
    const page = await listContactTimelinePage(db, u(100), u(99), undefined, { onError: (s) => errors.push(s) });
    expect(page.failed).toEqual(["documents"]);
    expect(errors).toEqual(["documents"]);
  });

  it("a refused read of the request relation fails the documents source too, not a swallowed empty (S-07 2b; mutation: .catch(() => []) on listDocumentRequestTimeline -> FAILS)", async () => {
    const { db } = fakeDb({ conversations: [{ id: CONV }] }, { errorOn: ["document_requests"] });
    const errors: string[] = [];
    const page = await listContactTimelinePage(db, u(100), u(99), undefined, { onError: (s) => errors.push(s) });
    expect(page.failed).toEqual(["documents"]);
    expect(errors).toEqual(["documents"]);
  });

  it("a refused read of the skip relation fails the documents source too, not a swallowed empty (S-07 2c; mutation: .catch(() => ({ skips: [], unskips: [] })) on listDocumentSkipTimeline -> FAILS)", async () => {
    const { db } = fakeDb({ conversations: [{ id: CONV }] }, { errorOn: ["document_requirement_skips"] });
    const errors: string[] = [];
    const page = await listContactTimelinePage(db, u(100), u(99), undefined, { onError: (s) => errors.push(s) });
    expect(page.failed).toEqual(["documents"]);
    expect(errors).toEqual(["documents"]);
  });

  it("a refused read of the share-link relation fails the documents source too, not a swallowed empty (S-07 3b; mutation: .catch(() => ({ shares: [], opens: [] })) on listDocumentShareTimeline -> FAILS)", async () => {
    const { db } = fakeDb({ conversations: [{ id: CONV }] }, { errorOn: ["document_share_timeline"] });
    const errors: string[] = [];
    const page = await listContactTimelinePage(db, u(100), u(99), undefined, { onError: (s) => errors.push(s) });
    expect(page.failed).toEqual(["documents"]);
    expect(errors).toEqual(["documents"]);
  });

  it("a refused read of the new-version relation fails the documents source too, not a swallowed empty (owner ruling R2; mutation: .catch(() => []) on listDocumentVersionTimeline -> FAILS)", async () => {
    const { db } = fakeDb({ conversations: [{ id: CONV }] }, { errorOn: ["document_version_timeline"] });
    const errors: string[] = [];
    const page = await listContactTimelinePage(db, u(100), u(99), undefined, { onError: (s) => errors.push(s) });
    expect(page.failed).toEqual(["documents"]);
    expect(errors).toEqual(["documents"]);
  });
});

// ---------------------------------------------------------------------------------------------
// Timeline paging bug fix: contact_archive_log (0103) and contact_merges (0106) use a BIGINT id.
// Before the fix, ANY page whose cursor came from a uuid-id source (a note, here) sent
// `id.lt.<uuid>` to these two bigint tables, which PostgREST refuses — and `listTimelinePage`'s
// `settle` swallows that error, so the archive/merge rows silently vanished from the page. These
// tests exercise the real merge (`listContactTimelinePage`), not just the filter-string unit tests
// in timeline-cursor.test.ts.
// ---------------------------------------------------------------------------------------------
describe("the archive and merge sources: bigint ids page past a cursor from ANY source (0103, 0106; regression)", () => {
  it("a note-cursor page still returns an archive row at the SAME instant the note was shown at — never skipped — and the filter sent to contact_archive_log carries no uuid (mutation: revert to the raw `id: String(r.id)` + timelineBeforeFilter -> the next assertion's exact filter string no longer matches, FAILS)", async () => {
    const T = day(5);
    // The note's id is lexically the largest possible id, so it wins the same-instant tie and is
    // the ONLY row on a limit-1 page 1 — leaving the archive row, at the identical instant, unshown.
    const dominantNoteId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const { db } = fakeDb({ notes: [{ ...noteRow(dominantNoteId, T) }], contact_archive_log: [archiveRow(1, T)] });
    const p1 = await listContactTimelinePage(db, u(100), u(99), undefined, { limit: 1 });
    expect(p1.items.map((i) => i.kind)).toEqual(["note"]);
    expect(p1.older).toEqual({ v: T, id: dominantNoteId });

    const { db: db2, reads } = fakeDb({ contact_archive_log: [archiveRow(1, T)] });
    const p2 = await listContactTimelinePage(db2, u(100), u(99), p1.older!, { limit: 1 });
    expect(p2.items.map((i) => i.kind)).toEqual(["archive"]);
    expect(decodeBigintCursorId("archive", p2.items[0]!.id)).toBe(1);
    const archiveRead = reads.find((r) => r.table === "contact_archive_log");
    expect(archiveRead?.or).toBe(`created_at.lt."${T}",created_at.eq."${T}"`);
    expect(archiveRead?.or).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it("a note-cursor page returns merge rows strictly older than the cursor, with no uuid sent to contact_merges either (mutation: same as above, for the merge source -> FAILS)", async () => {
    const T2 = day(6);
    const T1 = day(3);
    const { db } = fakeDb({ notes: [noteRow(u(1), T2)], contact_merges: [mergeRow(1, T1)] });
    const p1 = await listContactTimelinePage(db, u(100), u(99), undefined, { limit: 1 });
    expect(p1.items.map((i) => i.kind)).toEqual(["note"]);

    const { db: db2, reads } = fakeDb({ contact_merges: [mergeRow(1, T1)] });
    const p2 = await listContactTimelinePage(db2, u(100), u(99), p1.older!, { limit: 1 });
    expect(p2.items.map((i) => i.kind)).toEqual(["merge"]);
    expect(decodeBigintCursorId("merge", p2.items[0]!.id)).toBe(1);
    const mergedAtRead = reads.filter((r) => r.table === "contact_merges")[0];
    expect(mergedAtRead?.or).toBe(`merged_at.lt."${T2}",merged_at.eq."${T2}"`);
    expect(mergedAtRead?.or).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it("a page ending on an archive row produces a cursor the very next, archive-only page accepts and continues correctly (mutation: encode without the per-source tag -> decodeBigintCursorId would still work for THIS test alone; the real catch is timeline-cursor.test.ts's cross-source test — this one pins the exact (col, id) tie-break filter instead, mutation: widen id.lt to id.lte -> row 1 repeats, FAILS)", async () => {
    const T2 = day(6);
    const T1 = day(3);
    const { db } = fakeDb({ contact_archive_log: [archiveRow(1, T1), archiveRow(2, T2)] });
    const p1 = await listContactTimelinePage(db, u(100), u(99), undefined, { limit: 1 });
    expect(p1.items.map((i) => i.kind)).toEqual(["archive"]);
    expect(decodeBigintCursorId("archive", p1.items[0]!.id)).toBe(2);
    expect(p1.older).not.toBeNull();

    const { db: db2, reads } = fakeDb({ contact_archive_log: [archiveRow(1, T1), archiveRow(2, T2)] });
    const p2 = await listContactTimelinePage(db2, u(100), u(99), p1.older!, { limit: 1 });
    expect(p2.items.map((i) => i.kind)).toEqual(["archive"]);
    expect(decodeBigintCursorId("archive", p2.items[0]!.id)).toBe(1);
    expect(p2.older).toBeNull();
    const archiveRead = reads.find((r) => r.table === "contact_archive_log");
    expect(archiveRead?.or).toBe(`created_at.lt."${T2}",and(created_at.eq."${T2}",id.lt.2)`);
  });

  it("a page ending on a mergeUndone row produces a cursor the next page accepts, and continues on to that SAME underlying merge's own `merge` (merged_at) row — neither duplicated nor skipped (mutation: drop the per-source tag so `merge`'s decode also matches a change id with the same number -> the exact tie-break would still apply here by coincidence; this test's real catch is the id.lt boundary itself, mutation: use id.lte on the undone_at leg -> the mergeUndone row repeats on page 2, FAILS)", async () => {
    // One merge, undone much later: the SAME row contributes a "merge" entry at merged_at (old)
    // and a "mergeUndone" entry at undone_at (new) — the newest thing on the whole timeline.
    const mergedAt = day(2);
    const undoneAt = day(9);
    const { db } = fakeDb({ contact_merges: [mergeRow(5, mergedAt, undoneAt)] });
    const p1 = await listContactTimelinePage(db, u(100), u(99), undefined, { limit: 1 });
    expect(p1.items.map((i) => i.kind)).toEqual(["mergeUndone"]);
    expect(decodeBigintCursorId("merge", p1.items[0]!.id)).toBe(5);
    expect(p1.older).not.toBeNull();

    const { db: db2 } = fakeDb({ contact_merges: [mergeRow(5, mergedAt, undoneAt)] });
    const p2 = await listContactTimelinePage(db2, u(100), u(99), p1.older!, { limit: 1 });
    expect(p2.items.map((i) => i.kind)).toEqual(["merge"]);
    expect(decodeBigintCursorId("merge", p2.items[0]!.id)).toBe(5);
    expect(p2.older).toBeNull();
  });

  it("the merge row's OWN mergeId (the real decimal id, for the Undo button) is untouched by the entry's own encoded cursor id — they are separate fields (mutation: encode mergeId too -> Number(mergeId) would NaN, FAILS)", async () => {
    const { db } = fakeDb({ contact_merges: [mergeRow(7, day(2))] });
    const page = await listContactTimelinePage(db, u(100), u(99));
    const entry = page.items.find((i) => i.kind === "merge");
    expect(entry).toBeDefined();
    expect((entry as { merge: { mergeId: string } }).merge.mergeId).toBe("7");
    expect(Number((entry as { merge: { mergeId: string } }).merge.mergeId)).toBe(7);
  });
});

describe("listPeopleNames over a fake client (spec §6, Names)", () => {
  it("name, else email; asks once per distinct id; an unknown id is absent (mutation: return the email even when a name exists -> FAILS)", async () => {
    const { db, reads } = fakeDb({ users: [
      { clerk_user_id: "user_a", name: "Dan López", email: "a@example.com" },
      { clerk_user_id: "user_b", name: null, email: "b@example.com" },
      { clerk_user_id: "user_c", name: "   ", email: "c@example.com" },
    ] });
    expect(await listPeopleNames(db, ["user_a", "user_b", "user_c", "user_gone", "user_a", ""]))
      .toEqual({ user_a: "Dan López", user_b: "b@example.com", user_c: "c@example.com" });
    expect(reads[0]?.in).toEqual(["clerk_user_id", ["user_a", "user_b", "user_c", "user_gone"]]);
  });

  it("asks nothing for no ids, and throws on a read error (mutation: swallow the error -> FAILS)", async () => {
    const none = fakeDb({});
    expect(await listPeopleNames(none.db, [])).toEqual({});
    expect(none.reads).toEqual([]);
    await expect(listPeopleNames(fakeDb({}, { errorOn: ["users"] }).db, ["user_a"])).rejects.toThrow(/users refused/);
  });
});
