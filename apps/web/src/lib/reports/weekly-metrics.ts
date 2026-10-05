import {
  listBookingCreationsBetween, listCallOutcomesBetween,
  listTrafficDays, listSubmissionCreationsBetween, listCallStartsByOutcomeBetween,
  type SupabaseClient,
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
 * The raw instants behind "leads captured" — a REAL (non-spam) form
 * submission's `created_at`, or a `LEAD_OUTCOME` call's `started_at`.
 * `weeklyMetrics().leads` below is this array's length for ONE week; the
 * dashboard's CRM-only hero (F-076's now slice, crm-features.md §2.3/§6.3)
 * needs the individual timestamps instead, to bucket them by day for a
 * sparkline and split them into a current/prior 7-day pair for a delta.
 * BOTH callers reach this one function — SHARED BY CONSTRUCTION, not by
 * convention: `weeklyMetrics` no longer has its own, parallel computation
 * of "what counts as a lead" that could silently drift from this one (the
 * reviewer's finding on the first version of this fix). Both underlying
 * reads are row-returning and keyset-paged (`listSubmissionCreationsBetween`
 * forms.ts, `listCallStartsByOutcomeBetween` voice.ts) rather than a
 * head-count and a client-side filter over every outcome — one week's calls
 * realistically never approach the row cap these page past, so there is no
 * reason for `weeklyMetrics` to want a cheaper, different-shaped read here.
 */
export async function listLeadInstantsBetween(
  db: SupabaseClient, accountId: string, fromIso: string, toIso: string,
): Promise<string[]> {
  const [submissionIso, callIso] = await Promise.all([
    listSubmissionCreationsBetween(db, accountId, fromIso, toIso),
    listCallStartsByOutcomeBetween(db, accountId, LEAD_OUTCOME, fromIso, toIso),
  ]);
  return [...submissionIso, ...callIso];
}

/**
 * The four numbers, computed once.
 *
 * Both emails call this — the client's own report and the agency roll-up — so
 * a row in the roll-up and the message that client received cannot disagree
 * about a number. That is the entire reason it exists as a function rather
 * than as two sets of queries in two passes.
 *
 * `leads` is `listLeadInstantsBetween(...).length`, not a second,
 * independently-filtered submissions-count-plus-outcomes-count — see that
 * function's own doc comment for why. `calls` still comes from
 * `listCallOutcomesBetween`'s raw outcomes (every outcome in the window,
 * filtered here to `ANSWERED_OUTCOMES`): that part of the report is
 * unchanged, and not shared with anything the dashboard reads today.
 */
export async function weeklyMetrics(
  db: SupabaseClient, accountId: string, window: WeeklyWindow, hasSite: boolean,
): Promise<WeeklyNumbers> {
  const [outcomes, leadInstants, bookings] = await Promise.all([
    listCallOutcomesBetween(db, accountId, window.fromIso, window.toIso),
    listLeadInstantsBetween(db, accountId, window.fromIso, window.toIso),
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
    leads: leadInstants.length,
    bookings: bookings.length,
    visitors,
  };
}
