/**
 * S-09 PR 2: the language a scheduled customer message goes out in, which body it sends, whether
 * the stored Spanish is stale, and what a save stores. Pure and import-free (types only), so the
 * browser bundle can take it through the `@bis/db/spanish-box` subpath without the barrel's
 * database client: the nine cards that render the Spanish box import `spanishIsStale` from here
 * rather than mirroring it. Re-exported from `./messaging` and the barrel, so server imports are
 * unchanged.
 */

// ---------------------------------------------------------------------------
// S-09 PR 2: the language a scheduled customer message goes out in, and which
// body it sends. Pure; every scheduled due-list's mapper calls
// `recipientLanguage` once (spec C12) and every sender calls `chooseBody`.
// ---------------------------------------------------------------------------

export type RecipientLanguage = "en" | "es";
const asLanguage = (v: string | null | undefined): RecipientLanguage | null => (v === "en" || v === "es" ? v : null);

/** L3: the contact's language, else the account's (0065, its second reader since 0076), else English. */
export function recipientLanguage(
  contactLanguage: string | null | undefined, accountLanguage: string | null | undefined,
): RecipientLanguage {
  return asLanguage(contactLanguage) ?? asLanguage(accountLanguage) ?? "en";
}

export type BodyDefaults = { en: string; es: string };

/**
 * C11 + C13. English: theirs, else ours. Spanish: NULL is our written Spanish; an EMPTIED box
 * ('' after trim) sends the English AND switches the whole message to English, because the
 * returned `language` is the one the subject, date, button and footer follow.
 */
export function chooseBody(input: {
  language: RecipientLanguage; body: string; bodyEs: string | null; defaults: BodyDefaults;
}): { language: RecipientLanguage; text: string } {
  const english = { language: "en" as const, text: input.body.trim() || input.defaults.en };
  if (input.language === "en") return english;
  if (input.bodyEs === null) return { language: "es", text: input.defaults.es };
  const theirs = input.bodyEs.trim();
  return theirs ? { language: "es", text: theirs } : english;
}

/**
 * C14, spec §12.3: a comparison with the English the Spanish was written beside. No clock.
 * "Emptied" is trim-empty, not literally `''` (orchestrator fix 2): a box left all-whitespace
 * reads the same as emptied, or it would warn about a Spanish body nobody can send. The basis
 * comparison trims both sides too (orchestrator fix 3), so a caller that stores the English with
 * different surrounding whitespace than this one reads can't produce a permanent false warning —
 * callers still pass the exact English they store (see `nextSpanishBox`'s docstring).
 */
export function spanishIsStale(input: { body: string; bodyEs: string | null; bodyEsBasis: string | null }): boolean {
  if (input.bodyEs !== null && input.bodyEs.trim() === "") return false;
  if (input.body.trim() === "" && input.bodyEs === null) return false;
  const basis = input.bodyEsBasis === null ? null : input.bodyEsBasis.trim();
  return basis !== input.body.trim();
}

/**
 * The save side (plan deviation 3). Order matters (finding F1): an unchanged box keeps what is
 * stored; "Use our Spanish" stores NULL; a box equal to our default stores NULL (the 0024
 * discipline); anything else is theirs, '' meaning emptied. Callers pass `body` as the EXACT
 * English they are about to store, not a re-derived or re-trimmed copy — `spanishIsStale`'s own
 * trim guards against incidental whitespace drift, but the basis itself should be the real stored
 * value.
 *
 * The basis moves to the new English only when the Spanish changed IN THIS SAVE to a WRITTEN
 * value (text or '') or "The Spanish still matches" was ticked (orchestrator fix 1). An unchanged
 * box keeps the stored basis. Choosing our Spanish (the new value is `null`) CLEARS the basis
 * instead (orchestrator fix, case B) — unless the box is ticked, our Spanish has not been checked
 * against this English, so there is nothing a later staleness check could honestly compare it to;
 * leaving the old basis in place would read a written Spanish that was just REPLACED by our
 * default as still matching an English it was never checked against.
 */
export function nextSpanishBox(input: {
  submitted: string; useOurs: boolean; stillMatches: boolean; defaultEs: string; body: string;
  stored: { bodyEs: string | null; basis: string | null };
}): { bodyEs: string | null; basis: string | null } {
  const text = input.submitted.trim();
  let bodyEs: string | null;
  if (input.useOurs) bodyEs = null;
  else if (input.stored.bodyEs !== null && text === input.stored.bodyEs.trim()) bodyEs = input.stored.bodyEs;
  else if (text === input.defaultEs.trim()) bodyEs = null;
  else bodyEs = text;
  const changed = bodyEs !== input.stored.bodyEs;
  const basis = input.stillMatches ? input.body : !changed ? input.stored.basis : bodyEs === null ? null : input.body;
  return { bodyEs, basis };
}
