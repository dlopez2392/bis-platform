import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgencyWorkRow, CallProposal } from "@bis/db";
import type { AgencyBucketedWork } from "@/lib/work/agency-buckets";
import type { ResolvedStage } from "../accounts/[accountId]/calls/[callId]/proposals";
import { m } from "@/lib/messages";
import { visibleAgencyBuckets, AgencyWorkList, type AgencyProposal } from "./agency-work-list";

/** Flips `formatDateInZone` (and ONLY that export) into throwing a
 *  non-`RangeError` for exactly one test, matching tasks/work-list's own
 *  precedent for proving the rethrow-on-programming-error path. */
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

function row(overrides: Partial<AgencyWorkRow> = {}): AgencyWorkRow {
  return {
    id: "task:1", source: "task", accountId: "acct-a", contactId: null,
    title: "Call back", dueAt: null, occurredAt: "2026-09-01T00:00:00Z",
    brandName: "Rio Roofing", timezone: "America/Chicago", suppressed: false,
    ...overrides,
  };
}

function buckets(overrides: Partial<AgencyBucketedWork> = {}): AgencyBucketedWork {
  return { overdue: [], today: [], waiting: [], ...overrides };
}

function proposal(overrides: Partial<AgencyProposal> = {}): AgencyProposal {
  return {
    id: "prop-1", accountId: "acct-a", callId: "call-1", contactId: null,
    kind: "task", payload: { title: "Call back", dueAt: null },
    evidence: "the caller asked for a callback", status: "pending",
    decidedAt: null, decidedBy: null, createdAt: "2026-09-01T00:00:00Z",
    brandName: "Rio Roofing", timezone: "America/Chicago",
    ...overrides,
  } as AgencyProposal;
}

function renderList(
  b: AgencyBucketedWork,
  contactNames: Record<string, string> = {},
  proposals: AgencyProposal[] = [],
  stageNames: Record<string, ResolvedStage> = {},
) {
  return renderToStaticMarkup(
    createElement(AgencyWorkList, { buckets: b, contactNames, proposals, stageNames }),
  );
}

describe("visibleAgencyBuckets", () => {
  it("omits a bucket with no rows rather than rendering an empty heading", () => {
    expect(visibleAgencyBuckets(buckets({ waiting: [row()] }))).toEqual(["waiting"]);
  });

  it("is empty when the whole queue is empty", () => {
    expect(visibleAgencyBuckets(buckets())).toEqual([]);
  });

  it("orders overdue, then today, then waiting — never the reverse", () => {
    expect(
      visibleAgencyBuckets(buckets({ overdue: [row()], today: [row()], waiting: [row()] })),
    ).toEqual(["overdue", "today", "waiting"]);
  });
});

describe("AgencyWorkList", () => {
  it("renders the whole-queue-empty sentence, and nothing else, when there is no work", () => {
    const html = renderList(buckets());
    // work.empty is reused verbatim from the per-account screen (same
    // convention work-row.tsx's dashboard card already uses) — only the
    // body differs, so the agency screen says "across every account".
    expect(html).toContain(m["work.empty"]);
    expect(html).toContain(m["work.agency.empty.body"]);
    expect(html).not.toContain(m["work.bucket.overdue"]);
    expect(html).not.toContain(m["work.bucket.today"]);
    expect(html).not.toContain(m["work.bucket.waiting"]);
  });

  it("shows status as a dot plus a word, never color alone", () => {
    const html = renderList(buckets({ waiting: [row({ source: "conversation", contactId: "c1" })] }), { c1: "Maria Garcia" });
    expect(html).toContain("size-[7px] rounded-full");
    // Pinned to the CHIP's own <span data-slot="badge"> — the section
    // heading above renders this exact same "Waiting" text, so
    // `toContain(m["work.bucket.waiting"])` alone stayed green even after
    // the word was deleted from the chip outright, leaving only the dot
    // (the identical hole tasks/page.test.ts had).
    expect(html).toMatch(
      new RegExp(`<span data-slot="badge"[^>]*>.*?</span>${m["work.bucket.waiting"]}</span>`),
    );
  });

  it("names the contact on a conversation row via work.conversation", () => {
    const html = renderList(buckets({ waiting: [row({ source: "conversation", contactId: "c1" })] }), { c1: "Maria Garcia" });
    expect(html).toContain("Reply to Maria Garcia");
  });

  it("shows a task's own human-written title verbatim, not a template", () => {
    const html = renderList(buckets({ waiting: [row({ title: "Call about the estimate" })] }));
    expect(html).toContain("Call about the estimate");
  });

  it("asks the booking question and still names the person as context", () => {
    const html = renderList(buckets({ waiting: [row({ source: "booking", contactId: "c1" })] }), { c1: "Maria Garcia" });
    expect(html).toContain(m["work.booking"]);
    expect(html).toContain("Maria Garcia");
  });

  it("falls back to a plain label, never a raw id or the word 'undefined', for a contact missing from the map", () => {
    const html = renderList(buckets({ waiting: [row({ source: "booking", contactId: "missing-id" })] }), {});
    expect(html).not.toMatch(/>[^<]*missing-id[^<]*</);
    expect(html).not.toMatch(/>[^<]*undefined[^<]*</);
    expect(html).toContain(m["contact.noName"]);
  });

  // The requirement this whole screen exists to satisfy (task-6-brief.md /
  // spec §4.2): every row is pooled across every account on one screen, so
  // every row carries its OWN account's brand name — never accounts.name.
  it("shows the brand name on every row, not just once for the whole list", () => {
    const html = renderList(
      buckets({
        waiting: [
          row({ id: "task:1", accountId: "acct-a", brandName: "Acme HVAC", title: "Fix the quote" }),
          row({ id: "task:2", accountId: "acct-b", brandName: "Rio Roofing", title: "Call about shingles" }),
        ],
      }),
    );
    expect(html).toContain("Acme HVAC");
    expect(html).toContain("Rio Roofing");
    // Each brand name appears exactly once — proves it is rendered per-row
    // from the row's own field, not a single shared heading duplicated or
    // a hardcoded string.
    expect((html.match(/Acme HVAC/g) ?? []).length).toBe(1);
    expect((html.match(/Rio Roofing/g) ?? []).length).toBe(1);
  });

  // listAgencyWork's brandName has no fallback to accounts.name any more
  // (2026-09-15 reviewer fix) — a blank result is unreachable through the
  // product today, but this screen must still not render an empty caption
  // or, worse, silently swallow the row's identity.
  it("renders a neutral caption, never a blank one, for a row whose brand name is blank", () => {
    const html = renderList(buckets({ waiting: [row({ brandName: "" })] }));
    expect(html).toContain(m["work.agency.unbranded"]);
  });

  it("links each row to ITS OWN account's contact page, never a different row's account", () => {
    const html = renderList(
      buckets({
        waiting: [
          row({ id: "task:1", accountId: "acct-a", contactId: "c1", source: "conversation" }),
          row({ id: "task:2", accountId: "acct-b", contactId: "c2", source: "conversation" }),
        ],
      }),
      { c1: "Maria Garcia", c2: "Jo Kim" },
    );
    expect(html).toContain('href="/dashboard/accounts/acct-a/contacts/c1"');
    expect(html).toContain('href="/dashboard/accounts/acct-b/contacts/c2"');
  });

  it("does not link a contact-less row anywhere", () => {
    const html = renderList(buckets({ waiting: [row({ contactId: null })] }));
    expect(html).not.toMatch(/<a\b/);
  });

  it("stamps each row's date in THAT row's own account zone, not a shared one", () => {
    // Same due instant on two DIFFERENT accounts with different zones — a
    // shared/default zone would print the same date on both.
    const chi = row({ id: "task:chi", accountId: "acct-chi", timezone: "America/Chicago", dueAt: "2026-09-04T01:00:00Z" });
    const utc = row({ id: "task:utc", accountId: "acct-utc", timezone: "UTC", dueAt: "2026-09-04T01:00:00Z" });
    const html = renderList(buckets({ waiting: [chi, utc] }));
    expect(html).toContain("Sep 3, 2026");
    expect(html).toContain("Sep 4, 2026");
  });

  it("never falls back to UTC for one row's invalid zone — that row's date is omitted, a sibling row's own date is unaffected", () => {
    const bad = row({ id: "task:bad", accountId: "acct-bad", timezone: "Not/AZone", dueAt: "2026-09-01T00:00:00Z" });
    const good = row({ id: "task:good", accountId: "acct-good", timezone: "America/Chicago", dueAt: "2026-09-01T00:00:00Z" });
    const html = renderList(buckets({ waiting: [bad, good] }));
    // The good row's own date still renders correctly...
    expect(html).toContain("Aug 31, 2026");
    // ...and nowhere does the bad row's date get guessed in UTC instead
    // (which would also read "Sep 1, 2026" for this same instant).
    expect((html.match(/Sep 1, 2026/g) ?? []).length).toBe(0);
  });

  it("renders no date at all for the epoch-sentinel timestamp a conversation with no last_message_at carries", () => {
    const html = renderList(
      buckets({ waiting: [row({ source: "conversation", contactId: "c1", occurredAt: new Date(0).toISOString() })] }),
      { c1: "Maria Garcia" },
    );
    expect(html).not.toMatch(/19(69|70)/);
    expect(html).toContain("Reply to Maria Garcia");
  });

  it("rethrows a non-RangeError from the format path instead of swallowing it into a permanently blank cell", () => {
    forceFormatError = true;
    try {
      expect(() => renderList(buckets({ waiting: [row({ dueAt: "2026-09-01T00:00:00Z" })] }))).toThrow(TypeError);
    } finally {
      forceFormatError = false;
    }
  });

  // A suppressed account's rows must not be invisible (Important 1) — but
  // the reader also needs to know not to text them, marked where the
  // company is identified: the brand-name caption. Dot + word (rule 3).
  it("marks a suppressed account's row where the company is identified, dot plus word", () => {
    const html = renderList(buckets({ waiting: [row({ brandName: "Resaca Roofing", suppressed: true })] }));
    expect(html).toContain("Resaca Roofing");
    expect(html).toContain(m["work.agency.suppressed"]);
    // Pinned to the marker's OWN dot, not the status badge's — "rounded-full"
    // alone is satisfied by the badge's 7px dot on every row regardless of
    // suppression, so it proves nothing about THIS marker. size-[5px] is the
    // marker's own size (agency-work-list.tsx), distinct from the badge's
    // size-[7px] pinned above ("shows status as a dot plus a word...").
    expect(html).toContain("size-[5px] shrink-0 rounded-full");
  });

  it("does not mark an unsuppressed account's row", () => {
    const html = renderList(buckets({ waiting: [row({ brandName: "Rio Roofing", suppressed: false })] }));
    expect(html).not.toContain(m["work.agency.suppressed"]);
  });

  // DESIGN.md rule 5: an empty state sells the feature with the sentence AND
  // the action that causes it — this screen pools read-only, derived rows,
  // so the action is going to the account list to create the work.
  it("gives the empty state a real action, not just the sentence", () => {
    const html = renderList(buckets());
    expect(html).toContain(m["work.agency.empty.action"]);
    expect(html).toContain('href="/dashboard/accounts"');
  });
});

// Work Queue Task 10 — a proposal is a QUESTION about work, not work, and
// must render beside the real queue, never inside it (task-10-brief.md's own
// binding constraint on Bucket/BucketedWork). Rendered as a separate `<section
// data-proposals>`, distinguishable from a bucket's own `<section
// data-bucket="…">` by that marker alone, so a test can isolate one section's
// own HTML from the other's.
describe("AgencyWorkList — pending suggestions (Task 10)", () => {
  it("renders a pending proposal in its own section, labelled as suggestions", () => {
    const html = renderList(buckets(), {}, [proposal()]);
    expect(html).toMatch(/<section data-proposals[^>]*>[\s\S]*?<\/section>/);
    expect(html).toContain(m["proposals.work.heading"]);
    expect(html).toContain(m["proposals.work.body"]);
  });

  it("renders no suggestions section at all when there are none", () => {
    const html = renderList(buckets({ waiting: [row()] }), {}, []);
    expect(html).not.toContain(m["proposals.work.heading"]);
    expect(html).not.toMatch(/data-proposals/);
  });

  it("shows the suggestions section even when the real queue is otherwise empty, instead of the 'nothing needs you' empty state", () => {
    const html = renderList(buckets(), {}, [proposal()]);
    expect(html).not.toContain(m["work.empty"]);
    expect(html).toContain(m["proposals.work.heading"]);
  });

  // THE PROOF THE WHOLE FEATURE'S SEPARATION EXISTS FOR. Real work ("Call
  // back") sits in Waiting alongside a genuinely distinct proposal — the
  // proposal's own content must render, but ONLY inside its own section,
  // never inside the bucket section it sits beside.
  //
  // Fix-wave (task-10-brief.md, Important 2): the prior version of this
  // test only grepped the waiting section for the proposal's OWN
  // `payload.title`/`evidence` strings. A bare `CallProposal` folded
  // directly into `buckets.waiting` carries neither into `primaryLabel`
  // (`row.source` is `undefined` there, so it falls through to the generic
  // `m["work.booking"]` label) — so that exact mutation left every
  // assertion below green while a second, wrong `<li>` was really rendered
  // inside `data-bucket="waiting"`. Asserting the section's own `<li>`
  // COUNT instead is invariant to how a fold is shaped — a bare push and a
  // properly WorkRow-shaped map both add one element to the array, so both
  // move this count away from `waiting.length` regardless of what content
  // ends up in the extra row.
  it("keeps the waiting section's own <li> count exactly at buckets.waiting.length, even with a distinct proposal rendered alongside it (mutation: concat `proposals` into `buckets.waiting` before rendering -> FAILS)", () => {
    const waitingRows = [row({ id: "task:1", title: "Call back" })];
    const html = renderList(
      buckets({ waiting: waitingRows }),
      {},
      [proposal({
        id: "prop-unique", payload: { title: "UNIQUE_TASK_TITLE_5678", dueAt: null },
        evidence: "UNIQUE_CALLER_QUOTE_1234",
      })],
    );
    const waitingSection = html.match(/<section data-bucket="waiting"[\s\S]*?<\/section>/)?.[0] ?? "";
    expect((waitingSection.match(/<li[ >]/g) ?? []).length).toBe(waitingRows.length);
    // Proves the count assertion above is testing separation, not merely
    // that nothing rendered at all — the proposal's own content IS on the
    // page, in its own section.
    expect(html).toContain("UNIQUE_TASK_TITLE_5678");
    expect(html).toContain("UNIQUE_CALLER_QUOTE_1234");
  });

  it("shows the account's own brand name on a proposal row, the caller's own words as evidence, and links to the call it came from", () => {
    const html = renderList(buckets(), {}, [proposal({
      accountId: "acct-z", callId: "call-z", brandName: "Acme HVAC",
      evidence: "call me back Tuesday morning",
    })]);
    expect(html).toContain("Acme HVAC");
    expect(html).toContain("call me back Tuesday morning");
    // Evidence has no transcript beside it here (unlike the call-detail
    // page) — the row's own link is how a reader checks it against the
    // whole call, deep-linked to the call-detail page's own proposals
    // section rather than the page's top.
    expect(html).toContain('href="/dashboard/accounts/acct-z/calls/call-z#call-proposals"');
  });

  it("names the contact on a proposal row when one is on file", () => {
    const html = renderList(buckets(), { c1: "Maria Garcia" }, [proposal({ contactId: "c1" })]);
    expect(html).toContain("Maria Garcia");
  });

  it("shows a task proposal's own plain-language label", () => {
    const html = renderList(buckets(), {}, [proposal({
      kind: "task", payload: { title: "Call back Tuesday", dueAt: null },
    })]);
    expect(html).toContain(m["proposals.task.label"].replace("{title}", () => "Call back Tuesday"));
  });

  // Fix-wave Important 1 (task-11-brief): the agency work queue is the
  // SECOND place a task proposal's own dueAt must be visible before a human
  // accepts it — same rule as the call-detail card, in THIS proposal's own
  // account zone since this screen pools rows across every account.
  it("shows a task proposal's due date, formatted in ITS OWN account's zone (mutation: drop the due-date line -> FAILS)", () => {
    const html = renderList(buckets(), {}, [proposal({
      kind: "task", payload: { title: "Call back Tuesday", dueAt: "2026-09-23T01:00:00.000Z" },
      timezone: "America/Chicago",
    })]);
    expect(html).toContain(m["proposals.task.due"].replace("{date}", () => "Sep 22, 2026"));
  });

  it("uses a DIFFERENT proposal's OWN account zone, never one zone shared by the whole list (mutation: read a single shared timezone instead of proposal.timezone -> FAILS)", () => {
    const html = renderList(buckets(), {}, [
      proposal({
        id: "prop-chi", kind: "task",
        payload: { title: "Call back Tuesday", dueAt: "2026-09-23T01:00:00.000Z" },
        timezone: "America/Chicago",
      }),
      proposal({
        id: "prop-utc", kind: "task",
        payload: { title: "Call back Wednesday", dueAt: "2026-09-23T01:00:00.000Z" },
        timezone: "UTC",
      }),
    ]);
    expect(html).toContain(m["proposals.task.due"].replace("{date}", () => "Sep 22, 2026"));
    expect(html).toContain(m["proposals.task.due"].replace("{date}", () => "Sep 23, 2026"));
  });

  it("shows no due date for a task proposal whose dueAt is null (mutation: render a due-date line unconditionally -> FAILS)", () => {
    const html = renderList(buckets(), {}, [proposal({
      kind: "task", payload: { title: "Call back Tuesday", dueAt: null },
    })]);
    expect(html).not.toContain("Due");
  });

  it("shows a contact_field proposal's own plain-language label", () => {
    const html = renderList(buckets(), {}, [{
      ...proposal(), kind: "contact_field", payload: { field: "email", value: "sam@example.com" },
    } as AgencyProposal]);
    expect(html).toContain("email");
    expect(html).toContain("sam@example.com");
  });

  // Fix-wave (task-10-brief.md, Important 1): an opportunity_stage proposal
  // used to return `null` from `proposalSummary` 100% of the time, by
  // construction — dropping the row silently, and (proved by the next test)
  // leaving the empty state claiming the queue was clear when it was not.
  // `stageNames` is page.tsx's own batched `pipeline_stages` read, threaded
  // down as a prop — when it resolves both ids, the row shows the real
  // from -> to names, never the raw uuid.
  it("shows an opportunity_stage proposal's real from -> to stage names when page.tsx's batch read resolves them, never dropping the row", () => {
    const html = renderList(buckets(), {}, [{
      ...proposal(), kind: "opportunity_stage",
      payload: { opportunityId: "opp_1", fromStageId: "stage_1", toStageId: "stage_2" },
    } as AgencyProposal], {
      stage_1: { name: "New", position: 0 },
      stage_2: { name: "Booked", position: 3 },
    });
    expect(html).toContain(m["proposals.work.heading"]);
    expect(html).toContain(
      m["proposals.stage.label"].replace("{from}", () => "New").replace("{to}", () => "Booked"),
    );
    expect(html).not.toContain("opp_1");
    expect(html).not.toContain("stage_1");
    expect(html).not.toContain("stage_2");
  });

  // The honest-fallback half of the same fix: a specific pair that did NOT
  // resolve (the batch read errored, or came back short for just this pair)
  // still shows the row — never the raw uuid, never the destination alone,
  // and never a dropped row either.
  it("names no stage, but still shows the row, when an opportunity_stage proposal's stage ids do not resolve", () => {
    const html = renderList(buckets(), {}, [{
      ...proposal(), kind: "opportunity_stage",
      payload: { opportunityId: "opp_1", fromStageId: "stage_1", toStageId: "stage_2" },
    } as AgencyProposal], {});
    expect(html).toContain(m["proposals.work.heading"]);
    expect(html).toContain(m["proposals.stage.unresolved"]);
    expect(html).not.toContain("opp_1");
    expect(html).not.toContain("stage_1");
    expect(html).not.toContain("stage_2");
  });

  // THE EXACT PROBE THE FIX-WAVE REPORT DESCRIBES: empty buckets, ONE
  // pending opportunity_stage proposal with real evidence. Before this fix,
  // `proposalSummary` returned `null` for it, `visibleProposals` filtered it
  // out, and the empty-state gate rendered "Nothing needs you right now."
  // with the proposal's own evidence nowhere on the page.
  it("never claims the queue is clear when a pending opportunity_stage proposal exists (Important 1 regression)", () => {
    const html = renderList(buckets(), {}, [{
      ...proposal(), kind: "opportunity_stage",
      payload: { opportunityId: "opp_1", fromStageId: "stage_1", toStageId: "stage_2" },
      evidence: "move this to booked now",
    } as AgencyProposal]);
    expect(html).not.toContain(m["work.empty"]);
    expect(html).toContain(m["proposals.work.heading"]);
    expect(html).toContain("move this to booked now");
  });
});

// Real mitigation, kept rather than relied on alone (fix-wave report,
// Important 2): a BARE `CallProposal` cannot enter `AgencyBucketedWork`'s
// arrays without an explicit cast — `AgencyWorkRow` requires `source`,
// `title`, `dueAt`, `occurredAt`, `brandName`, `timezone` and `suppressed`,
// none of which a `CallProposal` carries. Same precedent as
// `lib/work/buckets.test.ts`'s own
// `_typeOnly_bucketedWorkCannotHoldAProposal`, restated here for
// `AgencyBucketedWork` specifically — a DIFFERENT type (`AgencyWorkRow[]`,
// not `WorkRow[]`), so the base type's own guard does not cover this file's
// own fold risk. Never called; only `tsc --noEmit` exercises it — widening
// `AgencyBucketedWork`'s element type the way the base-type report proved
// for `BucketedWork` would turn the `@ts-expect-error` below unused, which
// `tsc --noEmit` reports as TS2578 on this exact line, red BY NAME.
export function _typeOnly_agencyBucketedWorkCannotHoldAProposal(
  b: AgencyBucketedWork, p: CallProposal,
): void {
  // @ts-expect-error a CallProposal is not an AgencyWorkRow (no `source`,
  // `title`, `dueAt`, `occurredAt`, `brandName`, `timezone` or
  // `suppressed`) — pushing one into `buckets.waiting` cannot typecheck,
  // which is what keeps a proposal out of Overdue/Today/Waiting
  // structurally, not just by convention.
  b.waiting.push(p);
}
