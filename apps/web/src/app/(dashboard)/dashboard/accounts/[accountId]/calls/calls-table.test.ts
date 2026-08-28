import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CallListRow } from "@bis/db";
import { CallsTable } from "./calls-table";

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
  contact: { first_name: "Ana", last_name: "Reyes" },
};

function render(rows: CallListRow[], opts: { olderHref?: string; timezone?: string } = {}) {
  return renderToStaticMarkup(
    createElement(CallsTable, {
      rows,
      accountId: "acct1",
      timezone: opts.timezone ?? "America/Chicago",
      olderHref: opts.olderHref,
    }),
  );
}

describe("CallsTable", () => {
  it("renders a complete call: caller linked to the contact, row linked to the call", () => {
    const html = render([ROW]);
    expect(html).toContain("Ana Reyes");
    expect(html).toContain("1:02");
    expect(html).toContain("Booked");
    expect(html).toContain("/dashboard/accounts/acct1/calls/c1");
    expect(html).toContain("/dashboard/accounts/acct1/contacts/ct1");
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
    // All five outcomes have a treatment; none renders blank.
    for (const label of ["Lead", "Message", "Abandoned", "Spam"]) expect(html).toContain(label);
    expect(html).toContain("Older calls");
  });

  it("renders headers and no pager when there is nothing to page", () => {
    const html = render([]);
    expect(html).toContain("When");
    expect(html).toContain("Outcome");
    expect(html).not.toContain("Older calls");
  });
});
