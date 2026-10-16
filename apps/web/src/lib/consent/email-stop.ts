import { matchKeyword, CANCEL_WORDS } from "./keywords";
import { matchPhrase } from "./phrases";

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
  return p ? { kind: "unclear", phrase: p.phrase } : { kind: "none" };
}

export function classifyEmailStop(newText: string): EmailStopClass {
  const whole = classifyOne(newText);
  if (whole.kind !== "none") return whole;
  const firstLine = newText.split(/\r?\n/).map((l) => l.trim()).find((l) => l !== "") ?? "";
  return firstLine && firstLine !== newText.trim() ? classifyOne(firstLine) : { kind: "none" };
}
