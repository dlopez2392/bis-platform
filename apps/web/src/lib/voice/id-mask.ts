// S-47b, owner ruling B7: on insurance accounts, SSN- and licence-shaped numbers never reach the post-call
// AI (summary, call card, suggestions). The stored transcript is untouched. Shapes, not words: a caller who
// says "seguro social" before a phone number keeps the phone number, and a bare 8- or 9-digit run with no
// money sign or separator is masked even when it was something else (the safe direction).
//
// Known limits (re-review R3, read 2026-10-22):
//  - A bare 8- or 9-digit run may be masked when it is something else: "$ 12345678" (a space after the $),
//    "10212026" (a date with no separators), "order #12345678" and "785011234" (a ZIP+4 run together) all
//    are. That is the safe direction. An email's local part is NOT masked: the "@" guard keeps it.
//  - A year followed by a 4-digit number that is not a year ("2025 1234") is still masked as 4-4. Only two
//    years side by side are excluded.
//  - Numbers spoken as WORDS ("uno dos tres") are not masked. The realtime transcription writes digits for
//    spoken numbers in practice: a labelled assumption, read in the owner's real calls.
//  - Policy numbers and VINs have no fixed shape. The prompt line (ID_RULE) covers them, not a pattern.
//  (Final-fix round, read 2026-10-22, each probed against this file:)
//  - An SSN glued to another number is NOT masked: "call 956 123-45-6789" and "4 123-45-6789" stay as
//    they are, because a digit and one separator right before it read as part of a longer number.
//  - An ID split across two turns ("my social is 123 45", then "6789") is NOT masked: each turn is
//    masked on its own, and neither half has an ID's shape.
//  - Comma-separated groups ("123, 45, 6789") are NOT masked, deliberately: allowing a comma between
//    groups also masks comma-separated year pairs ("between 2025, 2026"), which B7 forbids. Comma
//    groups appeared in 0 of 363 production calls (final review, M1 declined).
//  - The To do title clamps the reason at 140 characters AFTER the mask, so an ID that crosses the
//    cut shows as "[ID…", never as a part of the number.
import type { TranscriptEvent } from "@bis/db";

export const ID_MASK = "[ID number]";
export const ID_RULE = "Never repeat an identification number (SSN, driver's licence, policy number).";

/** Not glued to a longer number. A digit, money sign, decimal or thousands separator or slash right before
 *  blocks a match. A separator blocks it only when a DIGIT precedes that separator, so "SSN-123-45-6789"
 *  still masks while the tail of "95 62 92 16 96" does not. */
const NOT_BEFORE = String.raw`(?<![\d$.,/]|\d[-.,/ ])`;
/** And not followed by more digits (directly or after one separator), nor by "@" (an email's local part). */
const NOT_AFTER = String.raw`(?![\d.,/ -]?\d|@)`;
/** One separator in a digit-by-digit reading: a space, a hyphen, or a comma and a space ("1, 2, 3"). */
const SEP = String.raw`(?:[ -]|, )`;
/** Two years side by side ("between 2025 2026") are not a 4-4 licence (owner decision, re-review R2). */
const NOT_YEAR_PAIR = String.raw`(?!(?:19|20)\d\d[ -](?:19|20)\d\d(?!\d))`;

// The shapes masked, and the ones deliberately left out: 5-4 (ZIP+4), 2-2-4 / 4-2-2 (dates), 3-3-4 (phones).
const ID_PATTERNS: readonly RegExp[] = [
  new RegExp(String.raw`${NOT_BEFORE}\d{3}[ -]\d{2}[ -]\d{4}${NOT_AFTER}`, "g"),           // SSN 3-2-4
  new RegExp(String.raw`${NOT_BEFORE}\d{3}[ -]\d{2}[ -]\d{2}[ -]\d{2}${NOT_AFTER}`, "g"),  // SSN read 3-2-2-2
  new RegExp(String.raw`${NOT_BEFORE}\d{3}[ -]\d{3}[ -]\d{3}${NOT_AFTER}`, "g"),           // SSN read 3-3-3
  new RegExp(String.raw`${NOT_BEFORE}${NOT_YEAR_PAIR}\d{4}[ -]\d{4}${NOT_AFTER}`, "g"),    // DL read 4-4
  new RegExp(String.raw`${NOT_BEFORE}\d{2}[ -]\d{2}[ -]\d{2}[ -]\d{2}${NOT_AFTER}`, "g"),  // DL read 2-2-2-2
  new RegExp(String.raw`${NOT_BEFORE}\d{9}${NOT_AFTER}`, "g"),                             // SSN 123456789
  new RegExp(String.raw`${NOT_BEFORE}\d{8}${NOT_AFTER}`, "g"),                             // Texas DL 12345678
  // Read out digit by digit ("1 2 3 4 5 6 7 8", "1, 2, 3, …"): exactly 8 or 9 single digits, and not the
  // tail or head of a longer spoken run (a phone read digit by digit is 10).
  new RegExp(String.raw`(?<![\d$.,/-]|\d${SEP})\d(?:${SEP}\d){7,8}(?!${SEP}?\d)`, "g"),
];

/** Unicode dashes (U+2010 to U+2015, U+2212) become "-" and a no-break space (U+00A0) becomes " " BEFORE
 *  matching, so "123-45-6789" written with en dashes by a transcriber is caught. They are written as
 *  escapes here, never as the literal characters, so the range stays readable. The returned text is the
 *  normalised text. */
function normalise(text: string): string {
  return text.replace(/[\u2010-\u2015\u2212]/g, "-").replace(/\u00A0/g, " ");
}

export function maskIdNumbers(text: string): string {
  return ID_PATTERNS.reduce((t, re) => t.replace(re, ID_MASK), normalise(text));
}

export function maskTranscript(events: TranscriptEvent[]): TranscriptEvent[] {
  return events.map((e) => ({ ...e, text: maskIdNumbers(e.text) }));
}
