import { normalizeOpenHours, type OpenHours } from "@/lib/booking/slots";

/**
 * Monday-first — the order the settings panel renders its 7 rows in. This is
 * a DISPLAY order only: the `open_hours` column and `computeSlots`'s own
 * `OpenHours` type are keyed Sunday-first (see slots.ts), so converting
 * between the two is a re-ordering, never a data change.
 */
const FORM_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type WeekdayKey = (typeof FORM_DAYS)[number];
export const HOURS_FORM_DAYS: readonly WeekdayKey[] = FORM_DAYS;

export type HoursRow = { day: WeekdayKey; from: string; to: string };

/**
 * Chrome anchors an EMPTY `<input type="time">`'s picker at the current
 * wall-clock time — so an operator opening the picker on a blank day lands
 * somewhere different every visit. Seeding the field on focus makes the
 * picker open at the business default instead, while an untouched blank row
 * still means "closed day". A value the operator already set always wins.
 */
export const DEFAULT_OPEN_TIME = "08:00";
export const DEFAULT_CLOSE_TIME = "18:00";

export function seededTime(current: string, fallback: string): string {
  return current || fallback;
}

/**
 * `open_hours` → one row per weekday for the editor. Each weekday collapses
 * to its FIRST open interval only: the settings UI offers a single
 * open/close pair per day, not `computeSlots`'s general list-of-intervals
 * shape. A day with more than one stored interval (nothing in this UI ever
 * writes one, but a direct DB edit could) shows only the first here, and a
 * save from this form then drops the rest — that loss is a consequence of
 * the editor's shape, not a bug in this converter.
 */
export function openHoursToRows(openHours: OpenHours): HoursRow[] {
  return FORM_DAYS.map((day) => {
    const interval = openHours[day]?.[0];
    // The engine's only spelling for "open until midnight" is "24:00", never
    // "00:00" — mirrored back to "00:00" for display because `<input
    // type="time">` cannot render or accept "24:00" at all (see
    // `rowsToOpenHours` below). Any interval this form itself ever wrote is
    // safe to reverse this way: it never writes "24:00" as anything but a
    // midnight close.
    const to = interval?.[1] === "24:00" ? "00:00" : interval?.[1];
    return { day, from: interval?.[0] ?? "", to: to ?? "" };
  });
}

/**
 * Rows → `open_hours`. A row with either side blank is a CLOSED day, dropped
 * silently rather than treated as an error — the same convention an empty
 * `<input type="time">` already implies in the form itself.
 *
 * The assembled shape is passed through `normalizeOpenHours` rather than
 * re-validated here with a second HH:MM regex: that function is the one
 * place the slot engine already trusts to turn a possibly-garbled shape into
 * a safe one (it exists BECAUSE the `open_hours` column has no CHECK
 * constraint), so routing this form's output through it too means a
 * hand-crafted FormData, or a browser that doesn't enforce `type="time"`,
 * can never write anything `computeSlots` wouldn't already have defended
 * against reading back from the database directly. A reversed pair
 * (`to <= from`) is exactly the kind of garbage that gate drops.
 */
export function rowsToOpenHours(rows: HoursRow[]): OpenHours {
  const raw: Record<string, [string, string][]> = {};
  for (const row of rows) {
    if (!row.from || !row.to) continue;
    // `<input type="time">` cannot emit "24:00" — the picker only offers
    // 00:00 through 23:59 — but "24:00" is the engine's ONLY spelling for
    // "open until midnight" (`normalizeOpenHours`/`computeSlots` treat a
    // "00:00" close as `to <= from`, indistinguishable from a zero-length or
    // reversed interval, and drop it). An operator saving 22:00-00:00 used to
    // have that interval silently dropped — a closed day, behind a green
    // toast — because the form has no way to type what the engine needs.
    // Remapped here, before `normalizeOpenHours` ever sees it, so a
    // genuinely reversed pair (`to <= from` for any other reason) is still
    // exactly the garbage that gate drops.
    const to = row.to === "00:00" ? "24:00" : row.to;
    raw[row.day] = [[row.from, to]];
  }
  return normalizeOpenHours(raw);
}
