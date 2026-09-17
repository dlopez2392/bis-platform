import {
  countRealSubmissionsBetween, listBookingCreationsBetween, listCallOutcomesBetween,
  listTrafficDays, type SupabaseClient,
} from "@bis/db";

/**
 * One week, in the two shapes the reads actually take.
 *
 * `fromIso`/`toIso` are a HALF-OPEN instant range for the timestamped tables
 * (calls, bookings, submissions). `fromDay`/`toDay` are INCLUSIVE local day
 * strings, because `site_traffic_daily` is keyed by day and `listTrafficDays`
 * filters `gte`/`lte`. Carrying both is deliberate: re-deriving one from the
 * other at each call site is how two reads drift into disagreeing about which
 * week they are describing.
 */
export type WeeklyWindow = {
  fromIso: string; toIso: string;
  fromDay: string; toDay: string;
};

export type WeeklyNumbers = {
  calls: number;
  leads: number;
  bookings: number;
  /** null means NOT MEASURED — no site is linked. Never 0 for an unmeasured
   *  account: a zero we did not measure must not look like a zero we did. */
  visitors: number | null;
};

/**
 * A call the receptionist actually handled. Spam flatters the number, and an
 * abandoned call — the caller hung up before anything happened — overstates
 * it, so neither counts.
 *
 * `transferred` (0037) counts, by any honest reading: the caller reached a
 * person. Which person, and whether the receptionist or a human did the work,
 * is not what this number claims — it claims the phone was answered, and on a
 * transferred call it was.
 */
export const ANSWERED_OUTCOMES = ["booked", "lead", "message", "transferred"] as const;

/** The call half of "leads captured". A lead taken at 9pm is still a lead. */
export const LEAD_OUTCOME = ["lead"] as const;

export function countFromOutcomes(outcomes: string[], wanted: readonly string[]): number {
  return outcomes.filter((o) => wanted.includes(o)).length;
}

/**
 * The four numbers, computed once.
 *
 * Both emails call this — the client's own report and the agency roll-up — so
 * a row in the roll-up and the message that client received cannot disagree
 * about a number. That is the entire reason it exists as a function rather
 * than as two sets of queries in two passes.
 */
export async function weeklyMetrics(
  db: SupabaseClient, accountId: string, window: WeeklyWindow, hasSite: boolean,
): Promise<WeeklyNumbers> {
  const [outcomes, submissions, bookings] = await Promise.all([
    listCallOutcomesBetween(db, accountId, window.fromIso, window.toIso),
    countRealSubmissionsBetween(db, accountId, window.fromIso, window.toIso),
    listBookingCreationsBetween(db, accountId, window.fromIso, window.toIso),
  ]);

  // Not queried at all when there is no site. An absent site is not a slow
  // zero, and asking anyway would produce one.
  const visitors = hasSite
    ? (await listTrafficDays(db, accountId, window.fromDay, window.toDay))
        .reduce((sum, day) => sum + day.visitors, 0)
    : null;

  return {
    calls: countFromOutcomes(outcomes, ANSWERED_OUTCOMES),
    leads: submissions + countFromOutcomes(outcomes, LEAD_OUTCOME),
    bookings: bookings.length,
    visitors,
  };
}
