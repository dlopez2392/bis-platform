// Pure decision logic for refusing a caller who has proven they are a robot
// (spam-screening spec, Guard 2). Shaped like `call-limits.ts` — no database,
// so the decision is trivially unit-testable — and serving the purpose
// `accept-gate.ts` states: ONE predicate that BOTH voice gates call, so the
// TeXML route's spoken refusal and the webhook's silent decline can never
// drift out of agreement.
//
// The try/catch and fail-open wrapping live in the routes, not here.

export type ReputationConfig = {
  threshold: number;
  windowDays: number;
  /** Callers this guard never blocks — see `readReputationConfig`. */
  exempt: readonly string[];
};
export type ReputationVerdict = { blocked: false } | { blocked: true; reason: "repeat-spam" };

/** Counts over the window, from `countCallerHistorySince`. `spamCalls`
 *  counts ONLY rows with at least one turn — see the exclusion note there. */
export type CallerHistory = { spamCalls: number; otherCalls: number };

const DEFAULTS: ReputationConfig = { threshold: 3, windowDays: 30, exempt: [] };

/** Byte-for-byte the same helper as `call-limits.ts:15-18`, and DELIBERATELY
 *  a copy rather than a shared import: that twin does not export it, and a
 *  self-contained pure module — no imports at all — is the point of this file,
 *  the same way `call-limits.ts` is self-contained. Do not DRY the two into a
 *  third module, and do not add a third copy either: a fourth knob belongs in
 *  one of these two files. The rule it encodes is the house rule for every env
 *  knob in this feature — junk, zero or negative falls back to the default, so
 *  a mistyped value can never disable a guard (here, a `threshold` of 0 would
 *  block every caller on their first silent call). */
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
    exempt: exemptList(env.PHONE_SPAM_EXEMPT_CALLERS),
  };
}

/**
 * The operator's own phones, in +E.164, comma-separated.
 *
 * This exists because the guard is scoped PER ACCOUNT
 * (`countCallerHistorySince` filters on `account_id`), which makes a brand-new
 * company the one place a known-good caller has no history to clear them with.
 * On 2026-09-16 the agency's own test phone stood at one silent call and zero
 * good calls on a client created that day — two more test calls and the person
 * who built the product would have been refused by it.
 *
 * Deliberately NOT a per-account setting and NOT a database table: this is the
 * agency's handful of handsets, the same on every account, and a knob that
 * only ever holds two or three values does not need a schema. It sits beside
 * the other voice knobs in the environment, where the house rule applies —
 * junk is ignored rather than taken literally.
 *
 * Empty, unset or whitespace yields NO exemptions, which is the safe
 * direction: a parsing mistake leaves the guard fully armed rather than
 * silently disarming it for everyone. Note that is the opposite polarity to
 * `positiveInt` above, and for the same reason — both fall back to the value
 * that keeps the guard working.
 */
function exemptList(raw: string | undefined): readonly string[] {
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
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
 *
 * THE VERDICT'S POLARITY IS A DECISION, NOT AN ACCIDENT. This returns
 * `blocked` where `callAnswerable` returns `answerable` and `decideLimit`
 * returns `allowed` — the two senses are now mixed across three call sites,
 * so it is worth saying why: `blocked` is the word an operator would use for a
 * reputation verdict, and the alternative (`allowed: false, reason:
 * "repeat-spam"`) reads as "not allowed for reasons" rather than "we know this
 * caller". Both routes therefore keep the two verdicts in SEPARATE fields and
 * never combine them into one boolean — that is where an inverted sense would
 * become a silent fail-open, and both routes' step-8 comments say so.
 */
export function decideReputation(
  history: CallerHistory, cfg: ReputationConfig, callerE164?: string | null,
): ReputationVerdict {
  // FIRST, before any counting. An exempt caller is never blocked whatever
  // their history says — that is the whole point, and checking it after the
  // threshold would make the exemption depend on the very counts it exists to
  // ignore. Compared as an exact string: every caller number reaching here has
  // already been normalised to +E.164 by `extractCallerNumber`/`toE164`, and
  // re-normalising would mean an import, which this module deliberately has
  // none of.
  if (callerE164 && cfg.exempt.includes(callerE164)) return { blocked: false };
  if (history.otherCalls > 0) return { blocked: false };
  if (history.spamCalls >= cfg.threshold) return { blocked: true, reason: "repeat-spam" };
  return { blocked: false };
}
