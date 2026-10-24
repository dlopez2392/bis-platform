// S-47d Task 11 (plan "The topbar forms", spec §5.6.1/§6): every topbar fixture is a typed-out literal,
// never built by the function under test (Global constraints). Run under TZ unset AND TZ=Asia/Tokyo:
// every helper takes its own timezone through partsInZone/dayKey and never reads the server's zone.
import { describe, expect, it } from "vitest";
import { cardEndLine, cardLongDate, opensPhrase, topbarLabels } from "./labels";
import type { EffectiveStatus } from "./status";

const TZ = "America/Chicago";
const d = (iso: string) => new Date(iso);

// Monday 2027-06-07, 10:00 CDT.
const MON = d("2027-06-07T15:00:00.000Z");
// Wednesday 2027-06-09.
const WED = d("2027-06-09T15:00:00.000Z");
// Thursday 2027-06-10.
const THU_NOW = d("2027-06-10T15:00:00.000Z");
// December 1, 2027.
const DEC1 = d("2027-12-01T15:00:00.000Z");

const closedToday = (reopensAt: Date, reopensTimeKnown: boolean): EffectiveStatus =>
  ({ state: "closed_today", reopensAt, reopensTimeKnown });
const closedDay = (reopensAt: Date, reopensTimeKnown: boolean): EffectiveStatus =>
  ({ state: "closed_day", reason: "holiday", startsOn: "2027-06-07", endsOn: "2027-06-07", reopensAt, reopensTimeKnown });
const runningLate = (lateMinutes: 15 | 30 | 60 | 120): EffectiveStatus =>
  ({ state: "running_late", lateMinutes, endsAt: d("2027-06-08T05:00:00.000Z") });
const storm = (reopensAt: Date | null, reopensTimeKnown: boolean): EffectiveStatus =>
  ({ state: "storm", reopensAt, reopensTimeKnown });
const OPEN: EffectiveStatus = { state: "open", nextClosedDay: null };

describe("topbarLabels — pinned fixtures (plan 'The topbar forms', D9)", () => {
  it("open: null (the caller renders nothing)", () => {
    expect(topbarLabels(OPEN, TZ, MON, "en")).toBeNull();
  });

  it("Closed today · opens 8 AM (dd=1, known time) / Cerrado hoy · abre a las 8 AM", () => {
    const e = closedToday(d("2027-06-08T13:00:00.000Z"), true); // tomorrow 8 AM CDT
    expect(topbarLabels(e, TZ, MON, "en")!.full).toBe("Closed today · opens 8 AM");
    expect(topbarLabels(e, TZ, MON, "es")!.full).toBe("Cerrado hoy · abre a las 8 AM");
  });

  it("Closed today · opens Mon 8 AM (dd 2-6, known time) / Cerrado hoy · abre el lun. a las 8 AM", () => {
    const e = closedToday(d("2027-06-14T13:00:00.000Z"), true); // next Monday 8 AM CDT
    expect(topbarLabels(e, TZ, WED, "en")!.full).toBe("Closed today · opens Mon 8 AM");
    expect(topbarLabels(e, TZ, WED, "es")!.full).toBe("Cerrado hoy · abre el lun. a las 8 AM");
  });

  it("Closed today · opens Dec 28 (dd>=7) / Cerrado hoy · abre el 28 de dic.", () => {
    const e = closedToday(d("2027-12-28T13:00:00.000Z"), true);
    expect(topbarLabels(e, TZ, DEC1, "en")!.full).toBe("Closed today · opens Dec 28");
    expect(topbarLabels(e, TZ, DEC1, "es")!.full).toBe("Cerrado hoy · abre el 28 de dic.");
  });

  // The dd=7 boundary (plan table: dd 2-6 is weekday-form, dd>=7 is date-form — 7 itself is the FIRST
  // date-form day, not the last weekday-form one). Mutation: `dd <= 7` instead of `dd <= 6` → this reds
  // (dd=7 would wrongly render as "opens Mon 8 AM" instead of the date form).
  it("dd=7 exactly uses the date form, not the weekday form", () => {
    const e = closedToday(d("2027-06-14T13:00:00.000Z"), true); // MON + 7 days, 8 AM CDT
    expect(topbarLabels(e, TZ, MON, "en")!.full).toBe("Closed today · opens Jun 14");
  });

  it("Closed today · opens tomorrow (dd=1, no known time) / Cerrado hoy · abre mañana", () => {
    const e = closedToday(d("2027-06-08T05:00:00.000Z"), false);
    expect(topbarLabels(e, TZ, MON, "en")!.full).toBe("Closed today · opens tomorrow");
    expect(topbarLabels(e, TZ, MON, "es")!.full).toBe("Cerrado hoy · abre mañana");
  });

  it("Closed today · opens Mon (dd 2-6, no known time, Q1 draft) / Cerrado hoy · abre el lun.", () => {
    const e = closedToday(d("2027-06-14T05:00:00.000Z"), false);
    expect(topbarLabels(e, TZ, WED, "en")!.full).toBe("Closed today · opens Mon");
    expect(topbarLabels(e, TZ, WED, "es")!.full).toBe("Cerrado hoy · abre el lun.");
  });

  it("a closed day reads exactly the same as Closed today (spec §5.6.1)", () => {
    const e = closedDay(d("2027-06-08T13:00:00.000Z"), true);
    expect(topbarLabels(e, TZ, MON, "en")!.full).toBe("Closed today · opens 8 AM");
    expect(topbarLabels(e, TZ, MON, "en")!.short).toBe("Closed today");
  });

  it("Running about 15 min late / Con unos 15 min de retraso (Q1 draft)", () => {
    expect(topbarLabels(runningLate(15), TZ, MON, "en")!.full).toBe("Running about 15 min late");
    expect(topbarLabels(runningLate(15), TZ, MON, "es")!.full).toBe("Con unos 15 min de retraso");
  });

  it("Running about 30 min late / Con unos 30 min de retraso", () => {
    expect(topbarLabels(runningLate(30), TZ, MON, "en")!.full).toBe("Running about 30 min late");
    expect(topbarLabels(runningLate(30), TZ, MON, "es")!.full).toBe("Con unos 30 min de retraso");
  });

  it("Running about an hour late / Con alrededor de una hora de retraso", () => {
    expect(topbarLabels(runningLate(60), TZ, MON, "en")!.full).toBe("Running about an hour late");
    expect(topbarLabels(runningLate(60), TZ, MON, "es")!.full).toBe("Con alrededor de una hora de retraso");
  });

  it("Running over an hour late / Con más de una hora de retraso", () => {
    expect(topbarLabels(runningLate(120), TZ, MON, "en")!.full).toBe("Running over an hour late");
    expect(topbarLabels(runningLate(120), TZ, MON, "es")!.full).toBe("Con más de una hora de retraso");
  });

  it("Closed for a storm (no date) / Cerrado por tormenta", () => {
    expect(topbarLabels(storm(null, false), TZ, MON, "en")!.full).toBe("Closed for a storm");
    expect(topbarLabels(storm(null, false), TZ, MON, "es")!.full).toBe("Cerrado por tormenta");
  });

  it("Closed for a storm · opens 8 AM (dd=1, back on tomorrow, Q1 draft) / Cerrado por tormenta · abre a las 8 AM", () => {
    const e = storm(d("2027-06-08T13:00:00.000Z"), true);
    expect(topbarLabels(e, TZ, MON, "en")!.full).toBe("Closed for a storm · opens 8 AM");
    expect(topbarLabels(e, TZ, MON, "es")!.full).toBe("Cerrado por tormenta · abre a las 8 AM");
  });

  it("Closed for a storm · opens Thu 8 AM (dd 2-6) / Cerrado por tormenta · abre el jue. a las 8 AM", () => {
    const e = storm(d("2027-06-10T13:00:00.000Z"), true); // Thursday 8 AM CDT
    expect(topbarLabels(e, TZ, MON, "en")!.full).toBe("Closed for a storm · opens Thu 8 AM");
    expect(topbarLabels(e, TZ, MON, "es")!.full).toBe("Cerrado por tormenta · abre el jue. a las 8 AM");
  });

  it("Closed for a storm · opens Dec 28 (dd>=7) / Cerrado por tormenta · abre el 28 de dic.", () => {
    const e = storm(d("2027-12-28T13:00:00.000Z"), true);
    expect(topbarLabels(e, TZ, DEC1, "en")!.full).toBe("Closed for a storm · opens Dec 28");
    expect(topbarLabels(e, TZ, DEC1, "es")!.full).toBe("Cerrado por tormenta · abre el 28 de dic.");
  });

  it("short forms: Closed today / Cerrado hoy, regardless of the opens phrase", () => {
    const e = closedToday(d("2027-12-28T13:00:00.000Z"), true);
    expect(topbarLabels(e, TZ, DEC1, "en")!.short).toBe("Closed today");
    expect(topbarLabels(e, TZ, DEC1, "es")!.short).toBe("Cerrado hoy");
  });

  it("short forms: 15 min late / 15 min tarde (Q1 draft)", () => {
    expect(topbarLabels(runningLate(15), TZ, MON, "en")!.short).toBe("15 min late");
    expect(topbarLabels(runningLate(15), TZ, MON, "es")!.short).toBe("15 min tarde");
  });

  it("short forms: 30 min late / 30 min tarde", () => {
    expect(topbarLabels(runningLate(30), TZ, MON, "en")!.short).toBe("30 min late");
    expect(topbarLabels(runningLate(30), TZ, MON, "es")!.short).toBe("30 min tarde");
  });

  it("short forms: 1 hr late / 1 h tarde (Q1 draft)", () => {
    expect(topbarLabels(runningLate(60), TZ, MON, "en")!.short).toBe("1 hr late");
    expect(topbarLabels(runningLate(60), TZ, MON, "es")!.short).toBe("1 h tarde");
  });

  it("short forms: 1+ hr late / 1+ h tarde", () => {
    expect(topbarLabels(runningLate(120), TZ, MON, "en")!.short).toBe("1+ hr late");
    expect(topbarLabels(runningLate(120), TZ, MON, "es")!.short).toBe("1+ h tarde");
  });

  it("short forms: Storm / Tormenta, dated or not", () => {
    expect(topbarLabels(storm(null, false), TZ, MON, "en")!.short).toBe("Storm");
    expect(topbarLabels(storm(d("2027-12-28T13:00:00.000Z"), true), TZ, DEC1, "en")!.short).toBe("Storm");
    expect(topbarLabels(storm(null, false), TZ, MON, "es")!.short).toBe("Tormenta");
  });

  // SD15: dd cannot compute to 0 given the reader's own rules, but the fixture is pinned anyway so a
  // stray same-day instant never throws — it reads as dd 1 (the topbar's own defensive clamp).
  it("SD15: a same-day instant (dd would be 0) renders as dd 1, never throwing", () => {
    const sameDay = closedToday(d("2027-06-07T20:00:00.000Z"), true); // same CDT day as MON, 3pm CDT
    expect(() => topbarLabels(sameDay, TZ, MON, "en")).not.toThrow();
    expect(topbarLabels(sameDay, TZ, MON, "en")!.full).toBe("Closed today · opens 3 PM");
  });
});

describe("opensPhrase (used directly by topbarLabels; THU fixture uses a separate 'now')", () => {
  it("dd 2-6 against a Thursday 'now' still reads the right weekday", () => {
    // now = Thursday 2027-06-10; at = Tuesday 2027-06-15, dd = 5.
    const at = d("2027-06-15T13:00:00.000Z");
    expect(opensPhrase(at, true, TZ, THU_NOW, "en")).toBe("opens Tue 8 AM");
  });
});

describe("cardEndLine (dashboard card's end-of-closure line)", () => {
  it("running_late: always 'Ends at midnight' / 'Termina a la medianoche'", () => {
    expect(cardEndLine(runningLate(30), TZ, MON, "en")).toBe("Ends at midnight");
    expect(cardEndLine(runningLate(30), TZ, MON, "es")).toBe("Termina a la medianoche");
  });

  it("storm, no date: 'Until you reopen' / 'Hasta que vuelva a abrir'", () => {
    expect(cardEndLine(storm(null, false), TZ, MON, "en")).toBe("Until you reopen");
    expect(cardEndLine(storm(null, false), TZ, MON, "es")).toBe("Hasta que vuelva a abrir");
  });

  it("closed_today, dd=1, known time: 'Opens again tomorrow at 8 AM'", () => {
    const e = closedToday(d("2027-06-08T13:00:00.000Z"), true);
    expect(cardEndLine(e, TZ, MON, "en")).toBe("Opens again tomorrow at 8 AM");
    expect(cardEndLine(e, TZ, MON, "es")).toBe("Abre de nuevo mañana a las 8 AM");
  });

  it("closed_today, dd 2-6, known time: 'Opens again on Mon at 8 AM'", () => {
    const e = closedToday(d("2027-06-14T13:00:00.000Z"), true);
    expect(cardEndLine(e, TZ, WED, "en")).toBe("Opens again on Mon at 8 AM");
  });

  it("closed_today, dd>=7, known time: 'Opens again on Dec 28 at 7 AM' (the card's own key keeps {time} even past 7 days)", () => {
    const e = closedToday(d("2027-12-28T13:00:00.000Z"), true);
    expect(cardEndLine(e, TZ, DEC1, "en")).toBe("Opens again on Dec 28 at 7 AM");
  });

  it("closed_today, dd=1, no known time: 'Opens again tomorrow'", () => {
    const e = closedToday(d("2027-06-08T05:00:00.000Z"), false);
    expect(cardEndLine(e, TZ, MON, "en")).toBe("Opens again tomorrow");
  });

  it("a storm with a date reads the same opens-again phrase as closed_today", () => {
    const e = storm(d("2027-06-08T13:00:00.000Z"), true);
    expect(cardEndLine(e, TZ, MON, "en")).toBe("Opens again tomorrow at 8 AM");
  });

  it("a closed_day reads the same opens-again phrase as closed_today", () => {
    const e = closedDay(d("2027-06-08T13:00:00.000Z"), true);
    expect(cardEndLine(e, TZ, MON, "en")).toBe("Opens again tomorrow at 8 AM");
  });
});

// Spec §5.6.2 ("Next closed day: Thursday, December 24 (holiday)") and business.card.moreLater —
// both carry a full weekday+month date, never the topbar's abbreviated forms. Independently verified
// (never built by the function under test): `new Date(Date.UTC(2027,11,24)).toLocaleDateString(...)`
// gives "Friday, December 24" / "viernes, 24 de diciembre".
describe("cardLongDate (the dashboard card's own long-date form, spec §5.6.2)", () => {
  it("English: full weekday, full month", () => {
    expect(cardLongDate(d("2027-12-24T12:00:00.000Z"), TZ, "en")).toBe("Friday, December 24");
  });

  it("Spanish: full weekday, full month", () => {
    expect(cardLongDate(d("2027-12-24T12:00:00.000Z"), TZ, "es")).toBe("viernes, 24 de diciembre");
  });

  it("a different month/weekday (mutation: swap MONTH_LONG for the abbreviated table -> FAILS)", () => {
    expect(cardLongDate(d("2027-06-07T15:00:00.000Z"), TZ, "en")).toBe("Monday, June 7");
  });
});
