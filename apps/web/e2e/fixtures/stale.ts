/**
 * What counts as an abandoned e2e fixture — and, far more importantly, what
 * does not.
 *
 * `auth.teardown.ts` only runs when a suite COMPLETES. Every killed run — a
 * Ctrl-C, a crashed dev server, a timeout that takes the process with it —
 * therefore strands a real Clerk user, a real Clerk org, real Postgres rows
 * and a real public object in Storage in the SHARED dev environment. That has
 * already cost this project a stranded Clerk identity and a public file that
 * `delete from storage.objects` cannot remove, and both had to go on a human's
 * to-do list. Cleaning up before a run is what makes cleanup unconditional;
 * cleaning up after is what makes it optional.
 *
 * This module is pure and I/O-free so the decision can be tested directly,
 * because the decision is the whole risk: everything downstream of it deletes
 * things in a database that also holds real accounts. `sweep.ts` performs no
 * matching of its own — it asks these functions and nothing else.
 */

/**
 * `E2E Client Co 1786412389258`. Anchored at both ends and the stamp is
 * exactly 13 digits, so a real company that merely STARTS with those words
 * ("E2E Client Co-op", "E2E Client Corporation") does not match, and neither
 * does a name with trailing whitespace or a second stamp appended.
 */
export const FIXTURE_ACCOUNT_RE = /^E2E Client Co (\d{13})$/;

/** `e2e-client-1786412389258@example.com`, built in auth.setup.ts. */
export const FIXTURE_EMAIL_RE = /^e2e-client-(\d{13})@example\.com$/;

/**
 * `E2E Form 1789613520660` or `E2E Spam 1789613520660` — the two names
 * `forms.spec.ts` mints, always on the SEEDED account (`Test Client One`),
 * never on a per-run fixture account. That account also carries real forms
 * ("Quote request" among them), so this is anchored just as tightly as
 * `FIXTURE_ACCOUNT_RE`: exact word, exact 13 digits, exact case, nothing
 * before or after. The `Form|Spam` alternation is non-capturing so the stamp
 * stays capture group 1 — the same shape `fixtureStamp`/`isStaleFixture`
 * already read for every other fixture pattern, which is what lets
 * `isStaleFixtureForm` below be built on those instead of re-deriving the
 * staleness math a second time.
 */
export const FIXTURE_FORM_RE = /^E2E (?:Form|Spam) (\d{13})$/;

/**
 * How long a fixture is left alone before it is considered abandoned.
 *
 * This is a concurrency guard, not a tidiness preference: a suite that is
 * running right now owns a fixture created seconds ago, and deleting it
 * mid-run would fail that run in a way that looks like a product bug. Full
 * runs measure 2.5–4.5 minutes cold, so 30 minutes is roughly seven times the
 * longest observed run — generous on purpose, since the cost of waiting is one
 * more sweep and the cost of being wrong is a red suite nobody can explain.
 */
export const STALE_AFTER_MS = 30 * 60 * 1000;

/**
 * The creation time embedded in a fixture's own name, or null if the name is
 * not a fixture's at all.
 *
 * Deliberately read from the NAME rather than from `created_at`: the Clerk
 * user, the Clerk org, the Postgres row and the Storage object are four
 * systems with four clocks and four notions of "created", and the stamp is the
 * one value all four were minted from in the same millisecond.
 */
export function fixtureStamp(value: string, pattern: RegExp): number | null {
  const match = pattern.exec(value);
  if (!match) return null;
  const stamp = Number(match[1]);
  // A 13-digit run of characters is not necessarily a plausible timestamp.
  // Anything before 2020 or in the future is a name that merely looks like a
  // fixture, and the safe answer to "is this ours?" is no.
  if (!Number.isFinite(stamp) || stamp < 1577836800000) return null;
  return stamp;
}

/**
 * True only for a name this suite minted, at least `maxAgeMs` ago.
 *
 * A future stamp returns FALSE — clock skew between this machine and whatever
 * created the row must never read as "very old", which is the direction that
 * deletes something in use.
 */
export function isStaleFixture(
  value: string, pattern: RegExp, now: number, maxAgeMs: number = STALE_AFTER_MS,
): boolean {
  const stamp = fixtureStamp(value, pattern);
  if (stamp === null) return false;
  const age = now - stamp;
  return age >= maxAgeMs;
}

/**
 * True only for a form name `forms.spec.ts` minted, at least `STALE_AFTER_MS`
 * ago — the same 30-minute window every other fixture uses, so a suite
 * running right now never has its own in-progress form read as abandoned.
 */
export function isStaleFixtureForm(name: string, now: number): boolean {
  return isStaleFixture(name, FIXTURE_FORM_RE, now);
}

/**
 * Storage paths are `<accountId>/logo-<digest>.<ext>`, so the first segment is
 * the only thing tying an object to an account. An object whose account row is
 * gone is unreachable by every path in the product — nothing renders it,
 * nothing can delete it through the app — and it is public.
 */
export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
