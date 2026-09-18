// The write-time gate for `accounts.timezone`.
//
// Postgres cannot validate an IANA zone name, so this column has always been
// free text — and five screens each grew their own downstream patch for an
// unusable value. They do not agree. Four clamp silently to UTC
// (`safeZone(account.timezone, "UTC")`), which prints a Texas evening as the
// following day and says nothing about it: the previous-day defect this repo
// has already shipped once. The work queue refuses to guess and omits the
// date. The account dashboard does BOTH, fifty lines apart — its work-row
// counts use the raw zone on purpose while its KPI windows take the clamp.
//
// None of those is the fix, and a sixth patch would not be either. The fix is
// that the bad value never gets in, and the door is much narrower than the
// five readers suggest: `createAccount` is the ONLY write path for this
// column in the product. There is no settings action that changes an
// account's zone at all.
//
// Deliberately NOT a normaliser. This repo's record on columns that
// normalise rather than refuse is 0033 and 0034, two migrations spent
// discovering that a normalising column acquires a TypeScript twin which must
// agree with it on every input — and a tab-padded value got a different
// answer on each side. A column that REFUSES has no twin to disagree with.

/** Longer than any real zone name; bounds the probe against a form field. */
const MAX_ZONE_LENGTH = 64;

/**
 * Can `Intl` actually format a date in this zone?
 *
 * The constructor IS the validation — there is no list to check against, and
 * a hand-maintained one would go stale the next time the IANA database moves.
 * Its result is discarded on purpose.
 *
 * `undefined` and `""` are UNUSABLE, not defaults. Conflating "nothing was
 * supplied" with "this is fine" is how a blank form field silently becomes
 * somebody else's timezone; the default belongs to the caller, which can see
 * whether the operator left the field alone or typed something wrong.
 */
export function isUsableZone(tz: string | undefined): boolean {
  if (!tz || !tz.trim() || tz.length > MAX_ZONE_LENGTH) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns the zone, or throws naming the value and what a good one looks
 * like.
 *
 * THROWS RATHER THAN FALLING BACK, and that is the entire point of the file.
 * A fallback here would be the sixth inconsistent answer to this problem and
 * the worst of them: it would make the other five unreachable while leaving
 * them wrong, so the next person to read `safeZone(account.timezone, "UTC")`
 * would have no way to tell it is dead code guarding a state that can no
 * longer occur.
 *
 * The message is written for an OPERATOR mid-onboarding, in a form error, not
 * for a log: "Invalid timezone" tells them nothing they can act on, so it
 * names the value they typed and shows the shape that works.
 */
export function assertUsableZone(tz: string | undefined): string {
  if (!isUsableZone(tz)) {
    throw new Error(
      `"${tz ?? ""}" is not a timezone this platform can use. ` +
      `Use an IANA zone name like America/Chicago.`,
    );
  }
  return tz as string;
}
