// apps/web/src/lib/brief/brief-gate.ts
// Whether a morning has anything to say (plan D5, owner answer Q2). Pure and tested alone, like the recipe gates.
// A daily mail with nothing in it is noise, so a quiet day is SKIPPED (the weekly report, which proves the product
// is alive, still sends on a quiet week). Quiet means all of: no booking today, no answered call yesterday, no lead
// yesterday, and no To-do that is due today or overdue or new since yesterday began. An old undated backlog never
// makes a day non-quiet on its own: it rides along (count and top five) whenever something else sends, otherwise a
// 40-item backlog would mail the owner every morning forever.

export type QuietInput = {
  /** Today's bookings whose status is `booked` (a cancelled job never makes a day busy). */
  bookingsToday: number;
  /** What the dashboard's "Calls answered" tile counts for yesterday: spam, abandoned, owner-line and agency
   *  handsets are already out. */
  callsAnsweredYesterday: number;
  leadsYesterday: number;
  /** Every open To-do (the queue's own rows), not just the five the email will list. */
  todos: readonly { dueAt: string | null; occurredAt: string }[];
  /** The account-local edges, from briefDays. */
  yesterdayStartIso: string;
  tomorrowStartIso: string;
};

type Edges = Pick<QuietInput, "yesterdayStartIso" | "tomorrowStartIso">;

/**
 * True for a To-do that is worth a send by itself: DUE before tomorrow begins (due today, or overdue) or NEW since
 * yesterday began (inclusive: one that arrived at that very instant counts). A To-do with no due date and an older
 * arrival never triggers. An unreadable date never triggers either (NaN compares false): the safe side of a
 * morning email is silence.
 */
export function todoTriggersSend(row: { dueAt: string | null; occurredAt: string }, edges: Edges): boolean {
  const dueBeforeTomorrow = row.dueAt !== null && Date.parse(row.dueAt) < Date.parse(edges.tomorrowStartIso);
  const newSinceYesterday = Date.parse(row.occurredAt) >= Date.parse(edges.yesterdayStartIso);
  return dueBeforeTomorrow || newSinceYesterday;
}

export function isQuietDay(i: QuietInput): boolean {
  return i.bookingsToday === 0 && i.callsAnsweredYesterday === 0 && i.leadsYesterday === 0
    && !i.todos.some((row) => todoTriggersSend(row, i));
}
