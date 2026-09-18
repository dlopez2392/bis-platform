import { cache } from "react";
import { unstable_rethrow } from "next/navigation";
import { isUsableZone, resolveZone, serviceDb, type ResolvedZone } from "@bis/db";

/**
 * The zone a screen renders in, resolved the SAME way for every screen and
 * for both audiences.
 *
 * WHAT THIS REPLACES. Five screens each grew their own answer for an
 * unusable `accounts.timezone`: four clamped silently to UTC
 * (`safeZone(account.timezone, "UTC")`), the work queue omitted the date
 * rather than guess, and the account dashboard did BOTH, fifty lines apart.
 * `resolveZone` (packages/db) decides the zone; this module is the one place
 * that feeds it the agency's zone, so no screen has to know how.
 *
 * ⚠️ FIVE SCREENS, NOT EVERY READER — the claim is deliberately narrow.
 * `lib/website/load.ts:26` still calls `safeZone(…, "America/Chicago")`, a
 * SIXTH reader with a different fallback again, and its zone decides which
 * local day a visitor count lands in — a stronger consequence than a date
 * label. `automations/sms-reminder-card.tsx` clamps to UTC for its preview
 * time. Both are outside this change's brief and neither has a zone note.
 * Do not read "one rule" as "done"; read it as "done for the five screens
 * the brief named".
 *
 * ── WHY serviceDb, AGAINST `lib/db.ts`'s OWN RULE ──────────────────────────
 * `dbForRequest`'s doc comment says: do NOT reach for serviceDb() on the
 * in-account surface, because the database backstop is what turns a missed
 * account scope into zero rows instead of another tenant's data. That rule is
 * right, and this is a deliberate, argued exception to it — not an oversight.
 *
 * `agencies` carries exactly ONE RLS policy: `app.is_agency()`. A CLIENT-role
 * reader cannot see the row at all. Through `dbForRequest` the agency step of
 * the chain would therefore be invisible to exactly half the audience, and on
 * an account with a broken zone the agency would read `America/Chicago` while
 * the client read `UTC` — the same call showing two different DAYS depending
 * on who opened the page. That is the previous-day defect this entire body of
 * work exists to end, re-introduced along a new seam.
 *
 * The rule's stated reason does not bite here: `agencies` is a SINGLETON with
 * no `account_id`, so there is no account scope to miss and nothing for the
 * backstop to backstop. One non-tenant column is read, never written, and it
 * only ever reaches a screen as the name of the zone a date is printed in —
 * which the note beside that date says out loud.
 *
 * Approved by danlo, 2026-09-18, over accepting the role split and over a
 * migration widening the policy. If `agencies` ever stops being a singleton,
 * this is the call site to revisit FIRST.
 */

/**
 * The agency's own zone, read once per request.
 *
 * `cache()` because a single render can resolve the zone more than once (the
 * account dashboard reads it for its KPI windows and again for its work row)
 * and this must be one query, not one per caller.
 *
 * TOTAL: a failure here returns `undefined`, which `resolveZone` reads as
 * "the agency's zone is not usable either" and answers with UTC. A dashboard
 * must not blank because a cosmetic zone label could not be read — the same
 * reasoning that makes `resolveZone` itself total. The log line is the only
 * trace, and it is enough: the visible outcome is a zone note saying UTC,
 * which is already the signal that something needs fixing.
 */
const readAgencyZone = cache(async (): Promise<string | undefined> => {
  try {
    const { data, error } = await serviceDb()
      .from("agencies")
      .select("timezone")
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as { timezone: string | null } | null)?.timezone ?? undefined;
  } catch (e) {
    // Next's own control-flow errors travel as exceptions (the dynamic-usage
    // bailout, redirect(), notFound()). Swallowing those would turn a
    // framework signal into a silent "no agency zone" answer. Same rule, same
    // reason, as `tenant-theme-reader.ts`'s own catch. Not reachable today —
    // all five callers are `force-dynamic` and neither PPR nor dynamicIO is
    // enabled — which is exactly why it is cheap to get right now rather than
    // on the day one of those pages stops being force-dynamic.
    unstable_rethrow(e);
    console.error(`renderZone: agency timezone read failed, falling back: ${String(e)}`);
    return undefined;
  }
});

/**
 * Resolves the zone this render should print dates in.
 *
 * Takes the account's raw zone rather than reading it, because each screen
 * already reads the account row — and they disagree on purpose about what a
 * MISSING row means (Calls throws, the checklist deliberately does not).
 * Re-reading it here would either duplicate that query or overrule those
 * decisions.
 */
export async function renderZone(accountZone: string | undefined): Promise<ResolvedZone> {
  // SHORT-CIRCUIT, and it is not an optimisation detail — it is the
  // difference between five screens costing one extra query per render and
  // costing none. `resolveZone` consults the agency only when the account's
  // own zone is unusable, but `await readAgencyZone()` as an ARGUMENT is
  // evaluated before `resolveZone` ever runs, so the naive spelling queried
  // `agencies` on every render of every one of these pages — for a value it
  // then discarded, on every account the platform currently has (#89 shut
  // the write path; all of them are configured).
  //
  // The SAME predicate `resolveZone` itself branches on, called by name
  // rather than re-implemented, so the two cannot drift into disagreeing
  // about what "usable" means — which is exactly how the five readers this
  // work replaces diverged in the first place.
  if (isUsableZone(accountZone)) return resolveZone(accountZone, undefined);
  return resolveZone(accountZone, await readAgencyZone());
}
