import { describe, expect, it } from "vitest";
import type { AgendaBookingRow } from "@bis/db";
import { m } from "@/lib/messages";
import { agendaWindow } from "@/lib/booking/agenda-window";
import type { StatusInput } from "@/lib/business-status/status";
import { agendaHref, buildAgendaView, buildJobDrawerView, type AgendaDayView } from "./agenda-view";

/** F-046 part 1 (plan Task 12, spec 5.2-5.3): the agenda's pure view model. Every case names the mutation
 *  that must turn it red. America/Chicago; 2026-11-04 is a Wednesday in CST (UTC-6), so 10:00 local is 16:00Z. */
const CHI = "America/Chicago";
const BASE = "/dashboard/accounts/a1/calendar";
const OPEN = { wed: [["09:00", "17:00"]] as [string, string][], thu: [["09:00", "17:00"]] as [string, string][] };
const BEFORE = new Date("2026-11-01T12:00:00.000Z");

const row = (o: Partial<AgendaBookingRow>): AgendaBookingRow => ({
  id: "b1", contact_id: "c1", starts_at: "2026-11-04T16:00:00.000Z", ends_at: "2026-11-04T17:00:00.000Z",
  status: "booked", note: null, author_kind: "customer", author_id: null, meeting_type: null, meeting_url: null,
  place_id: null, confirm_reply: null, hold_until: null, hold_settled_at: null, notice_wanted: null, notice_sent_at: null,
  rescheduled_from_id: null, created_at: "2026-10-30T12:00:00.000Z",
  contact: { first_name: "Ana", last_name: "Reyes", phone: "+19565550100", email: null }, place: null, replaced: false,
  ...o,
});

const status = (o: Partial<StatusInput> = {}): StatusInput =>
  ({ row: null, closedDays: [], hours: OPEN, timezone: CHI, now: BEFORE, ...o });

function build(o: {
  rows?: AgendaBookingRow[]; view?: "day" | "week"; day?: string; now?: Date; canAdd?: boolean;
  status?: StatusInput; names?: Record<string, string>; persona?: string | null; locale?: "en" | "es";
} = {}): AgendaDayView[] {
  const view = o.view ?? "day";
  const day = o.day ?? "2026-11-04";
  const now = o.now ?? BEFORE;
  return buildAgendaView({
    rows: o.rows ?? [], window: agendaWindow(view, day, CHI), now, timezone: CHI, locale: o.locale ?? "en",
    openHours: OPEN, status: o.status ?? status({ now }), names: o.names ?? {}, viewerId: "user_1",
    persona: o.persona ?? null, calendarMeetingType: "in_person", canAdd: o.canAdd ?? true, baseHref: BASE, view, day,
  });
}
const only = (days: AgendaDayView[]) => { expect(days).toHaveLength(1); return days[0]!; };
const laneIds = (d: AgendaDayView) => d.lanes.flatMap((l) => (l.kind === "single" ? [l.id] : l.kind === "side" ? l.lanes.flat() : l.ids));

describe("buildAgendaView: which day a row is on", () => {
  it("a row overlapping two days (23:00 to 01:00) appears on both (mutation: bucket by start only -> FAILS)", () => {
    const late = row({ id: "late", starts_at: "2026-11-05T05:00:00.000Z", ends_at: "2026-11-05T07:00:00.000Z" });
    const week = build({ view: "week", rows: [late] });
    expect(week.map((d) => d.key)).toEqual(["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"]);
    expect(week.filter((d) => d.rows.some((r) => r.id === "late")).map((d) => d.key)).toEqual(["2026-11-04", "2026-11-05"]);
  });
});

describe("buildAgendaView: who made it (the author mark's words)", () => {
  const madeBy = (r: Partial<AgendaBookingRow>, o: { names?: Record<string, string>; persona?: string | null } = {}) =>
    only(build({ rows: [row(r)], ...o })).rows[0]!.madeBy;

  it("a person who is the viewer reads Added by you", () => {
    expect(madeBy({ author_kind: "person", author_id: "user_1" })).toBe(m["calendar.agenda.addedByYou"]);
  });
  it("another named person reads Added by {name} (mutation: ignore names -> FAILS)", () => {
    expect(madeBy({ author_kind: "person", author_id: "user_2" }, { names: { user_2: "Dan" } })).toBe("Added by Dan");
  });
  it("a person nobody can name reads Added by Someone on the team", () => {
    expect(madeBy({ author_kind: "person", author_id: "user_9" })).toBe(`Added by ${m["assign.someone"]}`);
  });
  it("a customer reads Booked online", () => {
    expect(madeBy({ author_kind: "customer" })).toBe(m["calendar.agenda.bookedOnline"]);
  });
  it("Sofía reads Booked by the persona, and Sofía when none is set (mutation: no default -> FAILS)", () => {
    expect(madeBy({ author_kind: "ai" }, { persona: "Max" })).toBe("Booked by Max");
    expect(madeBy({ author_kind: "ai" }, { persona: null })).toBe("Booked by Sofía");
    expect(madeBy({ author_kind: "ai" }, { persona: "   " })).toBe("Booked by Sofía");
  });
});

describe("buildAgendaView: tags, lanes and cancelled rows", () => {
  it("outsideHours follows the open hours (mutation: always false -> FAILS)", () => {
    const d = only(build({ rows: [
      row({ id: "in", starts_at: "2026-11-04T16:00:00.000Z", ends_at: "2026-11-04T17:00:00.000Z" }),
      row({ id: "out", starts_at: "2026-11-05T00:00:00.000Z", ends_at: "2026-11-05T01:00:00.000Z" }), // 18:00-19:00
    ] }));
    expect(Object.fromEntries(d.rows.map((r) => [r.id, r.outsideHours]))).toEqual({ in: false, out: true });
  });

  it("overlaps comes from agendaLanes: two overlapping rows are tagged and share one side-by-side item; back-to-back is not (mutation: overlaps false -> FAILS)", () => {
    const d = only(build({ rows: [
      row({ id: "a", starts_at: "2026-11-04T16:00:00.000Z", ends_at: "2026-11-04T17:00:00.000Z" }),
      row({ id: "b", starts_at: "2026-11-04T16:30:00.000Z", ends_at: "2026-11-04T17:30:00.000Z" }),
      row({ id: "c", starts_at: "2026-11-04T17:30:00.000Z", ends_at: "2026-11-04T18:00:00.000Z" }),
    ] }));
    expect(Object.fromEntries(d.rows.map((r) => [r.id, r.overlaps]))).toEqual({ a: true, b: true, c: false });
    expect(d.lanes).toEqual([{ kind: "side", lanes: [["a"], ["b"]] }, { kind: "single", id: "c" }]);
  });

  it("a cancelled row is in `cancelled`, muted and out of the lanes; a row a move replaced is in neither (D11; mutation: show replaced rows -> FAILS)", () => {
    const d = only(build({ rows: [
      row({ id: "live" }),
      row({ id: "gone", status: "cancelled" }),
      row({ id: "moved", status: "cancelled", replaced: true }),
    ] }));
    expect(laneIds(d)).toEqual(["live"]);
    expect(d.cancelled.map((r) => r.id)).toEqual(["gone"]);
    expect(d.cancelled[0]!.live).toBe(false);
    expect(d.rows.map((r) => r.id).sort()).toEqual(["gone", "live"]);
    expect(d.rows.find((r) => r.id === "live")!.overlaps).toBe(false); // the cancelled twin never makes it overlap
  });

  it("Week view omits cancelled rows (D11)", () => {
    const week = build({ view: "week", rows: [row({ id: "gone", status: "cancelled" })] });
    expect(week.flatMap((d) => [...d.rows, ...d.cancelled])).toEqual([]);
  });

  it("a row's words: name, what, the address's label or first line, the meeting type word, the status and the confirm answer", () => {
    const d = only(build({ rows: [
      row({ id: "x", note: "Fix the water heater", meeting_type: "video", confirm_reply: "yes",
        place: { label: null, address: "1204 Nolana Ave\nMcAllen TX" } }),
      row({ id: "y", starts_at: "2026-11-04T19:00:00.000Z", ends_at: "2026-11-04T20:00:00.000Z",
        place: { label: "Casa", address: "1204 Nolana Ave" }, contact: { first_name: null, last_name: null, phone: null, email: null } }),
    ] }));
    const [x, y] = d.rows;
    expect(x).toMatchObject({ customer: "Ana Reyes", what: "Fix the water heater", address: "1204 Nolana Ave",
      meetingWord: m["calendar.job.byVideo"], statusWord: m["calendar.bookings.status.booked"], confirmReply: "yes",
      confirmWord: m["calendar.bookings.confirmed"], startLabel: "10:00 AM", endLabel: "11:00 AM" });
    expect(y).toMatchObject({ customer: m["calendar.job.customerFallback"], address: "Casa", meetingWord: m["calendar.job.inPerson"], confirmWord: null });
  });

  it("Spanish: the words come from the .es twins", () => {
    const d = only(build({ locale: "es", rows: [row({ status: "completed", author_kind: "customer" })] }));
    expect(d.rows[0]).toMatchObject({ statusWord: m["calendar.bookings.status.completed.es"], madeBy: m["calendar.agenda.bookedOnline.es"],
      meetingWord: m["calendar.job.inPerson.es"] });
  });
});

describe("buildAgendaView: free rows", () => {
  const job = row({ id: "j", starts_at: "2026-11-04T16:00:00.000Z", ends_at: "2026-11-04T17:00:00.000Z" }); // 10:00-11:00

  it("Day view, for those who may add: every whole free open hour, labelled Add job at {time}, with its wall start", () => {
    const d = only(build({ rows: [job] }));
    expect(d.free.map((f) => f.start)).toEqual(["09:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00"]);
    expect(d.free[0]).toEqual({ at: "2026-11-04T15:00:00.000Z", start: "09:00", label: "Add job at 9:00 AM" });
  });
  it("a Technician (canAdd false) gets none (mutation: ignore canAdd -> FAILS)", () => {
    expect(only(build({ rows: [job], canAdd: false })).free).toEqual([]);
  });
  it("Week view gets none (mutation: offer them in week -> FAILS)", () => {
    expect(build({ view: "week", rows: [job] }).flatMap((d) => d.free)).toEqual([]);
  });
  it("a closed day offers none", () => {
    const closed = status({ closedDays: [{ starts_on: "2026-11-04", ends_on: "2026-11-04", reason: "holiday" }] });
    expect(only(build({ status: closed })).free).toEqual([]);
  });
});

describe("buildAgendaView: the fall-back day", () => {
  it("its two 1:30 rows carry the zone's names, so they read as two instants (mutation: drop the zoneShift pass-through -> FAILS)", () => {
    const d = only(build({ day: "2026-11-01", rows: [
      row({ id: "cdt", starts_at: "2026-11-01T06:30:00.000Z", ends_at: "2026-11-01T06:45:00.000Z" }),
      row({ id: "cst", starts_at: "2026-11-01T07:30:00.000Z", ends_at: "2026-11-01T07:45:00.000Z" }),
    ] }));
    const [a, b] = d.rows;
    expect(a!.startLabel).toBe("1:30 AM CDT");
    expect(b!.startLabel).toBe("1:30 AM CST");
  });
  it("an ordinary day's times carry no zone name", () => {
    expect(only(build({ rows: [row({})] })).rows[0]!.startLabel).toBe("10:00 AM");
  });
});

describe("buildAgendaView: the closed head (dot and word, --crit)", () => {
  const range = (reason: "holiday" | "vacation" | "other" | null) =>
    status({ closedDays: [{ starts_on: "2026-11-03", ends_on: "2026-11-05", reason }] });

  it("a closed-day range with a reason reads Closed · {reason}", () => {
    expect(only(build({ status: range("vacation") })).closed).toBe("Closed · Vacation");
  });
  it("without a reason, Closed", () => {
    expect(only(build({ status: range(null) })).closed).toBe(m["calendar.agenda.closedPlain"]);
  });
  it("a storm in force reads the storm's words", () => {
    const storm = status({ row: { state: "storm", late_minutes: null, until: null, set_at: "2026-11-01T11:00:00.000Z" } });
    expect(only(build({ status: storm })).closed).toBe(m["business.state.storm"]);
  });
  it("Closed today set at 9 AM shows on today's head: probed at max(day start, now) (mutation: probe at day start -> FAILS)", () => {
    const now = new Date("2026-11-04T16:00:00.000Z"); // 10:00 CST
    const today = status({ now, row: { state: "closed_today", late_minutes: null, until: "2026-11-05T06:00:00.000Z", set_at: "2026-11-04T15:00:00.000Z" } });
    expect(only(build({ now, status: today })).closed).toBe(m["business.state.closedToday"]);
    // and never on tomorrow's
    expect(only(build({ now, day: "2026-11-05", status: today })).closed).toBeNull();
  });
  it("running late is not closed (mutation: treat late as closed -> FAILS)", () => {
    const now = new Date("2026-11-04T16:00:00.000Z");
    const late = status({ now, row: { state: "running_late", late_minutes: 30, until: null, set_at: "2026-11-04T15:50:00.000Z" } });
    expect(only(build({ now, status: late })).closed).toBeNull();
  });
  it("a past day is probed at its own start, never at now", () => {
    const now = new Date("2026-11-06T16:00:00.000Z");
    const storm = status({ now, row: { state: "storm", late_minutes: null, until: null, set_at: "2026-11-06T15:00:00.000Z" } });
    expect(only(build({ now, status: storm })).closed).toBeNull();
  });
});

describe("hrefs", () => {
  it("every row href keeps view and day and adds job (mutation: drop day -> FAILS)", () => {
    const week = build({ view: "week", day: "2026-11-04", rows: [row({ id: "b7" })] });
    const r = week.flatMap((d) => d.rows)[0]!;
    expect(r.href).toBe(`${BASE}?view=week&day=2026-11-04&job=b7`);
  });
  it("a week's day head links to that Day", () => {
    const week = build({ view: "week", day: "2026-11-04" });
    expect(week[0]!.href).toBe(`${BASE}?view=day&day=2026-11-01`);
  });
  it("agendaHref omits an absent job", () => {
    expect(agendaHref(BASE, { view: "day", day: "2026-11-04" })).toBe(`${BASE}?view=day&day=2026-11-04`);
  });
});

describe("buildJobDrawerView: the drawer for ?job= (spec 5.5)", () => {
  const NOW = new Date("2026-11-04T16:30:00.000Z"); // 10:30 CST
  const drawer = (r: Partial<AgendaBookingRow>, o: { canWrite?: boolean; told?: boolean; locale?: "en" | "es" } = {}) => buildJobDrawerView({
    row: row(r), now: NOW, timezone: CHI, locale: o.locale ?? "en", names: { user_2: "Dan" }, viewerId: "user_1", persona: null,
    calendarMeetingType: "phone", canWrite: o.canWrite ?? true, told: o.told ?? false, accountId: "a1", language: "es",
  });

  it("names the customer, the time in the account's zone, the length and the place", () => {
    const v = drawer({ note: "Fix the gate", place: { label: "Casa", address: "1204 Nolana Ave\nMcAllen TX" },
      contact: { first_name: "Ana", last_name: "Reyes", phone: "+19565550100", email: "ana@example.com" } });
    expect(v).toMatchObject({
      id: "b1", customer: { id: "c1", name: "Ana Reyes", first: "Ana", phone: "+19565550100", email: "ana@example.com", language: "es" },
      when: "Wed, Nov 4, 10:00 AM CST", lengthMinutes: 60, what: "Fix the gate", address: "Casa · 1204 Nolana Ave, McAllen TX",
      meetingType: "phone", status: "booked", statusWord: m["calendar.bookings.status.booked"], recordHref: "/dashboard/accounts/a1/contacts/c1",
    });
  });
  it("the first name falls back to the catalogue's word when the record has none", () => {
    expect(drawer({ contact: { first_name: null, last_name: "Reyes", phone: null, email: null } }).customer.first).toBe(m["calendar.job.customerFallback"]);
  });
  it("opened is the row as stored (the in-place edit's compare-and-set): meeting_type stays null when the calendar's", () => {
    expect(drawer({ meeting_type: null, place_id: "p1", note: "x", meeting_url: null }).opened).toEqual({
      startsAt: "2026-11-04T16:00:00.000Z", endsAt: "2026-11-04T17:00:00.000Z", note: "x", placeId: "p1", meetingType: null, meetingUrl: null,
    });
  });
  it("started is starts_at at or before now (D-030); a later job has not", () => {
    expect(drawer({}).started).toBe(true);
    expect(drawer({ starts_at: "2026-11-04T17:00:00.000Z", ends_at: "2026-11-04T18:00:00.000Z" }).started).toBe(false);
  });
  it("holdOpen only while the hold is unsettled; isMove when rescheduled_from_id is set", () => {
    expect(drawer({ hold_until: "2026-11-04T16:30:10.000Z" })).toMatchObject({ holdOpen: true, isMove: false });
    expect(drawer({ hold_until: "2026-11-04T16:30:10.000Z", hold_settled_at: "2026-11-04T16:30:11.000Z" }).holdOpen).toBe(false);
    expect(drawer({ rescheduled_from_id: "old" }).isMove).toBe(true);
  });
  it("owner decision 1: canCloseOut for every role; canWrite only as given (a Technician's false)", () => {
    expect(drawer({}, { canWrite: false })).toMatchObject({ canWrite: false, canCloseOut: true });
  });
  it("the email state: none, pending, sent, failed (mutation: call an unsettled hold failed -> FAILS)", () => {
    expect(drawer({}).email).toEqual({ state: "none", kind: null, at: null });
    expect(drawer({ notice_wanted: "confirmation", hold_until: "2026-11-04T16:30:10.000Z" }).email)
      .toEqual({ state: "pending", kind: "confirmation", at: null });
    expect(drawer({ notice_wanted: "moved", hold_until: "x", hold_settled_at: "2026-11-04T16:20:00.000Z", notice_sent_at: "2026-11-04T16:20:01.000Z" }).email)
      .toEqual({ state: "sent", kind: "moved", at: "2026-11-04T16:20:01.000Z" });
    expect(drawer({ notice_wanted: "confirmation", hold_until: "x", hold_settled_at: "2026-11-04T16:20:00.000Z" }).email)
      .toEqual({ state: "failed", kind: "confirmation", at: null });
    // claimed seconds ago: the send may still be on its way
    expect(drawer({ notice_wanted: "confirmation", hold_until: "x", hold_settled_at: "2026-11-04T16:29:50.000Z" }).email.state).toBe("pending");
    // a job cancelled before its hold settled is never emailed
    expect(drawer({ status: "cancelled", notice_wanted: "confirmation", hold_until: "x" }).email.state).toBe("none");
  });
  it("who made it and when, and told passes through", () => {
    const v = drawer({ author_kind: "person", author_id: "user_2" }, { told: true });
    expect(v).toMatchObject({ madeBy: "Added by Dan", madeAt: "Fri, Oct 30, 7:00 AM CDT", told: true });
  });
  it("Spanish: the status word and when", () => {
    const v = drawer({}, { locale: "es" });
    expect(v.statusWord).toBe(m["calendar.bookings.status.booked.es"]);
    expect(v.when).not.toBe(drawer({}).when);
  });
});
