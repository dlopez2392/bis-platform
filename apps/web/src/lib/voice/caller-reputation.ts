// Pure decision logic for refusing a caller who has proven they are a robot
// (spam-screening spec, Guard 2). Shaped like `call-limits.ts` — no database,
// so the decision is trivially unit-testable — and serving the purpose
// `accept-gate.ts` states: ONE predicate that BOTH voice gates call, so the
// TeXML route's spoken refusal and the webhook's silent decline can never
// drift out of agreement.
//
// The try/catch and fail-open wrapping live in the routes, not here.

export type ReputationConfig = { threshold: number; windowDays: number };
export type ReputationVerdict = { blocked: false } | { blocked: true; reason: "repeat-spam" };

/** Counts over the window, from `countCallerHistorySince`. `spamCalls`
 *  counts ONLY rows with at least one turn — see the exclusion note there. */
export type CallerHistory = { spamCalls: number; otherCalls: number };

const DEFAULTS: ReputationConfig = { threshold: 3, windowDays: 30 };

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * Both knobs are starting values, not measured optima: there is not a single
 * real robocall in this product's database, so there is nothing to tune
 * against yet. Junk falls back rather than taking effect — a `threshold` of 0
 * would block every caller on their first silent call, which is the worst
 * failure this feature could have.
 *
 * Against the existing per-caller cap of 5 calls/day, a threshold of 3 means a
 * robot is refused partway through its first day and costs nothing after that.
 */
export function readReputationConfig(env: NodeJS.ProcessEnv = process.env): ReputationConfig {
  return {
    threshold: positiveInt(env.PHONE_SPAM_BLOCK_THRESHOLD, DEFAULTS.threshold),
    windowDays: positiveInt(env.PHONE_SPAM_BLOCK_WINDOW_DAYS, DEFAULTS.windowDays),
  };
}

/**
 * The floor of the rolling window, as an ISO instant.
 *
 * Rolling, NOT a calendar boundary, and this is load-bearing rather than
 * cosmetic: a refused call writes no `calls` row at all (`startCallRow` is
 * step 10, after every gate), so a blocked caller can never generate the good
 * outcome that would clear them. If the window did not slide, the first block
 * would be permanent and unappealable. Because it slides, a caller who stops
 * calling ages out of their own block.
 */
export function windowStart(now: Date, windowDays: number): string {
  return new Date(now.getTime() - windowDays * 86_400_000).toISOString();
}

/**
 * Refuse only a caller whose ENTIRE history in the window is spam.
 *
 * `otherCalls === 0` is mandatory, not a refinement. In the live `calls`
 * table one number is simultaneously the top spam caller (4) and the top
 * booker (13): a rule that counted spam alone would have refused the best
 * customer in the database. One booking, lead, message — or even one
 * `abandoned`, which means a human spoke — clears the caller completely.
 *
 * Non-strict `>=`, matching `decideLimit`: `threshold: 3` means three silent
 * calls are enough.
 */
export function decideReputation(
  history: CallerHistory, cfg: ReputationConfig,
): ReputationVerdict {
  if (history.otherCalls > 0) return { blocked: false };
  if (history.spamCalls >= cfg.threshold) return { blocked: true, reason: "repeat-spam" };
  return { blocked: false };
}
