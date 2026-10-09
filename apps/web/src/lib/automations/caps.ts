/**
 * FIXED platform constants (danlo, 2026-09-06), and they apply to RECIPE
 * passes only — the reminder and follow-up passes are uncapped (see their doc
 * comments: a reminder is one-to-one with a booking the customer made, and a
 * daily cap would drop reminders for a busy client), and since part B so is
 * `appointment_confirm`, the THIRD uncapped pass and the first RECIPE to be
 * one (spec decision 2): it is keyed on `starts_at` inside a 75-minute
 * window, so no status change and no import can burst it, and a fully-booked
 * Saturday would otherwise leave five customers unasked.
 *
 * The cap's job is a burst guard against a bug or a bulk status change, not
 * a plan feature: the morning band is twelve ticks wide, so an uncapped pass
 * on a busy client is a burst. No storage, no UI, no grant question. Skipped
 * rows are counted as `skippedCap` and left unstamped, so they are simply
 * due again next tick or next morning — and the counter is what tells us if
 * a real client ever hits this, at which point per-client configuration is a
 * decision with evidence behind it.
 */
export const AUTOMATION_TICK_CAP = 10;
export const AUTOMATION_DAILY_CAP = 25;
/** "A day" is a rolling 24h from the tick, counted from the pass's own stamp
 *  column — no ledger table, no timezone. */
export const DAILY_CAP_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * REACTIVATION'S OWN CAP (danlo, 2026-09-21), and the reason it is not the
 * platform's 25: 25 a day is 750 people a month who did NOT just interact
 * with the business, which is a blast. Five is a number an operator can read
 * in their sent folder. Counted per account per rolling 24h off
 * `contacts.reactivation_sent_at`, and it composes with the harder limit the
 * schema itself enforces — one reactivation per contact, ever.
 */
export const REACTIVATION_DAILY_CAP = 5;

/**
 * One SMS attempt per booking per day after a FAILED attempt (danlo,
 * 2026-09-06; spec, "Decisions taken after Milestone A shipped").
 * Write-then-send on a 15-minute cron wrote ~12 failed messages rows per
 * booking per morning band during a carrier outage. Each MORNING-BAND
 * SMS-capable pass (review request, no-show nudge) writes its recipe's own
 * `*_sms_failed_at` on a provider failure and holds the booking while that
 * marker is younger than this — counted as `skippedRecentFailure`. At most
 * ceil(61h / 24h) = 3 attempts across the review request's window, one
 * visible failed row each (cron-coupling.test.ts pins the 3). Email sends
 * carry no marker: the decision is about the rows a text leaves in the
 * customer's conversation.
 *
 * THE TEXT REMINDER IS EXEMPT (danlo, 2026-09-07, from Milestone B's
 * review): its window is 45 minutes — three ticks — so a 24h hold outlived
 * the window and meant ONE attempt ever; a single carrier blip cost the
 * customer their reminder. That pass still writes its attempt marker but
 * never reads it back; the window itself bounds it to three attempts and
 * three failed rows, which is the pile-up this hold exists to prevent.
 * THE CONFIRMATION ASK IS EXEMPT TOO (part B), for the identical reason at a
 * different width: its window is 75 minutes — five ticks — so the same 24h
 * hold would again mean one attempt ever. It writes `confirm_sms_failed_at`
 * and never reads it back.
 */
export const SMS_RETRY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/**
 * The longest operator-written body any recipe accepts. A pasted 3,000-
 * character closing line would become a ~20-segment text per booking,
 * billed; the actions refuse above this and the textareas stop typing at it.
 */
export const AUTOMATION_BODY_MAX_LENGTH = 1000;

/**
 * The instant reply's per-thread hold (Milestone C, the inline recipe): a
 * new web-form lead is not texted when their thread already carries a
 * non-failed outbound text younger than this. `hasRecentOutboundSms`'s "ANY
 * outbound text counts" semantics — which made it the WRONG store for the
 * cron recipes' cooldown (a noon reminder would have silenced the next
 * morning's review request) — are exactly right here: if the company already
 * texted this person today, a generic "we got your message" is redundant.
 * Its own constant, not SMS_RETRY_COOLDOWN_MS: that one is about a FAILED
 * attempt, this one about a successful send, and they must be free to move
 * apart.
 */
export const INSTANT_REPLY_THREAD_HOLD_MS = 24 * 60 * 60 * 1000;

/**
 * Where an instant reply may be sent (danlo, 2026-09-07, from Milestone C's
 * review). This is the only recipe whose trigger needs no reservation, no
 * call and no login — anyone can type any number into a public form — and
 * `toE164` accepts any 8–15-digit number as `+digits`, so without this a
 * rotating-IP bot could direct the daily cap's worth of billed international
 * texts at an account every day once a Telnyx key exists. US/Canada and
 * Mexico are who a Rio Grande Valley business actually serves; a number
 * outside the list is skipped as `outsideRegion` and logged. Caveat: +1
 * also covers the Caribbean NANP countries (Jamaica +1876, the Dominican
 * Republic +1809…), which carriers bill as international; an area-code
 * table is not worth its weight until a real client asks.
 *
 * A SHAPE per prefix, not a bare prefix (re-review, 2026-09-07): `toE164`
 * turns "12345678" into "+12345678", which a prefix match would admit and
 * the provider would then reject — unbilled, but a message row, four reads
 * and a provider call per junk submission, invisible to the hold (failed
 * rows are excluded) and to the cap (only successes are stamped). NANP is
 * fixed at ten digits after +1; Mexican numbers are ten after +52, or
 * eleven with the legacy mobile "1" (+52 1 …) some people still type.
 */
export const INSTANT_REPLY_ALLOWED_PATTERNS: readonly RegExp[] = [/^\+1\d{10}$/, /^\+521?\d{10}$/];

/**
 * THE USAGE REPORT's per-tick limits (client billing, spec section 3 flow 3).
 * Not a burst guard like the recipe caps: a backlog is simply sent over the
 * next ticks, and nothing is lost by waiting (each row carries its own
 * occurred_at, and Stripe takes events up to 35 days old).
 *
 *   USAGE_REPORT_TICK_CAP  meter events sent per tick. At an ASSUMED 0.2-0.3 s
 *     a round trip (not measured; the budget below bounds the pass whatever
 *     it costs), 200 rows take about 40-60 s. 200 every 15 minutes is 19,200
 *     a day, about 128 clients at an estimated 150 billable facts a day each.
 *     Past that, Stripe's v2 meter event stream is the next step.
 *   USAGE_REPORT_BUDGET_MS the pass's wall clock for sending. It stops
 *     STARTING sends at this minus METER_EVENT_WORST_CASE_MS below, so the
 *     last send still ends inside it even in that worst case. THREE passes
 *     now carry a 60 s budget in this shape — release-held.ts's own
 *     RELEASE_BUDGET_MS (first in the registry), this one, and D-067's
 *     WEEKLY_REPORT_BUDGET_MS below (twelfth) — summing to 180 s against
 *     the route's 300 s `maxDuration`, leaving 120 s for the other twelve
 *     registered passes (cron-coupling.test.ts pins the sum against the
 *     ceiling, so a fourth budgeted pass added without raising `maxDuration`
 *     reds there rather than only showing up as a timed-out tick in
 *     production).
 *   METER_EVENT_WORST_CASE_MS one send's worst case past its start, for the
 *     installed stripe SDK (22.6.2; see stripe-gateway.ts's
 *     METER_EVENT_TIMEOUT_MS/reportMeterEvent comments): its per-request
 *     `timeout` is a SOCKET-IDLE timeout, not a hard deadline, and its
 *     `RequestSender.js` retries a reset/broken-pipe connection ONCE even
 *     with `maxNetworkRetries: 0`. Two idle timeouts plus one retry's
 *     ~0.5 s backoff: 2 * 10_000 + 500 = 20,500 ms, rounded up to 21,000 for
 *     margin — hence the 60 − 21 = 39 s last-start point above.
 */
export const USAGE_REPORT_TICK_CAP = 200;
export const USAGE_REPORT_BUDGET_MS = 60_000;
export const METER_EVENT_WORST_CASE_MS = 21_000;

/**
 * THE WEEKLY CLIENT REPORT's own limits (D-067). Borrowing the recipe caps'
 * `AUTOMATION_TICK_CAP` (10) here was the bug: that number is a BURST guard
 * against a bug or a bulk status change on a pass that is one-to-one with
 * something a CUSTOMER did, sized so a fully-booked morning does not
 * overwhelm one tick. This pass is nothing like that — it is a scheduled,
 * time-based fan-out, one email per ACCOUNT (not per customer), triggered
 * by the clock in every zone that happens to be inside its own Monday
 * 08:00-11:00 band right now. At 10/tick and the band's twelve ticks
 * (15-minute cadence, three hours wide — cron-coupling.test.ts pins both),
 * the old cap could reach at most 120 accounts sharing one zone before the
 * band closes and that week's report for the rest is gone for good (a
 * missed band is a missed week; spec, "Recorded consequence" — unlike the
 * usage report's backlog, nothing here is retried after the band shuts).
 *
 * `WEEKLY_REPORT_TICK_CAP` (15x the old per-tick number: 1,800 accounts per
 * ZONE per band, since the cap is counted fresh each tick against whichever
 * zones are in band right now) is still a cap, not a dial turned off: a bug
 * in the due-list query is still bounded to one tick's worth of damage.
 * Review round 2 found that 1,800 figure could not actually have been
 * REACHED either way: `listAccountsDueWeeklyReport` (weekly-report.ts) read
 * every due account ACROSS EVERY ZONE in one unpaged call, so PostgREST's
 * `max_rows` cap (supabase/config.toml) silently dropped every account past
 * the 1,000th GLOBALLY — a bound well under this cap's own math, and one
 * that bit the whole platform's book of business at once rather than one
 * zone's Monday morning. That read is paged now (same stop-on-empty shape as
 * `listTrafficBreakdown`, sites.ts), so the 1,800-per-zone figure above is
 * the real ceiling this cap imposes, not a number the read itself cuts off
 * first. `WEEKLY_REPORT_BUDGET_MS`
 * is the same order of magnitude as the usage report's own 60 s, claimed
 * near the END of the same registered order (weekly-report.ts §registry
 * comment: client report, then the agency roll-up, then usage, then
 * ops-watch) — this pass stopping on its own clock, rather than its count,
 * leaves room for those three to still run inside the route's 300 s
 * `maxDuration` even on the tick a cap-sized backlog shows up. The check is
 * made BEFORE starting a fresh account's compute-and-send, not mid-send
 * (there is no measured "worst case overrun" for an email provider round
 * trip the way METER_EVENT_WORST_CASE_MS has one for the installed Stripe
 * SDK, so manufacturing one would be a number with no evidence behind it);
 * the accounts a budget turns away wait for the next tick, same as a
 * cap-turned-away account always has.
 *
 * What actually makes that wait land on progress rather than the same
 * account forever is `accounts.weekly_report_week`, read for free in the
 * pass's own loop (before either limit here is even consulted): an account
 * already stamped for this week is skipped WITHOUT spending a cap slot, so
 * the limited attempts this tick DOES spend fall on accounts the LAST tick
 * had not reached yet — that is the real cursor. `listAccountsDueWeeklyReport`'s
 * `created_at` ordering (D-067's other half) does something narrower: it
 * makes WHICH not-yet-stamped accounts get this tick's limited attempts
 * deterministic, so two different ticks reading the same due-list in an
 * unstable order could not arbitrarily favour different accounts by
 * accident — it is not what makes the walk advance at all.
 */
export const WEEKLY_REPORT_TICK_CAP = 150;
export const WEEKLY_REPORT_BUDGET_MS = 60_000;
