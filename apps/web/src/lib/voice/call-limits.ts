// Pure decision logic for the incoming-call webhook's abuse cap (spec §8).
// Ported from the reception demo's `call-limits.ts`, re-shaped for the
// platform's multi-tenant caps: per-CALLER-NUMBER and per-ACCOUNT (not the
// demo's single-tenant "global"), and counted from the `calls` table itself
// via `@bis/db`'s `countCallsSince`/`countCallsByCallerSince` rather than a
// Redis counter — there is no separate counting store here, the row the
// route writes at accept-time IS the count. That wrapping (try/catch,
// fail-open) lives in the route, not here: this module stays pure so the
// decision itself is trivially unit-testable without a database.
export type LimitConfig = { perNumberPerDay: number; perAccountPerDay: number };
export type LimitVerdict = { allowed: true } | { allowed: false; reason: "per-number" | "per-account" };

const DEFAULTS: LimitConfig = { perNumberPerDay: 5, perAccountPerDay: 50 };

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function readLimitConfig(env: NodeJS.ProcessEnv = process.env): LimitConfig {
  return {
    perNumberPerDay: positiveInt(env.PHONE_MAX_CALLS_PER_NUMBER_PER_DAY, DEFAULTS.perNumberPerDay),
    perAccountPerDay: positiveInt(env.PHONE_MAX_CALLS_PER_ACCOUNT_PER_DAY, DEFAULTS.perAccountPerDay),
  };
}

/**
 * Strictly-greater-than: the Nth call is still allowed, only the (N+1)th is
 * declined. `countCallsSince`/`countCallsByCallerSince` count rows already
 * started today (including THIS call, once its row exists) — but caps are
 * checked before `startCallRow` runs (flow step 8, before step 10), so the
 * count here is calls-before-this-one. A `perNumberPerDay: 5` config must
 * therefore let the 5th call through and decline the 6th, not the reverse.
 */
export function decideLimit(counts: { forNumber: number; forAccount: number }, cfg: LimitConfig): LimitVerdict {
  // Per-number first: it is the actionable, loggable reason — a single
  // caller hammering one line, not the account's overall volume.
  if (counts.forNumber > cfg.perNumberPerDay) return { allowed: false, reason: "per-number" };
  if (counts.forAccount > cfg.perAccountPerDay) return { allowed: false, reason: "per-account" };
  return { allowed: true };
}

/** Midnight UTC of `now`, ISO-formatted — the window floor `countCallsSince`/
 *  `countCallsByCallerSince` query against (`gte("started_at", ...)`). UTC,
 *  not the account's own timezone: caps are an abuse guardrail, not a
 *  business-hours concept, and a UTC boundary is one unambiguous instant
 *  shared by every account regardless of where they're calling from. */
export function utcDayStart(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}
