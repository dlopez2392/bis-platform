import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgencyWorkRow, Proposal } from "@bis/db";
import type { Proposal as Row } from "@bis/db/proposal-rules";
import type { AgencyBucketedWork } from "@/lib/work/agency-buckets";
import { m } from "@/lib/messages";
import { makeTr } from "@/lib/record/copy";
import { renderedText } from "@/lib/rendered-text";

import { buildSuggestionView } from "@/lib/proposals/view";
import { visibleAgencyBuckets, AgencyWorkList, type AgencySuggestionsLoad } from "./agency-work-list";

/** The cards' words, as the agency page draws them (English: an operator reads this page). */
const T = makeTr("en");

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));

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

function proposal(overrides: Partial<Row> = {}): Row {
  return {
    id: "prop-1", accountId: "acct-a", callId: "call-1", contactId: null,
    kind: "task", payload: { title: "Call back", dueAt: null },
    evidence: "the caller asked for a callback", status: "pending",
    decidedAt: null, decidedBy: null, createdAt: "2026-09-01T00:00:00Z",
    source: "call", evidenceRef: {}, evidenceLang: "en", expiredReason: null, appliedPayload: null, appliedRef: null, undoneAt: null, undoneBy: null, expiresAt: "2099-10-01T00:00:00Z",
    ...overrides,
  } as Row;
}
const NOW = new Date("2026-09-02T15:00:00Z");
/** One account's section as page.tsx hands it: real cards from the real builder, one group. */
function account(accountId: string, brandName: string, rowsIn: Row[], capped = false) {
  const views = rowsIn.map((r) => buildSuggestionView(r, {
    tr: T, zone: "America/Chicago", now: NOW, stages: {}, pipelineStages: [],
    callerName: null, callStartedAt: null, personaName: "Sofía", names: {}, viewerId: null,
  }));
  return { accountId, brandName, personaName: "Sofía", capped, groups: [{ key: `${accountId}:g`, heading: "No customer yet · from the call on Tue, Sep 1", views }] };
}
const loaded = (...accounts: ReturnType<typeof account>[]): AgencySuggestionsLoad => ({ ok: true, accounts });

function renderList(
  b: AgencyBucketedWork,
  contactNames: Record<string, string> = {},
  suggestions?: AgencySuggestionsLoad,
) {
  return renderToStaticMarkup(
    createElement(AgencyWorkList, { buckets: b, contactNames, suggestions, tr: T }),
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

// Work Queue Task 10 — a suggestion is a QUESTION about work, not work, and
// must render beside the real queue, never inside it (task-10-brief.md's own
// binding constraint on Bucket/BucketedWork). Since item 8b-2 (spec 5.2) the
// section holds the tray's own cards with their actions, grouped by account
// (`<section data-suggestion-account>`), inside one `<section data-proposals>`
// distinguishable from a bucket's own `<section data-bucket="…">`.
describe("AgencyWorkList — pending suggestions as cards (item 8b-2)", () => {
  const sectionOf = (h: string) => /<section[^>]*data-proposals[\s\S]*$/.exec(h)?.[0] ?? "";

  it("renders the suggestions in their own section, headed Suggestions, as cards with an Accept each", () => {
    const html = renderList(buckets(), {}, loaded(account("acct-a", "Rio Roofing", [proposal()])));
    expect(html).toMatch(/<section[^>]*data-proposals/);
    expect(html).toMatch(new RegExp(`<h2[^>]*>${T.text("suggestions.heading")}</h2>`));
    expect((sectionOf(html).match(/<article[^>]*data-suggestion="prop-1"/g) ?? []).length).toBe(1);
    expect(sectionOf(html)).toMatch(/<button[^>]*data-variant="default"[^>]*>Accept<\/button>|<button[^>]*>Accept<\/button>/);
  });

  it("renders no suggestions section at all when nothing is pending", () => {
    const html = renderList(buckets({ waiting: [row()] }), {}, loaded());
    expect(html).not.toMatch(/data-proposals/);
  });

  it("shows the suggestions even when the real queue is otherwise empty, instead of the 'nothing needs you' empty state", () => {
    const html = renderList(buckets(), {}, loaded(account("acct-a", "Rio Roofing", [proposal()])));
    expect(html).not.toContain(m["work.empty"]);
    expect(html).toMatch(/data-proposals/);
  });

  it("a failed suggestions read is the section's error with Retry, never 'nothing needs you' (rule 5; mutation: treat a failed read as none -> FAILS)", () => {
    const html = renderList(buckets(), {}, { ok: false });
    expect(html).not.toContain(m["work.empty"]);
    expect(renderedText(html)).toContain(T.text("suggestions.loadFailed"));
    expect(html).toMatch(new RegExp(`<button[^>]*>${T.text("common.retry")}</button>`));
    // …and the buckets still render beside it.
    expect(renderList(buckets({ waiting: [row()] }), {}, { ok: false })).toContain('data-bucket="waiting"');
  });

  // THE PROOF THE WHOLE FEATURE'S SEPARATION EXISTS FOR (task-10-brief.md, Important 2): the waiting
  // section's own <li> count stays at buckets.waiting.length, and no card lands inside it.
  it("keeps the waiting section's own <li> count exactly at buckets.waiting.length, with no card inside it (mutation: render the section inside a bucket's <section> -> FAILS)", () => {
    const waitingRows = [row({ id: "task:1", title: "Call back" })];
    const html = renderList(buckets({ waiting: waitingRows }), {}, loaded(account("acct-a", "Rio Roofing", [proposal({
      id: "prop-unique", payload: { title: "UNIQUE_TASK_TITLE_5678", dueAt: null }, evidence: "UNIQUE_CALLER_QUOTE_1234",
    })])));
    const waitingSection = html.match(/<section data-bucket="waiting"[\s\S]*?<\/section>/)?.[0] ?? "";
    expect((waitingSection.match(/<li[ >]/g) ?? []).length).toBe(waitingRows.length);
    expect(waitingSection).not.toContain("data-suggestion");
    expect(html).toContain("UNIQUE_TASK_TITLE_5678");
    expect(html).toContain("UNIQUE_CALLER_QUOTE_1234");
  });

  it("each account is its own section under its brand name, in the order page.tsx gives (spec 5.2)", () => {
    const html = renderList(buckets(), {}, loaded(
      account("acct-z", "Acme HVAC", [proposal({ id: "p-z", accountId: "acct-z" })]),
      account("acct-a", "Rio Roofing", [proposal({ id: "p-a" })]),
    ));
    const sections = [...html.matchAll(/<section[^>]*data-suggestion-account="([^"]+)"[\s\S]*?<h3[^>]*>([^<]*)<\/h3>/g)].map((x) => [x[1], x[2]]);
    expect(sections).toEqual([["acct-z", "Acme HVAC"], ["acct-a", "Rio Roofing"]]);
  });

  it("an account whose brand name is blank reads the neutral caption, never a blank heading (mutation: drop the fallback -> FAILS)", () => {
    const html = renderList(buckets(), {}, loaded(account("acct-a", "", [proposal()])));
    expect(html).toMatch(new RegExp(`<h3[^>]*>${m["work.agency.unbranded"]}</h3>`));
  });

  it("a capped account says so under its own cards", () => {
    const html = renderList(buckets(), {}, loaded(account("acct-a", "Rio Roofing", [proposal()], true)));
    expect(renderedText(html)).toContain("Showing the newest 50 for this account.");
  });

  it("the old read-only rows are gone: no #call-proposals link, no row link standing in for the buttons", () => {
    const html = renderList(buckets(), {}, loaded(account("acct-a", "Rio Roofing", [proposal({ accountId: "acct-a", callId: "call-z" })])));
    expect(html).not.toContain("#call-proposals");
    // The card's one link to the call is its transcript link.
    const links = sectionOf(html).match(/<a[^>]*href="[^"]*"/g) ?? [];
    expect(links.every((a) => a.includes("data-transcript-link"))).toBe(true);
  });
});

// Real mitigation, kept rather than relied on alone (fix-wave report,
// Important 2): a BARE `Proposal` cannot enter `AgencyBucketedWork`'s
// arrays without an explicit cast — `AgencyWorkRow` requires `title`,
// `dueAt`, `occurredAt`, `brandName`, `timezone` and `suppressed`, none of
// which a `Proposal` carries (since 0088 a `Proposal` has a `source`, but
// "call", which is no `WorkSource`). Same precedent as
// `lib/work/buckets.test.ts`'s own
// `_typeOnly_bucketedWorkCannotHoldAProposal`, restated here for
// `AgencyBucketedWork` specifically — a DIFFERENT type (`AgencyWorkRow[]`,
// not `WorkRow[]`), so the base type's own guard does not cover this file's
// own fold risk. Never called; only `tsc --noEmit` exercises it — widening
// `AgencyBucketedWork`'s element type the way the base-type report proved
// for `BucketedWork` would turn the `@ts-expect-error` below unused, which
// `tsc --noEmit` reports as TS2578 on this exact line, red BY NAME.
export function _typeOnly_agencyBucketedWorkCannotHoldAProposal(
  b: AgencyBucketedWork, p: Proposal,
): void {
  // @ts-expect-error a Proposal is not an AgencyWorkRow (no `title`, `dueAt`, `occurredAt`, `brandName`, `timezone` or
  // `suppressed`) — pushing one into `buckets.waiting` cannot typecheck,
  // which is what keeps a proposal out of Overdue/Today/Waiting
  // structurally, not just by convention.
  b.waiting.push(p);
}

describe("the callback To do on the agency-wide list (F-033; DESIGN.md provenance)", () => {
  it("a To do a call left carries the receptionist's author mark as its own element; one a person typed does not (mutation: drop the mark → FAILS; mark every task → FAILS)", () => {
    const html = renderList(buckets({
      today: [
        row({ id: "task:t1", title: "Call back at 9565061545: Roof leak", contactId: "c1", callId: "call1" }),
        row({ id: "task:t2", title: "Order shingles", contactId: "c1", callId: null }),
      ],
    }), { c1: "Ana Reyes" });
    const rows = html.split("<li").slice(1);
    const callback = rows.find((r) => r.includes("Roof leak"))!;
    const typed = rows.find((r) => r.includes("Order shingles"))!;
    expect(callback).toMatch(/<span[^>]*data-ai-mark[^>]*>Sofía · AI<\/span>/);
    expect(callback).toContain("Ana Reyes");
    expect(typed).not.toContain("· AI");
  });
});
