// S-47d (spec section 5.1, plan "The model, The reader"): the one pure reader every consumer of the switch
// reads. It turns the stored row, the planned closed days and the hours chain into today's status, the
// reopening that is SAID, and the windows the slot engine and the reminder hold CLOSE. All arithmetic is in
// the account's zone through partsInZone and zonedTimeToUtc (the slot engine's), so DST is the zone's, never
// the server's. Pure and relative imports only: the prompt loads this graph under tsx.
//
// The two instants are different on purpose (D12, S1, S3): a closure's WINDOW ends at a local midnight (Closed
// today's end of today, a storm's back-on date, the day after a closed range), and what is said is the first
// opening at or after that midnight through whatever hours chain is current.
import { partsInZone, zonedTimeToUtc, normalizeOpenHours, type OpenHours, type SlotClosures } from "../booking/slots";

export type LateMinutes = 15 | 30 | 60 | 120;
export type StoredState = "open" | "closed_today" | "running_late" | "storm";
/** Structurally satisfied by @bis/db's BusinessStatusRow (no @bis/db import here: the prompt loads this under tsx). */
export type StatusRowInput = { state: StoredState; late_minutes: number | null; until: string | null; set_at: string };
export type ClosedDayReason = "holiday" | "vacation" | "other";
export type ClosedDay = { starts_on: string; ends_on: string; reason: ClosedDayReason | null };
export type StatusInput = { row: StatusRowInput | null; closedDays: readonly ClosedDay[]; hours: OpenHours | null; timezone: string; now: Date };
export type EffectiveStatus =
  | { state: "open"; nextClosedDay: ClosedDay | null }
  | { state: "running_late"; lateMinutes: LateMinutes; endsAt: Date }
  | { state: "closed_today"; reopensAt: Date; reopensTimeKnown: boolean }
  | { state: "storm"; reopensAt: Date | null; reopensTimeKnown: boolean }
  | { state: "closed_day"; reason: ClosedDayReason | null; startsOn: string; endsOn: string; reopensAt: Date; reopensTimeKnown: boolean };
export type StatusChange = { state: "open" } | { state: "closed_today" }
  | { state: "running_late"; lateMinutes: LateMinutes } | { state: "storm"; backOn: string | null };
export type Cover = { covered: false } | { covered: true; kind: "closed_today" | "storm" | "closed_day"; endsAt: Date | null };
export type StatusCode = "open" | "closed_today" | "running_late_15" | "running_late_30" | "running_late_60"
  | "running_late_120" | "storm" | "closed_day";
/** EffectiveStatus with every Date as an ISO string: for server-action results and client props. */
export type WireStatus =
  | { state: "open"; nextClosedDay: ClosedDay | null }
  | { state: "running_late"; lateMinutes: LateMinutes; endsAt: string }
  | { state: "closed_today"; reopensAt: string; reopensTimeKnown: boolean }
  | { state: "storm"; reopensAt: string | null; reopensTimeKnown: boolean }
  | { state: "closed_day"; reason: ClosedDayReason | null; startsOn: string; endsOn: string; reopensAt: string; reopensTimeKnown: boolean };

type Day = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";
const SUN_FIRST: readonly Day[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const LATE: readonly number[] = [15, 30, 60, 120];
const DAY_MS = 86_400_000;
const WALK_DAYS = 400;
const GAP_STEPS = 180;
const KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const keyOf = (y: number, m: number, d: number) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
function parseKey(key: string): { y: number; m: number; d: number } {
  const [y, m, d] = key.split("-").map(Number);
  return { y: y!, m: m!, d: d! };
}
/** A real calendar date in the YYYY-MM-DD form (2027-02-30 is not one). The one copy: business-status-actions.ts
 *  and closed-days-actions.ts both used to carry their own identical `DATE_RE`/`isDateKey` (minors-1b item 9). */
export function isDateKey(s: string): boolean {
  const mm = KEY_RE.exec(s);
  if (!mm) return false;
  return addDays(s, 0) === s;
}
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** S-47c's open-day rule (`voice/knowledge/hours.ts` hasOpenDay), copied rather than imported so the module
 *  graph stays acyclic: hours.ts imports this file. */
function hasOpenDay(hours: OpenHours | null | undefined): hours is OpenHours {
  return !!hours && SUN_FIRST.some((d) => (hours[d] ?? []).length > 0);
}

/** D3's chain: business hours when they have an open day, else the calendar's when they do, else null. Each
 *  source is normalized first, so a malformed one counts as having no open day. */
export function hoursChain(businessHours: unknown, calendarHours: unknown): OpenHours | null {
  const business = normalizeOpenHours(businessHours);
  if (hasOpenDay(business)) return business;
  const calendar = normalizeOpenHours(calendarHours);
  return hasOpenDay(calendar) ? calendar : null;
}

/** "YYYY-MM-DD": the calendar date of `instant` in `timezone`. */
export function dayKey(instant: Date, timezone: string): string {
  const p = partsInZone(instant, timezone);
  return keyOf(p.y, p.m, p.d);
}

/** Calendar arithmetic on a key, through Date.UTC only (never a zone). */
export function addDays(key: string, n: number): string {
  const { y, m, d } = parseKey(key);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return keyOf(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/** The instant of wall time `hhmm` on day `key` in `timezone`. A wall time inside a DST gap (which
 *  zonedTimeToUtc reports as null) resolves to the first minute after the gap, stepping one minute at a time
 *  for at most 180 minutes. Past that (no gap in the tz database is that long except a whole skipped day,
 *  Pacific/Apia 2011-12-30) it answers the one-step offset estimate rather than throwing. */
export function wallTime(key: string, hhmm: string, timezone: string): Date {
  const base = minutesOf(hhmm);
  for (let step = 0; step <= GAP_STEPS; step++) {
    const total = base + step;
    const { y, m, d } = parseKey(addDays(key, Math.floor(total / 1440)));
    const t = total % 1440;
    const at = zonedTimeToUtc(y, m, d, Math.floor(t / 60), t % 60, timezone);
    if (at) return at;
  }
  const { y, m, d } = parseKey(key);
  const naive = Date.UTC(y, m - 1, d, Math.floor(base / 60), base % 60);
  const p = partsInZone(new Date(naive), timezone);
  return new Date(naive + naive - Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mi));
}

/** Local 00:00 of `key`; 01:00 in a zone whose midnight is the DST gap (Havana, Santiago, Beirut). */
export function startOfDay(key: string, timezone: string): Date {
  return wallTime(key, "00:00", timezone);
}

/** A stored closure is in force while it is not open and `now` is strictly before its `until` (no until = no end). */
export function rowInForce(row: StatusRowInput | null, now: Date): boolean {
  if (!row || row.state === "open") return false;
  return row.until === null || now.getTime() < Date.parse(row.until);
}

/** The range holding `key` (inclusive at both ends), the earliest-starting one when ranges overlap. */
export function closedDayOn(key: string, closedDays: readonly ClosedDay[]): ClosedDay | null {
  let hit: ClosedDay | null = null;
  for (const r of closedDays) {
    if (r.starts_on <= key && key <= r.ends_on && (!hit || r.starts_on < hit.starts_on)) hit = r;
  }
  return hit;
}

function weekdayOf(key: string): Day {
  const { y, m, d } = parseKey(key);
  return SUN_FIRST[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!;
}

/** The first opening at or after `from` that is not on a closed day (SD3). With hours: the first span start
 *  >= `from` on from's own day (a start equal to `from` counts), else the first span of each later open day,
 *  for up to 400 days. With no open day in `hours`: the first local 00:00 at or after `from` on a non-closed
 *  day, time unknown. */
export function reopeningFrom(from: Date, hours: OpenHours | null, timezone: string,
  closedDays: readonly ClosedDay[]): { at: Date; timeKnown: boolean } {
  const first = dayKey(from, timezone);
  const fromMs = from.getTime();
  if (hasOpenDay(hours)) {
    for (let i = 0; i < WALK_DAYS; i++) {
      const k = addDays(first, i);
      if (closedDayOn(k, closedDays)) continue;
      const starts = (hours[weekdayOf(k)] ?? []).map(([s]) => s).sort((a, b) => minutesOf(a) - minutesOf(b));
      for (const s of starts) {
        const at = wallTime(k, s, timezone);
        if (at.getTime() >= fromMs) return { at, timeKnown: true };
      }
    }
  }
  for (let i = 0; i < WALK_DAYS; i++) {
    const k = addDays(first, i);
    if (closedDayOn(k, closedDays)) continue;
    const at = startOfDay(k, timezone);
    if (at.getTime() >= fromMs) return { at, timeKnown: false };
  }
  return { at: from, timeKnown: false };
}

/** The DB CHECK allows only 15/30/60/120; anything else reads as the widest window, so it fails closed. */
const asLate = (n: number | null): LateMinutes => (n !== null && LATE.includes(n) ? (n as LateMinutes) : 120);

/** The closure that wins S11's precedence at `now`, with the instant its WINDOW ends (null = no end). */
type Active =
  | { kind: "storm"; row: StatusRowInput; windowEnd: Date | null }
  | { kind: "closed_day"; range: ClosedDay; windowEnd: Date }
  | { kind: "closed_today"; row: StatusRowInput; windowEnd: Date }
  | { kind: "running_late"; row: StatusRowInput; windowEnd: Date }
  | { kind: "open" };

function active(input: StatusInput): Active {
  const { row, closedDays, timezone, now } = input;
  const today = dayKey(now, timezone);
  const tonight = () => startOfDay(addDays(today, 1), timezone);
  const inForce = rowInForce(row, now) ? row : null;
  if (inForce?.state === "storm") {
    return { kind: "storm", row: inForce, windowEnd: inForce.until === null ? null : new Date(inForce.until) };
  }
  const range = closedDayOn(today, closedDays);
  if (range) return { kind: "closed_day", range, windowEnd: startOfDay(addDays(range.ends_on, 1), timezone) };
  if (inForce?.state === "closed_today") {
    return { kind: "closed_today", row: inForce, windowEnd: inForce.until === null ? tonight() : new Date(inForce.until) };
  }
  if (inForce?.state === "running_late") {
    return { kind: "running_late", row: inForce, windowEnd: inForce.until === null ? tonight() : new Date(inForce.until) };
  }
  return { kind: "open" };
}

/** Today's status, by S11's precedence; an expired stored closure reads open (D3: expiry on read). */
export function effectiveStatus(input: StatusInput): EffectiveStatus {
  const { closedDays, hours, timezone, now } = input;
  const a = active(input);
  switch (a.kind) {
    case "storm": {
      if (a.windowEnd === null) return { state: "storm", reopensAt: null, reopensTimeKnown: false };
      const r = reopeningFrom(a.windowEnd, hours, timezone, closedDays);
      return { state: "storm", reopensAt: r.at, reopensTimeKnown: r.timeKnown };
    }
    case "closed_day": {
      const r = reopeningFrom(a.windowEnd, hours, timezone, closedDays);
      return {
        state: "closed_day", reason: a.range.reason, startsOn: a.range.starts_on, endsOn: a.range.ends_on,
        reopensAt: r.at, reopensTimeKnown: r.timeKnown,
      };
    }
    case "closed_today": {
      const r = reopeningFrom(a.windowEnd, hours, timezone, closedDays);
      return { state: "closed_today", reopensAt: r.at, reopensTimeKnown: r.timeKnown };
    }
    case "running_late":
      return { state: "running_late", lateMinutes: asLate(a.row.late_minutes), endsAt: a.windowEnd };
    case "open": {
      const today = dayKey(now, timezone);
      const lo = addDays(today, 1);
      const hi = addDays(today, 14);
      let next: ClosedDay | null = null;
      for (const r of closedDays) {
        if (r.starts_on >= lo && r.starts_on <= hi && (!next || r.starts_on < next.starts_on)) next = r;
      }
      return { state: "open", nextClosedDay: next };
    }
  }
}

/**
 * S17 extended (Task 10 review, an orchestrator ruling): never claim a state the reader could not actually
 * read. `input.closedDays` is already `[]` here — the caller computed that because the closed-days READ
 * FAILED, not because none are planned; `closedDaysUnavailable` is how this function is told which case it
 * is.
 *
 * A closure that comes from the stored row alone (`closed_today`, `storm`) never reads `closedDays` to
 * decide its STATE (S11: storm already outranks a closed day, and `closed_today`/`storm`'s own `state` only
 * depends on `row` and `now` — `closedDays` only shapes the reopening WORDING inside those branches). Those
 * two are therefore correct even with an empty `closedDays`, and are kept.
 *
 * `open` and `running_late`, on the other hand, might be WRONG: a closed day this function could not see
 * would have outranked either one (S11), and a `closed_day` state can never come back from this call at all
 * (precedence can only choose it by finding `today` inside a range in `closedDays`, which is empty here) — so
 * the real answer might be "closed_day" and this function has no way to tell. Unknown, never a guessed
 * "open": the caller treats `null` exactly as a failed status-row read (S17) — no stamp, no TODAY line.
 */
export function effectiveStatusOrUnknown(input: StatusInput, closedDaysUnavailable: boolean): EffectiveStatus | null {
  const e = effectiveStatus(input);
  if (!closedDaysUnavailable) return e;
  return e.state === "closed_today" || e.state === "storm" ? e : null;
}

/** The `until` to store when the switch is SET (SD13: no closed days). Every window ends at a local midnight
 *  (D12, S3); the reopening said is effectiveStatus's, computed on read. `hours` is unused since D12 and kept
 *  in the signature the plan fixes. A malformed back-on date stores no end: an open-ended storm blocks more,
 *  never less. */
export function untilFor(change: StatusChange, hours: OpenHours | null, timezone: string, now: Date): Date | null {
  switch (change.state) {
    case "open":
      return null;
    case "closed_today":
    case "running_late":
      return startOfDay(addDays(dayKey(now, timezone), 1), timezone);
    case "storm":
      return change.backOn !== null && isDateKey(change.backOn) ? startOfDay(change.backOn, timezone) : null;
  }
}

/** Every date key of a range, bounded so a malformed range can never loop (the DB caps a range at 92 days). */
function keysOf(r: ClosedDay): string[] {
  const out: string[] = [];
  for (let k = r.starts_on, i = 0; k <= r.ends_on && i <= WALK_DAYS; k = addDays(k, 1), i++) out.push(k);
  return out;
}

/** What the slot engine refuses (5.3). The closed-day keys come from every range given; the row's fields
 *  only from a row in force. */
export function slotClosures(input: StatusInput): SlotClosures {
  const { row, closedDays, now } = input;
  const closedDayKeys = new Set<string>();
  for (const r of closedDays) for (const k of keysOf(r)) closedDayKeys.add(k);
  const out: SlotClosures = { closedDayKeys, blockedBefore: null, blockAll: false, lateBefore: null };
  if (!row || !rowInForce(row, now)) return out;
  if (row.state === "storm" && row.until === null) out.blockAll = true;
  else if (row.state === "storm" || row.state === "closed_today") {
    out.blockedBefore = row.until === null ? startOfDay(addDays(dayKey(now, input.timezone), 1), input.timezone) : new Date(row.until);
  } else if (row.state === "running_late") {
    const lateEnd = now.getTime() + asLate(row.late_minutes) * 60_000;
    const until = row.until === null ? lateEnd : Date.parse(row.until);
    out.lateBefore = new Date(Math.min(lateEnd, until));
  }
  return out;
}

/** Whether a closure's WINDOW covers an appointment starting at `startsAt`, in S11's order, with the instant
 *  that window ends (D12): a storm's until, the start of the day after a closed range, Closed today's
 *  midnight; null for an open-ended storm. Running late covers nothing (D4). */
export function coversAppointment(input: StatusInput, startsAt: Date): Cover {
  const { row, closedDays, timezone, now } = input;
  const t = startsAt.getTime();
  const inForce = rowInForce(row, now) ? row : null;
  const inWindow = (r: StatusRowInput) => t >= Date.parse(r.set_at) && (r.until === null || t < Date.parse(r.until));
  if (inForce?.state === "storm" && inWindow(inForce)) {
    return { covered: true, kind: "storm", endsAt: inForce.until === null ? null : new Date(inForce.until) };
  }
  const range = closedDayOn(dayKey(startsAt, timezone), closedDays);
  if (range) return { covered: true, kind: "closed_day", endsAt: startOfDay(addDays(range.ends_on, 1), timezone) };
  if (inForce?.state === "closed_today" && inWindow(inForce)) {
    return { covered: true, kind: "closed_today", endsAt: inForce.until === null ? null : new Date(inForce.until) };
  }
  return { covered: false };
}

/** S7 and S22: the instants whose appointments the card lists and the To-do is filed for. null when open or
 *  running late. to = min(window end, now + 14 days); capped = the window runs past that, or has no end. */
export function closureListWindow(input: StatusInput): { from: Date; to: Date; capped: boolean } | null {
  const a = active(input);
  if (a.kind === "open" || a.kind === "running_late") return null;
  const cap = input.now.getTime() + 14 * DAY_MS;
  const end = a.windowEnd === null ? null : a.windowEnd.getTime();
  const capped = end === null || end > cap;
  return { from: input.now, to: new Date(capped ? cap : end), capped };
}

/** S6's code for calls.business_status. */
export function statusCode(e: EffectiveStatus): StatusCode {
  return e.state === "running_late" ? `running_late_${e.lateMinutes}` : e.state;
}

export function toWire(e: EffectiveStatus): WireStatus {
  switch (e.state) {
    case "open":
      return { state: "open", nextClosedDay: e.nextClosedDay };
    case "running_late":
      return { state: "running_late", lateMinutes: e.lateMinutes, endsAt: e.endsAt.toISOString() };
    case "closed_today":
      return { state: "closed_today", reopensAt: e.reopensAt.toISOString(), reopensTimeKnown: e.reopensTimeKnown };
    case "storm":
      return { state: "storm", reopensAt: e.reopensAt === null ? null : e.reopensAt.toISOString(), reopensTimeKnown: e.reopensTimeKnown };
    case "closed_day":
      return { ...e, reopensAt: e.reopensAt.toISOString() };
  }
}

export function fromWire(w: WireStatus): EffectiveStatus {
  switch (w.state) {
    case "open":
      return { state: "open", nextClosedDay: w.nextClosedDay };
    case "running_late":
      return { state: "running_late", lateMinutes: w.lateMinutes, endsAt: new Date(w.endsAt) };
    case "closed_today":
      return { state: "closed_today", reopensAt: new Date(w.reopensAt), reopensTimeKnown: w.reopensTimeKnown };
    case "storm":
      return { state: "storm", reopensAt: w.reopensAt === null ? null : new Date(w.reopensAt), reopensTimeKnown: w.reopensTimeKnown };
    case "closed_day":
      return { ...w, reopensAt: new Date(w.reopensAt) };
  }
}
