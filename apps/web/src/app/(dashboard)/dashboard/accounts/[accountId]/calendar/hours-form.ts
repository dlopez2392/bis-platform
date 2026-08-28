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
 * somewhere different every visit. Writing the business default into the
 * field just before the picker opens makes it open there instead.
 */
export const DEFAULT_OPEN_TIME = "08:00";
export const DEFAULT_CLOSE_TIME = "18:00";

/**
 * Seeds one blank time field. **The trigger is the entire safety story**, and
 * it lives in `calendar-settings.tsx`: this is wired to `onPointerDown` —
 * a pointer going down ON the field, which is how the picker gets opened —
 * and never to `onFocus`.
 *
 * The first version of this (`2cf6f25`) seeded on focus, and focus is not
 * consent. Merely TABBING across a closed day's two fields left "08:00" and
 * "18:00" sitting in them, and `rowsToOpenHours` below writes any day whose
 * BOTH sides are non-blank — so tab-through plus Save silently opened the
 * business on a day the operator never meant to open, and the receptionist
 * started offering appointments on it. A seven-row grid is traversed by Tab
 * by construction, so that was every keyboard pass through this form. (It
 * also made the field unclearable by `fill("")`, which focuses first: that
 * is how the e2e suite found it.)
 *
 * Nothing ever clears a seeded field again, on blur or otherwise. "Opened the
 * picker and walked away" and "opened the picker and chose the 08:00 it was
 * already showing" are indistinguishable from the DOM — Chrome fires no
 * `input` event for a pick that does not change the value — so a
 * clear-on-blur, however it is gated, eats exactly the choice this feature
 * exists to make easy. What remains is narrow and visible: both sides of one
 * day must be pointer-opened, and the 08:00/18:00 are sitting in the row in
 * front of the operator when Save is pressed.
 *
 * Takes the element rather than returning a string so the "already has a
 * value" case is a genuine no-op — a same-string assignment to a live input
 * is still a write.
 */
export function seedTimeOnPickerOpen(input: { value: string }, fallback: string): void {
  if (input.value !== "") return; // a value the operator already set always wins
  input.value = fallback;
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
