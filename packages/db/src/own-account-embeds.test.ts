// The reader guards behind 0050, in memory. No database.
//
// Since 0050 (`bookings (account_id, contact_id|calendar_id)` and
// `opportunities (account_id, contact_id)` are composite FKs onto
// `(account_id, id)`) no real row can reach the drop branch of
// `ownAccountEmbedsOnly`: a crossed row cannot be written, and all three FK
// columns are NOT NULL, so a real embed is never null either. The db suites
// that used to build crossed rows to prove the guard were removed with 0050,
// which left the branch pinned by nothing — replacing its body with
// `return rows` passed every suite. The guard stays as defence in depth, so
// it is proved here, on hand-built rows shaped like the *_SELECTs that feed it.
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { ownAccountEmbedsOnly } from "./booking";
import { ownAccountContactOnly } from "./automations";

const A = "acct-A";
const B = "acct-B";

let logged: MockInstance<typeof console.error>;
beforeEach(() => { logged = vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { logged.mockRestore(); });

/** Every console.error line, as one string each. */
const lines = () => logged.mock.calls.map((c) => String(c[0]));

describe("ownAccountEmbedsOnly (booking.ts)", () => {
  it("keeps only rows whose every embed is the row's own account's, and logs each dropped row by id and embed", () => {
    // Shaped like REMINDER_SELECT / FOLLOWUP_SELECT: both embeds carry account_id.
    const crossedContact = { id: "bk-crossed-contact", account_id: A,
      contacts: { account_id: B }, calendars: { account_id: A } };
    const crossedCalendar = { id: "bk-crossed-calendar", account_id: A,
      contacts: { account_id: A }, calendars: { account_id: B } };
    const nullContact = { id: "bk-null-contact", account_id: A,
      contacts: null, calendars: { account_id: A } };
    const own = { id: "bk-own", account_id: A,
      contacts: { account_id: A }, calendars: { account_id: A } };

    const kept = ownAccountEmbedsOnly(
      [crossedContact, crossedCalendar, nullContact, own], "listDueReminders", "booking",
      ["contacts", "calendars"]);

    expect(kept).toEqual([own]);
    expect(lines()).toHaveLength(3);
    expect(lines()[0]).toContain("listDueReminders: booking bk-crossed-contact (account acct-A)");
    expect(lines()[0]).toContain("points at a contact of account acct-B");
    expect(lines()[1]).toContain("booking bk-crossed-calendar (account acct-A)");
    expect(lines()[1]).toContain("points at a calendar of account acct-B");
    expect(lines()[2]).toContain("booking bk-null-contact (account acct-A)");
    expect(lines()[2]).toContain("points at a contact of no readable account");
  });
});

describe("ownAccountContactOnly (automations.ts)", () => {
  it("drops a crossed or missing contact, logs it, and asks nothing of a calendar the recipe never selected", () => {
    // Shaped like the recipes' *_SELECTs: a `contacts(account_id, ...)` embed
    // and NO calendars key. The kept row having no calendar is the point of
    // the delegate: it must name "contacts" alone, or every recipe row drops.
    const crossed = { id: "opp-crossed", account_id: A, contacts: { account_id: B } };
    const nullContact = { id: "opp-null-contact", account_id: A, contacts: null };
    const own = { id: "opp-own", account_id: A, contacts: { account_id: A } };

    const kept = ownAccountContactOnly(
      [crossed, nullContact, own], "listDueQuoteFollowups", "opportunity");

    expect(kept).toEqual([own]);
    expect(lines()).toHaveLength(2);
    expect(lines()[0]).toContain("listDueQuoteFollowups: opportunity opp-crossed (account acct-A)");
    expect(lines()[0]).toContain("points at a contact of account acct-B");
    expect(lines()[1]).toContain("opportunity opp-null-contact (account acct-A)");
    expect(lines()[1]).toContain("points at a contact of no readable account");
  });
});
