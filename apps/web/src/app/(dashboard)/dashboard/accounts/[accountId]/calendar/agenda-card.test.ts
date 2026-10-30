import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgendaBookingRow } from "@bis/db";

/** F-046 part 1 (plan Task 12, spec 5.1-5.6): the Agenda card reads its own window and fails, empties and
 *  caps on its own (rule 5 extended to the card): the page's other cards never wait on it or fall with it. */
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
// T11's sheet is a client component with its own tests; here it only has to exist.
vi.mock("./job-sheet", () => ({ JobSheet: () => null }));

const dbMocks = vi.hoisted(() => ({
  listAgendaBookings: vi.fn(),
  countAwaitingOutcomeBefore: vi.fn(),
  listPeopleNames: vi.fn(),
  getVoiceProfile: vi.fn(),
  getBusinessStatusRow: vi.fn(),
  listClosedDaysFrom: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listAgendaBookings: (...a: unknown[]) => dbMocks.listAgendaBookings(...a),
  countAwaitingOutcomeBefore: (...a: unknown[]) => dbMocks.countAwaitingOutcomeBefore(...a),
  listPeopleNames: (...a: unknown[]) => dbMocks.listPeopleNames(...a),
  getVoiceProfile: (...a: unknown[]) => dbMocks.getVoiceProfile(...a),
  getBusinessStatusRow: (...a: unknown[]) => dbMocks.getBusinessStatusRow(...a),
  listClosedDaysFrom: (...a: unknown[]) => dbMocks.listClosedDaysFrom(...a),
}));

const { AgendaCard } = await import("./agenda-card");
const { m } = await import("@/lib/messages");
const { renderedText } = await import("@/lib/rendered-text");

const DB = { from: () => { throw new Error("the card reads only through @bis/db"); } } as never;
const BASE = "/dashboard/accounts/a1/calendar";
const NOW = "2026-11-04T16:00:00.000Z"; // Wed 10:00 CST
const CAL = { open_hours: { wed: [["09:00", "17:00"]] as [string, string][] }, meeting_type: "in_person" as const, slot_duration_minutes: 60 };
const row = (o: Partial<AgendaBookingRow> = {}): AgendaBookingRow => ({
  id: "b1", contact_id: "c1", starts_at: "2026-11-04T18:00:00.000Z", ends_at: "2026-11-04T19:00:00.000Z",
  status: "booked", note: "Fix the gate", author_kind: "person", author_id: "user_2", meeting_type: null, meeting_url: null,
  place_id: null, confirm_reply: null, hold_until: null, hold_settled_at: null, notice_wanted: null, notice_sent_at: null,
  rescheduled_from_id: null, created_at: "2026-10-30T12:00:00.000Z",
  contact: { first_name: "Ana", last_name: "Reyes", phone: null, email: null }, place: null, replaced: false, ...o,
});

async function render(o: { canAdd?: boolean; view?: "day" | "week"; day?: string; job?: string | null } = {}) {
  return renderToStaticMarkup(await AgendaCard({
    db: DB, accountId: "a1", view: o.view ?? "day", day: o.day ?? "2026-11-04", today: "2026-11-04", nowIso: NOW,
    timezone: "America/Chicago", locale: "en", canAdd: o.canAdd ?? true, viewerId: "user_1", calendar: CAL, job: o.job ?? null,
  }));
}
const primaries = (html: string) => html.match(/data-variant="default"/g)?.length ?? 0;

beforeEach(() => {
  dbMocks.listAgendaBookings.mockReset().mockResolvedValue({ rows: [row()], truncated: false });
  dbMocks.countAwaitingOutcomeBefore.mockReset().mockResolvedValue(0);
  dbMocks.listPeopleNames.mockReset().mockResolvedValue({ user_2: "Dan" });
  dbMocks.getVoiceProfile.mockReset().mockResolvedValue(null);
  dbMocks.getBusinessStatusRow.mockReset().mockResolvedValue(null);
  dbMocks.listClosedDaysFrom.mockReset().mockResolvedValue([]);
});

describe("AgendaCard: what it reads", () => {
  it("reads the window's bookings on the db it is handed, from the day's own local midnight to the next", async () => {
    await render();
    expect(dbMocks.listAgendaBookings).toHaveBeenCalledWith(DB, "a1", "2026-11-04T06:00:00.000Z", "2026-11-05T06:00:00.000Z");
  });
  it("the names read asks only for the person authors on the rows", async () => {
    await render();
    expect(dbMocks.listPeopleNames).toHaveBeenCalledWith(DB, ["user_2"]);
    expect(renderedText(await render())).toContain("Added by Dan");
  });
});

describe("AgendaCard: loaded", () => {
  it("draws the row as a button carrying the booking's anchor id, with its words", async () => {
    const html = await render();
    expect(html).toContain('id="booking-b1"');
    const text = renderedText(html);
    for (const s of ["Ana Reyes", "Fix the gate", "12:00 PM", "1:00 PM", m["calendar.bookings.status.booked"]]) expect(text).toContain(s);
  });
  it("its header: the title, Day and Week as links with aria-current, Back, Today and Next as links", async () => {
    const html = await render({ day: "2026-11-04" });
    expect(renderedText(html)).toContain(m["calendar.agenda.title"]);
    const current = html.match(/<a [^>]*aria-current="page"[^>]*>/g) ?? [];
    expect(current).toHaveLength(1);
    expect(current[0]).toContain(`href="${BASE}?view=day&amp;day=2026-11-04"`);
    expect(html).toContain(`href="${BASE}?view=week&amp;day=2026-11-04"`);
    expect(html).toContain(`href="${BASE}?view=day&amp;day=2026-11-03"`);
    expect(html).toContain(`href="${BASE}?view=day&amp;day=2026-11-05"`);
  });
  it("rule 8: Add job is the card's ONE primary (mutation: a second primary in the card -> FAILS)", async () => {
    const html = await render();
    expect(primaries(html)).toBe(1);
    expect(renderedText(html)).toContain(m["calendar.agenda.addJob"]);
  });
  it("a Technician (canAdd false) gets no Add job and no free rows (mutation: ignore canAdd -> FAILS)", async () => {
    const html = await render({ canAdd: false });
    expect(primaries(html)).toBe(0);
    expect(renderedText(html)).not.toContain(m["calendar.agenda.addJob"]);
    expect(html).not.toContain("data-agenda-free");
  });
});

describe("AgendaCard: the lines above the rows", () => {
  it("the 400-row cap shows the truncated line and never claims the view is complete (mutation: ignore truncated -> FAILS)", async () => {
    dbMocks.listAgendaBookings.mockResolvedValue({ rows: [row()], truncated: true });
    const text = renderedText(await render());
    expect(text).toContain(m["calendar.agenda.truncated"].replace("{cap}", "400"));
  });
  it("no cap, no line", async () => {
    expect(await render()).not.toContain("data-agenda-truncated");
  });
  it("past jobs still booked after their end: one line linking To do, counted up to NOW (carry-in 4; mutation: count before the day's start -> FAILS)", async () => {
    dbMocks.countAwaitingOutcomeBefore.mockResolvedValue(3);
    const html = await render();
    expect(dbMocks.countAwaitingOutcomeBefore).toHaveBeenCalledWith(DB, "a1", NOW);
    expect(renderedText(html)).toContain(m["calendar.agenda.pastOpen"].replace("{count}", "3"));
    expect(html).toContain('href="/dashboard/accounts/a1/tasks"');
  });
  it("one past job reads the One form; none draws no line", async () => {
    dbMocks.countAwaitingOutcomeBefore.mockResolvedValue(1);
    expect(renderedText(await render())).toContain(m["calendar.agenda.pastOpenOne"]);
    dbMocks.countAwaitingOutcomeBefore.mockResolvedValue(0);
    expect(await render()).not.toContain("data-agenda-past");
  });
  it("a failed count draws no line and costs nothing else (best effort, logged)", async () => {
    dbMocks.countAwaitingOutcomeBefore.mockRejectedValue(new Error("boom"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const html = await render();
      expect(html).not.toContain("data-agenda-past");
      expect(html).toContain('id="booking-b1"');
      expect(spy).toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });
});

describe("AgendaCard: empty and error (rule 5)", () => {
  it("an empty day sells the feature: the title naming the day, the body, and Add job as the one primary", async () => {
    dbMocks.listAgendaBookings.mockResolvedValue({ rows: [], truncated: false });
    const html = await render();
    const text = renderedText(html);
    expect(text).toContain(m["calendar.agenda.emptyTitle"].replace("{day}", "Wednesday, November 4"));
    expect(text).toContain(m["calendar.agenda.emptyBody"]);
    expect(primaries(html)).toBe(1);
  });
  it("a Technician's empty day says none of THEIR customers have a job", async () => {
    dbMocks.listAgendaBookings.mockResolvedValue({ rows: [], truncated: false });
    const text = renderedText(await render({ canAdd: false }));
    expect(text).toContain(m["calendar.agenda.emptyTechnician"].replace("{day}", "Wednesday, November 4"));
    expect(text).not.toContain(m["calendar.agenda.emptyBody"]);
  });
  it("a thrown read renders the card's own error with a Try again link to the same URL, logged (mutation: let it throw -> FAILS)", async () => {
    dbMocks.listAgendaBookings.mockRejectedValue(new Error("boom"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const html = await render({ view: "week", day: "2026-11-04", job: "b9" });
      expect(html).toContain('role="alert"');
      const text = renderedText(html);
      expect(text).toContain(m["calendar.agenda.error"]);
      expect(text).toContain(m["calendar.agenda.retry"]);
      expect(html).toContain(`href="${BASE}?view=week&amp;day=2026-11-04&amp;job=b9"`);
      expect(spy).toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });
  it("a failed closure read draws no closed head, still draws the rows (best effort, logged)", async () => {
    dbMocks.listClosedDaysFrom.mockRejectedValue(new Error("boom"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const html = await render();
      expect(html).toContain('id="booking-b1"');
      expect(html).not.toContain("data-agenda-closed");
      expect(spy).toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });
  it("a closed day heads the day with dot and word", async () => {
    dbMocks.listClosedDaysFrom.mockResolvedValue([{ id: "cd", account_id: "a1", starts_on: "2026-11-04", ends_on: "2026-11-04", reason: "holiday", created_by: "u", created_at: NOW }]);
    const html = await render();
    expect(html).toContain("data-agenda-closed");
    expect(renderedText(html)).toContain("Closed · Holiday");
  });
});

describe("AgendaCard: Week", () => {
  it("seven day heads, each a link to that Day, and the phone's strip of seven day links", async () => {
    const html = await render({ view: "week" });
    for (const d of ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"]) {
      expect(html).toContain(`href="${BASE}?view=day&amp;day=${d}"`);
      expect(html).toContain(`href="${BASE}?view=week&amp;day=${d}"`);
    }
    expect(html).toContain(`aria-label="${m["calendar.agenda.daysLabel"]}"`);
    expect(html).not.toContain("data-agenda-free");
  });
});
