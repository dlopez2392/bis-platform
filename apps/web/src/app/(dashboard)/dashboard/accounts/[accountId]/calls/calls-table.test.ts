import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CallListRow } from "@bis/db";
import { CallsTable } from "./calls-table";

// `CallRow` (Task 9) calls `useRouter()` from "next/navigation" at render
// time for the row's onClick/keyboard nav — outside a mounted Next app
// router (as here, a plain `renderToStaticMarkup`) that hook throws
// "invariant expected app router to be mounted". `Link`, used elsewhere in
// this table, needs no such stand-in: it only touches the router lazily,
// inside its own click handler, never during render.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {} }),
}));

// Same shape as `b/layout.test.ts`: a server component with no client state
// is just a function of its props, so `renderToStaticMarkup` pins the served
// output directly. The four shapes below are the ones the database actually
// produces and that a reviewer would otherwise have to take on trust — a call
// with no contact, with no duration, from a withheld number, and none at all.

const ROW: CallListRow = {
  id: "c1",
  // Deliberately microsecond-precision, as Postgres returns it.
  started_at: "2026-08-25T19:15:00.123456+00:00",
  duration_secs: 62,
  outcome: "booked",
  language: "es",
  caller_e164: "+19565061545",
  contact_id: "ct1",
  conversation_id: "cv1",
  contact: { first_name: "Ana", last_name: "Reyes" },
};

function render(
  rows: CallListRow[],
  opts: { olderHref?: string; timezone?: string; textbackFailed?: Set<string> } = {},
) {
  return renderToStaticMarkup(
    createElement(CallsTable, {
      rows,
      accountId: "acct1",
      timezone: opts.timezone ?? "America/Chicago",
      olderHref: opts.olderHref,
      textbackFailed: opts.textbackFailed,
    }),
  );
}

/** Every anchor's `href`, in document order — order-independent of attribute
 *  position within the tag. Used to prove exactly which links survive the
 *  whole-row rework (Task 9): the row itself is no longer one of them. */
function anchorHrefs(html: string): string[] {
  return [...html.matchAll(/<a\b[^>]*>/g)]
    .map((tag) => /href="([^"]+)"/.exec(tag[0])?.[1])
    .filter((href): href is string => Boolean(href));
}

describe("CallsTable", () => {
  it("renders a complete call: row carries the caller as its aria-label, contact stays a real link, the call itself is no longer an anchor", () => {
    const html = render([ROW]);
    expect(html).toContain("Ana Reyes");
    expect(html).toContain("1:02");
    expect(html).toContain("Booked");
    // Whole-row pattern (Task 9): the row is the click target via CallRow's
    // client-side onClick/router.push, not a rendered anchor — so the row's
    // own href never appears as markup. Its aria-label is what makes the
    // click target announced to assistive tech instead.
    expect(html).toContain('aria-label="Ana Reyes"');
    expect(html).not.toContain("/dashboard/accounts/acct1/calls/c1");
    // The contact link is the one interactive child that must survive as a
    // real, keyboard-reachable anchor — StopPropagation only stops the click
    // from bubbling to the row, it doesn't touch the underlying <a>.
    expect(html).toContain('href="/dashboard/accounts/acct1/contacts/ct1"');
    expect(html).not.toContain("Older calls");
  });

  it("stamps every row in the ACCOUNT's zone, not the machine's", () => {
    // Two zones, one instant. A fixture zone equal to the dev machine's zone
    // could not tell "formatted in the account zone" apart from "formatted in
    // whatever zone this process happens to be in" — recorded lesson.
    expect(render([ROW], { timezone: "America/Chicago" })).toContain("2:15");
    const tokyo = render([ROW], { timezone: "Asia/Tokyo" });
    expect(tokyo).toContain("4:15");
    expect(tokyo).toContain("Aug 26");
  });

  it("includes the YEAR, and pins it to the account's own zone rather than the instant's UTC date", () => {
    // A New Year's Eve instant: still 2025 in Chicago, already 2026 in Tokyo.
    // A year merely appended from the UTC timestamp — rather than one the
    // Intl formatter derives inside the account's own zone — would print the
    // same year in both columns and this test would not be able to tell.
    const nye: CallListRow = { ...ROW, id: "c-nye", started_at: "2025-12-31T23:15:00+00:00" };
    expect(render([nye], { timezone: "America/Chicago" })).toContain("2025");
    const tokyo = render([nye], { timezone: "Asia/Tokyo" });
    expect(tokyo).toContain("Jan 1");
    expect(tokyo).toContain("2026");
  });

  it("renders the shapes that have no contact, no duration, or no caller ID", () => {
    const rows: CallListRow[] = [
      { ...ROW, id: "c2", contact_id: null, contact: null, duration_secs: null, outcome: "lead" },
      { ...ROW, id: "c3", contact_id: null, contact: null, caller_e164: null, outcome: "message" },
      {
        ...ROW, id: "c4", contact_id: "ct2", contact: { first_name: null, last_name: null },
        outcome: "abandoned",
      },
      { ...ROW, id: "c5", outcome: "spam", language: "en" },
    ];
    const html = render(rows, { olderHref: "/dashboard/accounts/acct1/calls?before=x" });

    expect(html).toContain("+19565061545");
    expect(html).toContain("—");
    expect(html).toContain("Unknown caller");
    // c4 — a contact with no name at all is still linked; the label falls
    // through to the number rather than to contactDisplayName's "(no name)".
    expect(html).toContain("/dashboard/accounts/acct1/contacts/ct2");
    // Every row (c2..c5) carries its caller label as the row's own
    // aria-label now, including the withheld-caller fallback text.
    expect(html).toContain('aria-label="+19565061545"');
    expect(html).toContain('aria-label="Unknown caller"');
    // Exactly three anchors survive anywhere in this render: c4's and c5's
    // (inherited from ROW) contact links, and the pager's "Older calls"
    // link. None of the four calls' own detail hrefs render as anchors
    // any more — the row (CallRow) is the click target via
    // onClick/router.push, not markup, and the former when-cell + chevron
    // links are gone with it.
    expect(anchorHrefs(html)).toEqual([
      "/dashboard/accounts/acct1/contacts/ct2",
      "/dashboard/accounts/acct1/contacts/ct1",
      "/dashboard/accounts/acct1/calls?before=x",
    ]);
    // All five outcomes have a treatment; none renders blank.
    for (const label of ["Lead", "Message", "Abandoned", "Spam"]) expect(html).toContain(label);
    expect(html).toContain("Older calls");
  });

  /**
   * The failed text-back badge. There is no retry anywhere in that path, so
   * this badge IS the mitigation — and the row is a whole-row click target,
   * so it must be a badge and nothing else. A "Send it now" button nested in
   * here would double-fire the row's own navigation.
   */
  it("badges only the rows whose conversation has a failed text-back, and never renders a resend control in a table row", () => {
    const rows: CallListRow[] = [
      { ...ROW, id: "c1", conversation_id: "cv-failed", outcome: "abandoned" },
      { ...ROW, id: "c2", conversation_id: "cv-fine", outcome: "abandoned" },
      // No conversation at all — the shape every call had before the
      // text-back shipped. Must not badge on a `null` lookup.
      { ...ROW, id: "c3", conversation_id: null, outcome: "abandoned" },
      // THE REPEAT CALLER. Conversations are one-per-CONTACT, so this booked
      // call shares `cv-failed` with c1 above — and a text-back never fires on
      // a booked call. Badging it would put a sentence on the row that is
      // simply untrue of that call.
      { ...ROW, id: "c4", conversation_id: "cv-failed", outcome: "booked" },
    ];
    const html = render(rows, { textbackFailed: new Set(["cv-failed"]) });

    // Once, for exactly one of the four rows.
    expect(html.match(/Text-back didn&#x27;t send/g)).toHaveLength(1);
    // Dot + word, not colour alone (DESIGN.md rule 3) — asserted on the
    // painted class, because "the text rendered" is what a badge that lost
    // its dot would also satisfy.
    expect(html).toContain("bg-destructive");
    // The list row carries NO interactive element for this: no form, no
    // button. Both are what the whole-row click target cannot tolerate.
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("Send it now");
  });

  it("renders no badge at all when the page found no failed text-backs", () => {
    // The overwhelmingly common case, and the one where the prop is absent
    // entirely rather than an empty set.
    expect(render([ROW])).not.toContain("Text-back");
    expect(render([ROW], { textbackFailed: new Set() })).not.toContain("Text-back");
  });

  it("renders headers and no pager when there is nothing to page", () => {
    const html = render([]);
    expect(html).toContain("When");
    expect(html).toContain("Outcome");
    expect(html).not.toContain("Older calls");
  });
});
