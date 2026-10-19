import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Proposal, WorkRow } from "@bis/db";
import { bucketWork, type BucketedWork } from "@/lib/work/buckets";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";
import { visibleBuckets, WorkList } from "./work-list";

// --- Mocks for the TasksPage composition tests below (the "zone reaches the
// page" and "rethrow" findings need the whole route, not just WorkList in
// isolation). Same shape as calls/page.test.ts's mocks: the auth gate and the
// DB entry points this async server component actually reaches, rather than
// exercising Clerk/Supabase for what is a "which value reaches render" bug.
/** Mutable so the client-vs-agency split in the zone note can be exercised
 *  on the REAL route rather than only on the component in isolation — the
 *  Settings link must never reach a client, and this page is one of the
 *  three a client can actually open. */
let isAgency = true;
/** F-085 part 1: the caller's role, for ?who= (null keeps every older test's agency/plain-client caller). */
let role: "owner" | "staff" | "technician" | null = null;
vi.mock("@/lib/auth", () => ({
  requireAccountAccess: async () => ({ userId: "user_1", isAgency, role }),
}));
// Task 12: the page now resolves its own render locale (for the held-emails
// row's words) the same way conversations/page.tsx already does.
vi.mock("@/lib/preferences/person-prefs", () => ({ getPersonPrefs: async () => ({ language: null, theme: null }) }));

/** Mutable so each test can pick the account's own (possibly invalid) zone
 *  without a fresh `vi.mock` per test — assigned in `beforeEach` before the
 *  dynamic `import("./page")` below ever resolves this factory. */
let accountTimezone = "America/Chicago";
// Fix-wave Important 3 (task-11-brief): the pending-proposals read added by
// this task issues two MORE reads through this same fake — the contacts
// lookup already existed (`in`, below) but was never exercised with a
// non-empty result, and `pipeline_stages` is new. Table-branched, same
// shape as work/page.test.ts's own `FAKE_DB` — the accounts read is the
// only one that needs `maybeSingle`; the other two share `.eq().in()`.
const contactsInMock = vi.fn<
  (...args: unknown[]) => Promise<{ data: unknown[] | null; error: unknown }>
>(async () => ({ data: [], error: null }));
const pipelineStagesInMock = vi.fn<
  (...args: unknown[]) => Promise<{ data: unknown[] | null; error: unknown }>
>(async () => ({ data: [], error: null }));
vi.mock("@/lib/db", () => ({
  dbForRequest: async () => ({
    from: (table: string) => {
      if (table === "pipeline_stages") {
        return { select: () => ({ eq: () => ({ in: (...args: unknown[]) => pipelineStagesInMock(...args) }) }) };
      }
      if (table === "contacts") {
        return { select: () => ({ eq: () => ({ in: (...args: unknown[]) => contactsInMock(...args) }) }) };
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { timezone: accountTimezone }, error: null }),
            in: async () => ({ data: [], error: null }),
          }),
        }),
      };
    },
  }),
}));

// Task 7 fix round 1 (I3): the task picker is a client component whose own
// behaviour is tested in components/assign/assign.test.ts; here only what a
// row HANDS it is pinned (the raw task id, this account), so it is captured.
const taskFieldProps = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock("@/components/assign/assignee-field", async () => {
  const { createElement: h } = await import("react");
  return {
    TaskAssigneeField: (p: Record<string, unknown>) => {
      taskFieldProps.push(p);
      return h("span", { "data-task-assignee": String(p.taskId) });
    },
  };
});

let workRows: WorkRow[] = [];
/** This account's own pending proposals (Important 3) — defaults to none so
 *  every pre-existing test below is unaffected by this mock's addition. A
 *  real `vi.fn()` (not a bare closure, unlike `listAccountWork` above) so
 *  the "degrades on failure" test can override it with a rejection for
 *  exactly one call. */
let pendingProposals: Proposal[] = [];
const listPendingProposalsMock = vi.fn(async (): Promise<Proposal[]> => pendingProposals);
/** The agency's own zone, as `lib/zone.ts` reads it through `serviceDb`.
 *  Only `serviceDb` and `listAccountWork` are stubbed — `resolveZone` stays
 *  REAL, so these tests exercise the actual chain (account -> agency -> UTC)
 *  rather than a re-implementation of it. */
let agencyTimezone: string | null = "America/Chicago";
/** F-085 part 1: spied so the ?who= tests can read what the page asked for. */
const listAccountWorkMock = vi.fn<(...a: unknown[]) => Promise<WorkRow[]>>(async () => workRows);
const readPersonIdMock = vi.fn<(...a: unknown[]) => Promise<string | null>>(async () => "p-me");
const listAccountTeamMock = vi.fn<(...a: unknown[]) => Promise<unknown[]>>(async () => []);
/** Task 12: this account's own held-email count — mutable per test, and a
 *  real mock (never the real `countHeldInboundEmails`, whose own two
 *  chained `.eq()` calls this file's `@/lib/db` fake does not support). */
let heldEmailsCount: number | null = 0;
const countHeldInboundEmailsMock = vi.fn(async (): Promise<number> => {
  if (heldEmailsCount === null) throw new Error("held count read failed");
  return heldEmailsCount;
});
vi.mock("@bis/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@bis/db")>();
  return {
    ...actual,
    listAccountWork: (...args: unknown[]) => listAccountWorkMock(...args),
    listPendingProposals: () => listPendingProposalsMock(),
    readPersonId: (...args: unknown[]) => readPersonIdMock(...args),
    listAccountTeam: (...args: unknown[]) => listAccountTeamMock(...args),
    countHeldInboundEmails: () => countHeldInboundEmailsMock(),
    serviceDb: () => ({
      from: () => ({
        select: () => ({
          limit: () => ({
            maybeSingle: async () => ({
              data: agencyTimezone === null ? null : { timezone: agencyTimezone },
              error: null,
            }),
          }),
        }),
      }),
    }),
  };
});

/** Flips `formatDateInZone` (and ONLY that export — everything else is the
 *  real module) into throwing a non-`RangeError` for exactly one test, to
 *  prove the rethrow-on-programming-error path without ever needing an
 *  input that could naturally produce one. */
let forceFormatError = false;
vi.mock("@/lib/format", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/format")>();
  return {
    ...actual,
    formatDateInZone: (iso: string, timeZone: string) => {
      if (forceFormatError) throw new TypeError("boom: not a RangeError");
      return actual.formatDateInZone(iso, timeZone);
    },
  };
});

function conversationRow(overrides: Partial<WorkRow> = {}): WorkRow {
  return {
    id: "conversation:1", source: "conversation", accountId: "a", contactId: "c1",
    title: "", dueAt: null, occurredAt: "2026-09-10T00:00:00Z",
    ...overrides,
  };
}

function taskRow(overrides: Partial<WorkRow> = {}): WorkRow {
  return {
    id: "task:1", source: "task", accountId: "a", contactId: "c1",
    title: "Call about the estimate", dueAt: "2026-09-14T11:00:00Z", occurredAt: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

function bookingRow(overrides: Partial<WorkRow> = {}): WorkRow {
  return {
    id: "booking:1", source: "booking", accountId: "a", contactId: "c1",
    title: "", dueAt: null, occurredAt: "2026-09-05T00:00:00Z",
    ...overrides,
  };
}

/** Fix-wave Important 3 — a pending proposal fixture for the composition
 *  tests below, same shape as work/page.test.ts's own `proposal()`. */
function proposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: "prop-1", accountId: "acct1", callId: "call-1", contactId: null,
    kind: "task", payload: { title: "Call back", dueAt: null },
    evidence: "the caller asked for a callback", status: "pending",
    decidedAt: null, decidedBy: null, createdAt: "2026-09-01T00:00:00Z",
    source: "call", evidenceRef: {}, evidenceLang: "en", expiredReason: null, appliedPayload: null, appliedRef: null, undoneAt: null, undoneBy: null, expiresAt: "2026-10-01T00:00:00Z",
    ...overrides,
  } as Proposal;
}

/**
 * The brief's Step 2 test asserted a `.filter()` written two lines above it
 * in the SAME test, never importing the page or the list — it could not
 * fail when the screen regressed to rendering an empty heading. This tests
 * the real, exported pure helper the component actually renders from
 * instead (danlo's resolution #1). The brief's own fixture used
 * `source: "call"`, which no longer typechecks — WorkSource dropped that
 * source before implementation (packages/db/src/work-queue.ts's own doc
 * comment) — so this uses a live source (`conversation`) to exercise the
 * same shape: exactly one bucket populated, out of three possible.
 */
describe("visibleBuckets", () => {
  it("omits a bucket with no rows rather than rendering an empty heading", () => {
    const b = bucketWork([conversationRow()], new Date("2026-09-14T14:00:00Z"), "America/Chicago");
    expect(visibleBuckets(b)).toEqual(["waiting"]);
  });

  it("is empty when the whole queue is empty", () => {
    const b = bucketWork([], new Date("2026-09-14T14:00:00Z"), "America/Chicago");
    expect(visibleBuckets(b)).toEqual([]);
  });

  it("orders overdue, then today, then waiting — never the reverse", () => {
    const overdueTask = taskRow({ id: "task:overdue", dueAt: "2026-09-01T00:00:00Z" });
    const todayTask = taskRow({ id: "task:today", dueAt: "2026-09-14T11:00:00Z" });
    const b = bucketWork(
      [conversationRow(), overdueTask, todayTask],
      new Date("2026-09-14T14:00:00Z"),
      "America/Chicago",
    );
    expect(visibleBuckets(b)).toEqual(["overdue", "today", "waiting"]);
  });
});

const NOW = new Date("2026-09-14T14:00:00Z");
const ZONE = "America/Chicago";
const ACCOUNT_ID = "acct1";

function renderList(
  buckets: BucketedWork,
  contactNames: Record<string, string> = {},
  timezone: string = ZONE,
) {
  return renderToStaticMarkup(
    createElement(WorkList, { buckets, accountId: ACCOUNT_ID, contactNames, timezone }),
  );
}

describe("WorkList", () => {
  it("renders the whole-queue-empty sentence, and nothing else, when there is no work", () => {
    const b = bucketWork([], NOW, ZONE);
    const html = renderList(b);
    expect(html).toContain(m["work.empty"]);
    // DESIGN.md rule 5: an empty state sells the feature — one sentence of
    // what appears here — not just a bare announcement of emptiness.
    expect(html).toContain(m["work.empty.body"]);
    expect(html).not.toContain(m["work.bucket.overdue"]);
    expect(html).not.toContain(m["work.bucket.today"]);
    expect(html).not.toContain(m["work.bucket.waiting"]);
  });

  it("renders only the Waiting heading when only Waiting has rows", () => {
    const b = bucketWork([conversationRow({ contactId: "c1" })], NOW, ZONE);
    const html = renderList(b, { c1: "Maria Garcia" });
    // Pinned to the HEADING ELEMENT itself, not a bare string — the per-row
    // status chip (work-list.tsx's BUCKET_TREATMENT) renders the exact same
    // "Waiting" text, so `toContain(m["work.bucket.waiting"])` alone stays
    // green even if the <h2> is deleted outright.
    expect(html).toMatch(new RegExp(`<h2[^>]*>${m["work.bucket.waiting"]}</h2>`));
    expect(html).not.toContain(m["work.bucket.overdue"]);
    expect(html).not.toContain(m["work.bucket.today"]);
  });

  it("shows status as a dot plus a word, never color alone", () => {
    const b = bucketWork([conversationRow({ contactId: "c1" })], NOW, ZONE);
    const html = renderList(b, { c1: "Maria Garcia" });
    expect(html).toContain("size-[7px] rounded-full");
    // Pinned to the CHIP's own <span data-slot="badge"> — the section
    // heading above renders this exact same "Waiting" text, so
    // `toContain(m["work.bucket.waiting"])` alone stayed green even after
    // the word was deleted from the chip outright, leaving only the dot.
    expect(html).toMatch(
      new RegExp(`<span data-slot="badge"[^>]*>.*?</span>${m["work.bucket.waiting"]}</span>`),
    );
  });

  it("names the contact on a conversation row via work.conversation", () => {
    const b = bucketWork([conversationRow({ contactId: "c1" })], NOW, ZONE);
    const html = renderList(b, { c1: "Maria Garcia" });
    expect(html).toContain("Reply to Maria Garcia");
  });

  it("shows a task's own human-written title verbatim, not a template", () => {
    const b = bucketWork([taskRow({ dueAt: "2026-09-01T00:00:00Z" })], NOW, ZONE);
    const html = renderList(b, { c1: "Maria Garcia" });
    expect(html).toContain("Call about the estimate");
  });

  it("asks the booking question and still names the person as context", () => {
    const b = bucketWork([bookingRow({ contactId: "c1" })], NOW, ZONE);
    const html = renderList(b, { c1: "Maria Garcia" });
    expect(html).toContain(m["work.booking"]);
    expect(html).toContain("Maria Garcia");
  });

  it("falls back to a plain label, never a raw id or the word 'undefined', for a contact missing from the map", () => {
    const b = bucketWork([bookingRow({ contactId: "missing-id" })], NOW, ZONE);
    const html = renderList(b, {}); // no entry for "missing-id"
    // The id legitimately appears in the row's own href (real navigation to
    // that contact) — what must never happen is the id, or "undefined",
    // standing in for the DISPLAYED name as text content.
    expect(html).not.toMatch(/>[^<]*missing-id[^<]*</);
    expect(html).not.toMatch(/>[^<]*undefined[^<]*</);
    expect(html).toContain(m["contact.noName"]);
  });

  it("links a row with a contact to that contact's page", () => {
    const b = bucketWork([conversationRow({ contactId: "c1" })], NOW, ZONE);
    const html = renderList(b, { c1: "Maria Garcia" });
    expect(html).toContain(`href="/dashboard/accounts/${ACCOUNT_ID}/contacts/c1"`);
  });

  it("does not link a contact-less row anywhere", () => {
    const b = bucketWork([taskRow({ contactId: null, dueAt: "2026-09-01T00:00:00Z" })], NOW, ZONE);
    const html = renderList(b, {});
    expect(html).not.toMatch(/<a\b/);
  });

  it("stamps the row's date in the ACCOUNT's zone, not the server's", () => {
    // Two zones, one instant — same trap `calls-table.test.ts` and
    // `format.test.ts` both record: a fixture zone equal to the dev
    // machine's zone cannot tell "formatted in the account zone" apart from
    // "formatted in whatever zone this process happens to be in". 01:00 UTC
    // is still the previous day in Chicago (format.test.ts's own boundary).
    const row = taskRow({ dueAt: "2026-09-04T01:00:00Z" });
    const b = bucketWork([row], NOW, ZONE);
    const chicago = renderList(b, { c1: "Maria Garcia" }, "America/Chicago");
    expect(chicago).toContain("Sep 3, 2026");
    const utc = renderList(b, { c1: "Maria Garcia" }, "UTC");
    expect(utc).toContain("Sep 4, 2026");
  });

  it("renders no date at all for the epoch-sentinel timestamp a conversation with no last_message_at carries", () => {
    // packages/db/src/work-queue.ts:71 falls back to `new Date(0).toISOString()`
    // when a conversation's `last_message_at` is null — genuinely reachable in
    // production (messaging.ts's conversation touch is best-effort and the
    // unread-increment path never sets that column). "Jan 1, 1970" (or, in a
    // negative-offset zone, "Dec 31, 1969") would read as a real date, not
    // "unknown" — so this row must print no date at all instead.
    const row = conversationRow({ contactId: "c1", occurredAt: new Date(0).toISOString() });
    const b = bucketWork([row], NOW, ZONE);
    const html = renderList(b, { c1: "Maria Garcia" });
    expect(html).not.toMatch(/19(69|70)/);
    // Positive half (review finding: negative-only stays green even if the
    // row stopped rendering at all) — the row is still HERE, sentence and
    // all, just with no date text next to it.
    expect(html).toContain("Reply to Maria Garcia");
  });

  it("also declines a non-canonical spelling of the same epoch instant, not just the exact sentinel string", () => {
    // `new Date(0).toISOString()` is "1970-01-01T00:00:00.000Z" exactly — a
    // string-equality guard would let "1970-01-01T00:00:00Z" (same instant,
    // no milliseconds) through and print "Dec 31, 1969" in Chicago. Not
    // reachable from today's schema (work-queue.ts only ever writes the
    // canonical form or a real `last_message_at`), but matching the parsed
    // instant instead of one exact string closes it for free.
    const row = conversationRow({ contactId: "c1", occurredAt: "1970-01-01T00:00:00Z" });
    const b = bucketWork([row], NOW, ZONE);
    const html = renderList(b, { c1: "Maria Garcia" });
    expect(html).not.toMatch(/19(69|70)/);
    expect(html).toContain("Reply to Maria Garcia");
  });

  it("rethrows a non-RangeError from the format path instead of swallowing it into a permanently blank cell", () => {
    // The bucketing function this screen mirrors (`bucketWork`) narrows its
    // own two `catch` blocks the same way: rethrow anything that is not a
    // `RangeError`. A bare `catch {}` here would instead turn a real bug in
    // `formatDateInZone` into a silently blank date on every row, forever.
    forceFormatError = true;
    try {
      const b = bucketWork([taskRow({ dueAt: "2026-09-01T00:00:00Z" })], NOW, ZONE);
      expect(() => renderList(b, { c1: "Maria Garcia" })).toThrow(TypeError);
    } finally {
      forceFormatError = false;
    }
  });
});

/**
 * THIS BLOCK USED TO ASSERT THE OPPOSITE, and the inversion is the point.
 *
 * It previously pinned "an invalid account zone omits the row's date, never
 * guesses it" — the work queue's half of the timezone defect. The other four
 * screens clamped silently to UTC; this one went quiet. danlo settled it on
 * 2026-09-17: "I do not want to omit the dates so let's find a workaround."
 * The workaround is `resolveZone` — the date always renders, and the screen
 * NAMES the zone it is in, so nothing is guessed silently and nothing is
 * withheld. These tests pin the new contract at the same strength.
 */
describe("TasksPage — an unusable account zone is named, never silently guessed and never omitted", () => {
  beforeEach(() => {
    accountTimezone = "America/Chicago";
    agencyTimezone = "America/Chicago";
    isAgency = true;
    workRows = [];
    pendingProposals = [];
    listPendingProposalsMock.mockReset().mockImplementation(async () => pendingProposals);
    contactsInMock.mockReset().mockResolvedValue({ data: [], error: null });
    pipelineStagesInMock.mockReset().mockResolvedValue({ data: [], error: null });
  });

  it("renders the date AND names the agency's zone when the account's own is unusable (mutation: drop the agency step from resolveZone so it falls to UTC -> date moves to Sep 1 and the note names UTC -> FAILS)", async () => {
    // 2026-09-01T00:00:00Z is 2026-08-31 19:00 in America/Chicago. Picking an
    // instant that lands on a DIFFERENT CALENDAR DAY in the two candidate
    // zones is what makes this test able to fail: if the agency step were
    // dropped and this fell through to UTC, the rendered date would move.
    // A fixture zone that agreed with UTC would assert nothing.
    accountTimezone = "Not/AZone";
    agencyTimezone = "America/Chicago";
    workRows = [taskRow({ contactId: null, dueAt: "2026-09-01T00:00:00Z" })];
    const { default: TasksPage } = await import("./page");
    const html = renderToStaticMarkup(
      await TasksPage({ params: Promise.resolve({ accountId: "acct1" }) }),
    );

    // The date is PRESENT — the omission is gone — and it is the agency
    // zone's day, not UTC's.
    expect(html).toContain("Aug 31, 2026");
    expect(html).not.toContain("Sep 1, 2026");
    // THE CHIP AGREES WITH THE DATE. `bucketWork` must run in the same
    // resolved zone the row's date is formatted in: bucketed in the raw
    // (unusable) zone it degrades to "every row waits", so this row would
    // render "Aug 31, 2026" — eighteen days past due — beside a chip saying
    // Waiting. That self-contradiction inside one row is exactly what
    // sharing one zone exists to prevent.
    expect(renderedText(html)).toContain(m["work.bucket.overdue"]);
    expect(renderedText(html)).not.toContain(m["work.bucket.waiting"]);
    // …and the screen says which zone that is.
    expect(renderedText(html)).toContain(m["zone.note"].replace("{zone}", "America/Chicago"));
    // DESIGN.md rule 3 — the marker is a WORD, not a colour.
    expect(renderedText(html)).toContain(m["zone.guessed.agency"]);
  });

  it("falls to UTC and says so when the agency's zone is unusable too (mutation: label the fallback 'America/Chicago' -> FAILS)", async () => {
    accountTimezone = "Not/AZone";
    agencyTimezone = "Also/Broken";
    workRows = [taskRow({ contactId: null, dueAt: "2026-09-01T00:00:00Z" })];
    const { default: TasksPage } = await import("./page");
    const html = renderToStaticMarkup(
      await TasksPage({ params: Promise.resolve({ accountId: "acct1" }) }),
    );

    expect(html).toContain("Sep 1, 2026");
    expect(renderedText(html)).toContain(m["zone.note"].replace("{zone}", "UTC"));
    // The fallback sentence names BOTH broken settings, which is the whole
    // reason `source` is separate from `guessed`.
    expect(renderedText(html)).toContain(m["zone.guessed.fallback"]);
    expect(renderedText(html)).not.toContain(m["zone.guessed.agency"]);
  });

  it("a correctly-configured account is NOT labelled a guess (mutation: key guessed on 'did we end up at UTC' instead of on whose value was used -> FAILS)", async () => {
    // The account's own zone IS UTC, and that is a configured choice, not a
    // guess. `resolveZone` keys `guessed` on WHOSE value was used precisely
    // so this account is not slandered.
    accountTimezone = "UTC";
    agencyTimezone = "America/Chicago";
    workRows = [taskRow({ contactId: null, dueAt: "2026-09-01T00:00:00Z" })];
    const { default: TasksPage } = await import("./page");
    const html = renderToStaticMarkup(
      await TasksPage({ params: Promise.resolve({ accountId: "acct1" }) }),
    );

    // Named, as every screen now names its zone…
    expect(renderedText(html)).toContain(m["zone.note"].replace("{zone}", "UTC"));
    // …but NOT accused of guessing.
    expect(renderedText(html)).not.toContain(m["zone.guessed.fallback"]);
    expect(renderedText(html)).not.toContain(m["zone.guessed.agency"]);
    expect(renderedText(html)).not.toContain(m["zone.guessed.fix"]);
  });

  it("never offers a CLIENT the Settings link — that route is agency-only (mutation: drop the isAgency branch in ZoneNote -> FAILS)", async () => {
    // Settings is `requireAgencyOnlyAccountAccess`. A client who followed
    // this link would be redirected straight back to their dashboard, so the
    // sentence has to name a person to ask instead.
    accountTimezone = "Not/AZone";
    agencyTimezone = "America/Chicago";
    isAgency = false;
    workRows = [taskRow({ contactId: null, dueAt: "2026-09-01T00:00:00Z" })];
    const { default: TasksPage } = await import("./page");
    const html = renderToStaticMarkup(
      await TasksPage({ params: Promise.resolve({ accountId: "acct1" }) }),
    );

    expect(renderedText(html)).toContain(m["zone.guessed.client"]);
    expect(renderedText(html)).not.toContain(m["zone.guessed.fix"]);
    expect(html).not.toContain("/settings");
    // The date still renders for a client — the whole point.
    expect(html).toContain("Aug 31, 2026");
  });
});

/**
 * Fix-wave Important 3 (task-11-brief): "Both audiences see both surfaces"
 * — the spec's own words. The agency's cross-tenant work queue already
 * rendered pending proposals; `listPendingProposals` (packages/db's own
 * per-account accessor, written and tested for exactly this) had no caller
 * anywhere until this task. A client who never opens a specific call never
 * learns a suggestion exists.
 */
describe("TasksPage — pending proposals (Important 3)", () => {
  beforeEach(() => {
    accountTimezone = "America/Chicago";
    agencyTimezone = "America/Chicago";
    isAgency = true;
    workRows = [];
    pendingProposals = [];
    listPendingProposalsMock.mockReset().mockImplementation(async () => pendingProposals);
    contactsInMock.mockReset().mockResolvedValue({ data: [], error: null });
    pipelineStagesInMock.mockReset().mockResolvedValue({ data: [], error: null });
  });

  it("renders a pending proposal in its own suggestions section", async () => {
    pendingProposals = [proposal()];
    const { default: TasksPage } = await import("./page");
    const html = renderToStaticMarkup(
      await TasksPage({ params: Promise.resolve({ accountId: "acct1" }) }),
    );
    expect(html).toContain(m["proposals.work.heading"]);
    expect(renderedText(html)).toContain("the caller asked for a callback");
  });

  it("renders no suggestions section when there are no pending proposals", async () => {
    const { default: TasksPage } = await import("./page");
    const html = renderToStaticMarkup(
      await TasksPage({ params: Promise.resolve({ accountId: "acct1" }) }),
    );
    expect(html).not.toContain(m["proposals.work.heading"]);
  });

  // Mirrors work/page.test.ts's own identically-named test: a real bucketed
  // task ("Call about the estimate") sits beside a genuinely distinct
  // proposal, and the waiting section's own row COUNT — never a content
  // grep — proves the proposal never contaminated `buckets.waiting`.
  it("keeps the waiting section's own <li> count exactly at the real bucketed rows, even with a distinct proposal rendered alongside it (mutation: concat proposal-derived rows into the bucketed rows before rendering -> FAILS)", async () => {
    // Well beyond any realistic "today" in America/Chicago, regardless of
    // when this suite happens to run — a fixture close to "now" (as this
    // test's own first draft used) can collapse to TODAY once converted
    // from UTC midnight into a negative-offset zone, landing in the wrong
    // bucket and asserting nothing about the section this test names.
    workRows = [taskRow({ id: "task:1", contactId: null, dueAt: "2099-01-01T12:00:00Z" })];
    pendingProposals = [proposal({
      id: "prop-unique", payload: { title: "UNIQUE_TASK_TITLE_5678", dueAt: null },
      evidence: "UNIQUE_CALLER_QUOTE_1234",
    })];
    const { default: TasksPage } = await import("./page");
    const html = renderToStaticMarkup(
      await TasksPage({ params: Promise.resolve({ accountId: "acct1" }) }),
    );

    const waitingSection = html.match(/<section data-bucket="waiting"[\s\S]*?<\/section>/)?.[0] ?? "";
    expect((waitingSection.match(/<li[ >]/g) ?? []).length).toBe(1);
    expect(html).toContain("UNIQUE_TASK_TITLE_5678");
    expect(html).toContain("UNIQUE_CALLER_QUOTE_1234");
  });

  it("never claims the queue is clear when a pending proposal exists, even though the real to-do queue is empty", async () => {
    pendingProposals = [proposal()];
    const { default: TasksPage } = await import("./page");
    const html = renderToStaticMarkup(
      await TasksPage({ params: Promise.resolve({ accountId: "acct1" }) }),
    );
    expect(html).not.toContain(m["work.empty"]);
    expect(html).toContain(m["proposals.work.heading"]);
  });

  it("degrades to no suggestions section, not a broken page, when the proposals read fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    workRows = [taskRow({ id: "task:1", contactId: null, dueAt: "2026-09-20T00:00:00Z" })];
    listPendingProposalsMock.mockRejectedValueOnce(new Error("permission denied for table call_proposals"));
    const { default: TasksPage } = await import("./page");
    const html = renderToStaticMarkup(
      await TasksPage({ params: Promise.resolve({ accountId: "acct1" }) }),
    );

    expect(html).toContain("Call about the estimate");
    expect(html).not.toContain(m["proposals.work.heading"]);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("proposals read failed"));
    spy.mockRestore();
  });

  it("resolves an opportunity_stage proposal's real stage names via a scoped pipeline_stages read", async () => {
    pendingProposals = [proposal({
      kind: "opportunity_stage",
      payload: { opportunityId: "opp_1", fromStageId: "stage_1", toStageId: "stage_2" },
      evidence: "move this forward",
    })];
    pipelineStagesInMock.mockResolvedValueOnce({
      data: [
        { id: "stage_1", name: "New", position: 0 },
        { id: "stage_2", name: "Booked", position: 3 },
      ],
      error: null,
    });
    const { default: TasksPage } = await import("./page");
    const html = renderToStaticMarkup(
      await TasksPage({ params: Promise.resolve({ accountId: "acct1" }) }),
    );

    expect(html).toContain(
      m["proposals.stage.label"].replace("{from}", () => "New").replace("{to}", () => "Booked"),
    );
    expect(pipelineStagesInMock).toHaveBeenCalledTimes(1);
    expect(pipelineStagesInMock).toHaveBeenCalledWith("id", ["stage_1", "stage_2"]);
  });
});

// F-085 part 1 (spec §8-§9): Mine / Unassigned on To do, filtered on the
// server by listAccountWork.
describe("TasksPage — ?who= (Mine / Unassigned)", () => {
  beforeEach(() => {
    accountTimezone = "America/Chicago";
    agencyTimezone = "America/Chicago";
    isAgency = false;
    role = "staff";
    workRows = [];
    pendingProposals = [];
    listPendingProposalsMock.mockReset().mockImplementation(async () => pendingProposals);
    contactsInMock.mockReset().mockResolvedValue({ data: [], error: null });
    pipelineStagesInMock.mockReset().mockResolvedValue({ data: [], error: null });
    listAccountWorkMock.mockClear();
    readPersonIdMock.mockClear();
    listAccountTeamMock.mockClear();
  });
  afterEach(() => {
    isAgency = true;
    role = null;
  });
  async function render(searchParams: Record<string, string>) {
    const { default: TasksPage } = await import("./page");
    return renderToStaticMarkup(
      await TasksPage({ params: Promise.resolve({ accountId: "acct1" }), searchParams: Promise.resolve(searchParams) }),
    );
  }

  it("who=mine asks listAccountWork for the caller's own work (mutation: drop the assignee -> FAILS)", async () => {
    await render({ who: "mine" });
    expect(readPersonIdMock).toHaveBeenCalledWith(expect.anything(), "acct1", "user_1");
    expect(listAccountWorkMock).toHaveBeenCalledWith(expect.anything(), "acct1", { assignee: { who: "mine", userId: "p-me" } });
  });

  it("who=unassigned asks for Unassigned work, and no who is All", async () => {
    await render({ who: "unassigned" });
    expect(listAccountWorkMock).toHaveBeenLastCalledWith(expect.anything(), "acct1", { assignee: { who: "unassigned" } });
    await render({});
    expect(listAccountWorkMock).toHaveBeenLastCalledWith(expect.anything(), "acct1", { assignee: undefined });
  });

  it("Staff: the team is read for the task picker", async () => {
    await render({});
    expect(listAccountTeamMock).toHaveBeenCalledWith(expect.anything(), "acct1");
  });

  it("a Technician: no filter (RLS already makes the queue theirs), no team read, no users read (mutation: pass the filter for everyone -> FAILS)", async () => {
    role = "technician";
    await render({ who: "unassigned" });
    expect(listAccountWorkMock).toHaveBeenCalledWith(expect.anything(), "acct1", { assignee: undefined });
    expect(listAccountTeamMock).not.toHaveBeenCalled();
    expect(readPersonIdMock).not.toHaveBeenCalled();
  });

  it("the page still renders with no searchParams at all (older callers)", async () => {
    const { default: TasksPage } = await import("./page");
    await TasksPage({ params: Promise.resolve({ accountId: "acct1" }) });
    expect(listAccountWorkMock).toHaveBeenCalledWith(expect.anything(), "acct1", { assignee: undefined });
  });
});

// F-085 part 1 (spec §9, Task 7): To do's assignee picker, its filter row
// and the filtered empty states.
describe("WorkList — Assigned to on task rows (F-085)", () => {
  const ANA = { userId: "11111111-1111-4111-8111-111111111111", label: "Ana Ruiz", role: "staff" as const };
  const list = (rows: WorkRow[], canAssign: boolean) => {
    taskFieldProps.length = 0;
    return renderToStaticMarkup(createElement(WorkList, {
      buckets: bucketWork(rows, NOW, ZONE), accountId: ACCOUNT_ID, contactNames: {}, timezone: ZONE,
      canAssign, members: [ANA],
    }));
  };
  const rowOf = (html: string, text: string) => html.split("<li").slice(1).find((r) => r.includes(text)) ?? "";

  it("a task row hands TaskAssigneeField the task's RAW id, this account, its holder and the team (fix round 1, I3; mutation: taskId={row.id} -> FAILS)", () => {
    list([taskRow({ id: "task:t1", assigneeId: ANA.userId })], true);
    expect(taskFieldProps).toHaveLength(1);
    expect(taskFieldProps[0]).toMatchObject({ accountId: ACCOUNT_ID, taskId: "t1", value: ANA.userId, options: [ANA] });
  });

  it("an unassigned task hands value null, never undefined", () => {
    list([taskRow({ id: "task:t1", assigneeId: null })], true);
    expect(taskFieldProps[0]!.value).toBeNull();
  });

  it("without canAssign (a Technician) no row carries a picker (mutation: render it for everyone -> FAILS)", () => {
    list([taskRow({ id: "task:t1", assigneeId: ANA.userId })], false);
    expect(taskFieldProps).toHaveLength(0);
  });

  it("a conversation or booking row carries none: their holder is the customer's, set on the customer", () => {
    list([conversationRow(), bookingRow()], true);
    expect(taskFieldProps).toHaveLength(0);
  });

  it("the picker sits outside the row's link: a control inside an <a> is invalid and ambiguous", () => {
    const r = rowOf(list([taskRow({ id: "task:t1", assigneeId: ANA.userId })], true), "Call about the estimate");
    const picker = r.indexOf('data-task-assignee="t1"');
    expect(picker).toBeGreaterThan(-1);
    expect(picker).toBeGreaterThan(r.indexOf("</a>"));
  });
});

describe("WorkList — filtered empty states (F-085)", () => {
  const empty = (who: "all" | "mine" | "unassigned") => renderToStaticMarkup(createElement(WorkList, {
    buckets: bucketWork([], NOW, ZONE), accountId: ACCOUNT_ID, contactNames: {}, timezone: ZONE, who,
  }));

  it("an empty Mine says nothing is assigned to you yet (mutation: always 'Nothing needs you' -> FAILS)", () => {
    const html = empty("mine");
    expect(html).toContain(m["assign.empty.mine"]);
    expect(html).not.toContain(m["work.empty"]);
  });

  it("an empty Unassigned says everything has someone", () => {
    expect(renderedText(empty("unassigned"))).toContain(m["assign.empty.unassignedWork"]);
  });

  it("All keeps the queue's own empty sentence", () => {
    expect(empty("all")).toContain(m["work.empty"]);
  });
});

describe("TasksPage — the All · Mine · Unassigned row (F-085)", () => {
  const NAV = `aria-label="${m["assign.filter.label"]}"`;
  beforeEach(() => {
    accountTimezone = "America/Chicago";
    agencyTimezone = "America/Chicago";
    isAgency = false;
    workRows = [];
    pendingProposals = [];
    listPendingProposalsMock.mockReset().mockImplementation(async () => pendingProposals);
    contactsInMock.mockReset().mockResolvedValue({ data: [], error: null });
  });
  afterEach(() => {
    isAgency = true;
    role = null;
  });
  async function render(searchParams: Record<string, string>) {
    const { default: TasksPage } = await import("./page");
    return renderToStaticMarkup(
      await TasksPage({ params: Promise.resolve({ accountId: "acct1" }), searchParams: Promise.resolve(searchParams) }),
    );
  }

  it("Staff get the filter row, the current filter marked, its links back to this page (mutation: render it for nobody -> FAILS)", async () => {
    role = "staff";
    const html = await render({ who: "mine" });
    expect(html).toContain(NAV);
    const current = (html.match(/<a\b[^>]*aria-current="page"[^>]*>/g) ?? []);
    expect(current).toHaveLength(1);
    expect(current[0]).toContain(`href="/dashboard/accounts/acct1/tasks?who=mine"`);
    expect(html).toContain('href="/dashboard/accounts/acct1/tasks"');
  });

  it("an empty Mine reaches the list as its own empty state, under the filter row", async () => {
    role = "staff";
    const html = await render({ who: "mine" });
    expect(html).toContain(m["assign.empty.mine"]);
  });

  it("a Technician gets no filter row (mutation: render it for everyone -> FAILS)", async () => {
    role = "technician";
    expect(await render({})).not.toContain(NAV);
  });
});

// Task 12 (S-06 part 1): the page's own read of the inbox's "Needs a look"
// count, threaded into WorkList's own row.
describe("TasksPage — the held-emails row (Task 12)", () => {
  beforeEach(() => {
    accountTimezone = "America/Chicago";
    agencyTimezone = "America/Chicago";
    isAgency = true;
    role = null;
    workRows = [];
    pendingProposals = [];
    heldEmailsCount = 0;
    listPendingProposalsMock.mockReset().mockImplementation(async () => pendingProposals);
    contactsInMock.mockReset().mockResolvedValue({ data: [], error: null });
    pipelineStagesInMock.mockReset().mockResolvedValue({ data: [], error: null });
  });
  afterEach(() => {
    heldEmailsCount = 0;
  });

  it("a held count above zero reaches WorkList as its own row (mutation: drop heldEmails from the WorkList call -> FAILS)", async () => {
    heldEmailsCount = 3;
    const { default: TasksPage } = await import("./page");
    const html = renderToStaticMarkup(
      await TasksPage({ params: Promise.resolve({ accountId: "acct1" }) }),
    );
    expect(html).toContain("data-held-emails-row");
    expect(html).toContain(`href="/dashboard/accounts/acct1/conversations?view=held"`);
    expect(renderedText(html)).toContain("3 emails need a look");
  });

  it("a held count of zero renders no row at all", async () => {
    heldEmailsCount = 0;
    const { default: TasksPage } = await import("./page");
    const html = renderToStaticMarkup(
      await TasksPage({ params: Promise.resolve({ accountId: "acct1" }) }),
    );
    expect(html).not.toContain("data-held-emails-row");
  });

  it("a failed count read omits the row rather than taking the page down (rule 5; mutation: let the throw escape -> FAILS)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    heldEmailsCount = null;
    const { default: TasksPage } = await import("./page");
    const html = renderToStaticMarkup(
      await TasksPage({ params: Promise.resolve({ accountId: "acct1" }) }),
    );
    expect(html).not.toContain("data-held-emails-row");
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("held count read failed"));
    spy.mockRestore();
  });
});
