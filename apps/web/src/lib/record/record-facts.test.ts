import { describe, it, expect } from "vitest";
import type { ContactFacts } from "@bis/db";
import { factsView, talkedWhen, calendarDaysAgo } from "./record-facts";
import { makeTr } from "./copy";

const ZONE = "America/Chicago";
const NOW = new Date("2026-10-12T14:00:00Z"); // 9:00 AM in Chicago (CDT)
const ok = <T,>(value: T) => ({ ok: true as const, value });
const FAILED = { ok: false as const };
const facts = (over: Partial<ContactFacts> = {}): ContactFacts => ({
  bookingsMade: ok(0), lastTalked: ok(null), openDeals: ok({ count: 0, amount: null }), ...over,
});
const view = (over: Partial<ContactFacts> = {}, locale: "en" | "es" = "en", createdAt = "2026-01-01T05:30:00Z") =>
  factsView({ createdAt, facts: facts(over) }, { zone: ZONE, now: NOW, tr: makeTr(locale) });

describe("the summary's fact line (spec §9.2)", () => {
  it("'since' is the month in the ACCOUNT's zone: created Dec 31, 11:30 PM Chicago reads Dec 2025 (mutation: format in UTC -> 'Jan 2026', FAILS)", () => {
    expect(view().line).toEqual(["On your list since Dec 2025"]);
    expect(view({}, "es").line).toEqual(["En su lista desde dic 2025"]);
  });

  it("a zero is left out, never printed (mutation: print 'Booked 0 times' -> FAILS)", () => {
    const v = view();
    expect(v.line).toHaveLength(1);
    expect(v.missing).toBeNull();
    expect(v.allFailed).toBe(false);
  });

  it("counts read in words", () => {
    expect(view({ bookingsMade: ok(1) }).line[1]).toBe("Booked once");
    expect(view({ bookingsMade: ok(4) }).line[1]).toBe("Booked 4 times");
    expect(view({ openDeals: ok({ count: 2, amount: 2400 }) }).line.slice(1)).toEqual(["2 open deals", "$2,400"]);
    expect(view({ openDeals: ok({ count: 1, amount: 0 }) }).line.slice(1)).toEqual(["1 open deal"]);
    expect(view({ openDeals: ok({ count: 120, amount: null }) }).line.slice(1)).toEqual(["120 open deals"]);
    expect(view({ openDeals: ok({ count: 1, amount: 500 }) }, "es").line.slice(1)).toEqual(["1 oportunidad abierta", "$500"]);
  });

  it("a failed read is left out AND named, never shown as a zero (mutation: treat a failed read as 0 -> missing is null, FAILS)", () => {
    const v = view({ bookingsMade: FAILED, openDeals: FAILED });
    expect(v.line).toEqual(["On your list since Dec 2025"]);
    expect(v.missing).toBe("Couldn't count bookings and open deals.");
    expect(v.allFailed).toBe(false);
    expect(view({ bookingsMade: FAILED }, "es").missing).toBe("No se pudo contar: las citas.");
  });

  it("all three failing is the card's error state", () => {
    expect(view({ bookingsMade: FAILED, lastTalked: FAILED, openDeals: FAILED }).allFailed).toBe(true);
  });

  it("last talked counts CALENDAR days in the account's zone: 11:30 PM yesterday, 9.5 hours ago, is 'yesterday' (mutation: 24-hour arithmetic -> 'today', FAILS)", () => {
    expect(calendarDaysAgo("2026-10-12T04:30:00Z", NOW, ZONE)).toBe(1);
    expect(view({ lastTalked: ok({ at: "2026-10-12T04:30:00Z", channel: "call" }) }).line[1]).toBe("Last talked yesterday (call)");
    expect(view({ lastTalked: ok({ at: "2026-10-12T13:00:00Z", channel: "text" }) }).line[1]).toBe("Last talked today (text)");
    expect(view({ lastTalked: ok({ at: "2026-10-08T15:00:00Z", channel: "email" }) }, "es").line[1]).toBe("Última conversación hace 4 días (correo)");
  });

  it("past 30 days 'when' is the date", () => {
    expect(talkedWhen("2026-08-01T15:00:00Z", NOW, ZONE, "en")).toBe("Aug 1, 2026");
  });

  it("the boundary: 30 calendar days is still '30 days ago', 31 is the date (mutation: `> 60` -> 31 reads '31 days ago', FAILS; `>= 30` -> 30 reads the date, FAILS)", () => {
    expect(talkedWhen("2026-09-12T15:00:00Z", NOW, ZONE, "en")).toBe("30 days ago");
    expect(talkedWhen("2026-09-11T15:00:00Z", NOW, ZONE, "en")).toBe("Sep 11, 2026");
  });

  it("an unreadable created_at drops 'since' instead of throwing in a render", () => {
    expect(view({}, "en", "not a date").line).toEqual([]);
  });
});

describe("Last talked on a website chat (S-06 part 3, spec §7)", () => {
  it("says 'website chat' / 'chat del sitio web' (mutation: word a chat as a text -> FAILS)", () => {
    expect(view({ lastTalked: ok({ at: "2026-10-12T13:00:00Z", channel: "chat" }) }).line[1]).toBe("Last talked today (website chat)");
    expect(view({ lastTalked: ok({ at: "2026-10-12T13:00:00Z", channel: "chat" }) }, "es").line[1]).toBe("Última conversación hoy (chat del sitio web)");
  });
});
