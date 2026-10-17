import { matchKeyword, CANCEL_WORDS } from "./keywords";
import { matchPhrase, normalisePhraseText } from "./phrases";

/**
 * EMAIL-ONLY stop sentences (owner ruling, fix round 1, 2026-10-16): email-specific wording that
 * never reaches the SMS phrase list (phrases.ts, which this module never edits — a text's "stop
 * texting" means nothing about email and vice versa). Every one of these is UNCLEAR, like every
 * other sentence phrase: a stop SENTENCE only ever offers staff the Stop emails action, never
 * applies itself. "unsubscribe me" is covered already (phrases.ts's own PHRASES_EN) and is
 * deliberately not repeated here. Matched the same way the texts' matcher folds accents and case
 * (`normalisePhraseText`), as whole words anywhere in the message — a false "may want to stop"
 * chip on an unusual sentence (e.g. a negation) costs staff one click, never a wrongly-applied
 * stop, so this list does not try to parse negation (owner ruling: "don't over-engineer").
 */
const EMAIL_ONLY_STOP_PHRASES: readonly string[] = [
  "stop emailing", "stop sending emails", "no more emails", "dont email me", "do not email me",
  "remove me from your email list", "take me off your email list",
  "no mas correos", "no me manden correos", "no me envien correos", "dejen de enviarme correos",
  "darme de baja", "quiero darme de baja", "ya no quiero correos",
];

function matchEmailOnlyPhrase(text: string): string | null {
  const hay = ` ${normalisePhraseText(text)} `;
  return EMAIL_ONLY_STOP_PHRASES.find((p) => hay.includes(` ${p} `)) ?? null;
}

/**
 * The emailed stop (spec "The stop rule"; plan G4): the texts' own matchers, on a reply's NEW text
 * only (never the quoted history). A stop keyword is clear and is applied at once; CANCEL/CANCELAR
 * (a reply to a reminder means the appointment) and any stop sentence are unclear and only offer
 * staff the Stop emails action. Tried on the whole text, then on its first non-blank line, so a
 * phone's signature under "STOP" does not hide it.
 */
export type EmailStopClass = { kind: "clear"; phrase: string } | { kind: "unclear"; phrase: string } | { kind: "none" };

function classifyOne(text: string): EmailStopClass {
  const k = matchKeyword(text);
  if (k?.kind === "stop") return CANCEL_WORDS.has(k.word) ? { kind: "unclear", phrase: k.word } : { kind: "clear", phrase: k.word };
  const p = matchPhrase(text);
  if (p) return { kind: "unclear", phrase: p.phrase };
  const e = matchEmailOnlyPhrase(text);
  return e ? { kind: "unclear", phrase: e } : { kind: "none" };
}

export function classifyEmailStop(newText: string): EmailStopClass {
  const trimmed = newText.trim();
  const firstLine = newText.split(/\r?\n/).map((l) => l.trim()).find((l) => l !== "") ?? "";
  const whole = classifyOne(newText);
  const first = firstLine && firstLine !== trimmed ? classifyOne(firstLine) : null;
  // Fix round 1 (coordinator review): clear wins wherever it is found — the whole text or the
  // first line — because a clear keyword is applied AT ONCE and must never be hidden behind an
  // unclear phrase elsewhere in the same reply. Failing that, the first unclear result found
  // (whole text checked first, matching the order a staff member reads the reply in) still asks
  // staff; only when NEITHER answers anything is the reply "none".
  if (whole.kind === "clear") return whole;
  if (first?.kind === "clear") return first;
  if (whole.kind === "unclear") return whole;
  if (first?.kind === "unclear") return first;
  return { kind: "none" };
}
