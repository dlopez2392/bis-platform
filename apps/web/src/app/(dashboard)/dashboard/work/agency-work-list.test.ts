import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgencyWorkRow } from "@bis/db";
import type { AgencyBucketedWork } from "@/lib/work/agency-buckets";
import { m } from "@/lib/messages";
import { visibleAgencyBuckets, AgencyWorkList } from "./agency-work-list";

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

function renderList(b: AgencyBucketedWork, contactNames: Record<string, string> = {}) {
  return renderToStaticMarkup(createElement(AgencyWorkList, { buckets: b, contactNames }));
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
    expect(html).toContain(m["work.bucket.waiting"]);
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
