import { describe, it, expect } from "vitest";
import type { ContactNextUp } from "@bis/db";
import { nextUpView } from "./next-up";
import { makeTr } from "./copy";

const ZONE = "America/Chicago";
const data = (over: Partial<ContactNextUp> = {}): ContactNextUp => ({ bookings: [], datedTasks: [], undatedCount: 0, ...over });
const view = (d: ContactNextUp, now = new Date("2026-10-12T17:00:00Z"), locale: "en" | "es" = "en") =>
  nextUpView(d, { zone: ZONE, now, tr: makeTr(locale) });

describe("Next up (spec §9.3, C9)", () => {
  it("overdue To-dos first, then soonest, capped at three (mutation: list bookings before To-dos -> FAILS; mutation: drop the cap -> four rows, FAILS)", () => {
    const v = view(data({
      bookings: [{ id: "b1", starts_at: "2026-10-13T15:00:00Z" }, { id: "b2", starts_at: "2026-10-20T15:00:00Z" }],
      datedTasks: [{ id: "t-over", title: "Call back", due_at: "2026-10-01T05:00:00Z" }, { id: "t-today", title: "Quote", due_at: "2026-10-12T05:00:00Z" }],
    }));
    expect(v.rows.map((r) => r.id)).toEqual(["t-over", "t-today", "b1"]);
  });

  it("a To-do reads overdue (with a dot), due today or due later, by the ACCOUNT's calendar day (mutation: compare UTC days -> 10 PM Oct 12 in Chicago is Oct 13 in UTC and 'today' turns overdue, FAILS)", () => {
    const tasks = [
      { id: "a", title: "Call back", due_at: "2026-10-01T05:00:00Z" },
      { id: "b", title: "Quote", due_at: "2026-10-12T05:00:00Z" },
      { id: "c", title: "Order parts", due_at: "2026-10-20T05:00:00Z" },
    ];
    const v = view(data({ datedTasks: tasks }), new Date("2026-10-13T03:00:00Z"));
    expect(v.rows).toEqual([
      { kind: "task", id: "a", title: "Call back", detail: "Overdue · was due Oct 1, 2026", overdue: true },
      { kind: "task", id: "b", title: "Quote", detail: "Due today", overdue: false },
      { kind: "task", id: "c", title: "Order parts", detail: "Due Oct 20, 2026", overdue: false },
    ]);
  });

  it("a booking reads its day and time in the account's zone", () => {
    const v = view(data({ bookings: [{ id: "b", starts_at: "2026-10-16T15:00:00Z" }] }));
    // ICU 72+ may put U+202F (narrow no-break space) before AM; this machine's Node 24 printed 0x20.
    const row = v.rows[0] as { kind: string; id: string; label: string };
    expect({ ...row, label: row.label.replace(/ /g, " ") }).toEqual({ kind: "booking", id: "b", label: "Appointment · Fri, Oct 16 · 10:00 AM" });
    expect((view(data({ bookings: [{ id: "b", starts_at: "2026-10-16T15:00:00Z" }] }), undefined, "es").rows[0] as { label: string }).label)
      .toMatch(/^Cita · /);
  });

  it("undated To-dos are counted, never listed (C9; mutation: list them -> FAILS)", () => {
    expect(view(data({ undatedCount: 2 }))).toEqual({ rows: [], undated: "2 more To-dos have no date." });
    expect(view(data({ undatedCount: 1 })).undated).toBe("1 more To-do has no date.");
    expect(view(data()).undated).toBeNull();
  });
});
