// Is this caller turn a RECORDING rather than a person?
//
// Pure decision logic, the same shape as `silence-guard.ts` and
// `call-limits.ts` and for the same reason: no socket, no timers, no database,
// so the judgement is trivially testable and the lifecycle keeps only the
// wiring.
//
// WHAT THIS EXISTS TO STOP, in one row: on 2026-09-17 the only real client on
// the platform — 956 Woodworks, live for one day — took nine calls. Eight were
// the same scam robocall, from eight different local numbers, roughly hourly.
// Every one was recorded as `abandoned`, so the owner's dashboard told him he
// had lost eight customers in a day, the weekly report would have inflated
// "calls answered" by eight and crushed his conversion to zero, and each one
// billed ~53 seconds of OpenAI Realtime and Telnyx to his account for nothing.
//
// WHY THE EXISTING GUARDS CANNOT SEE THESE. `silence-guard.ts` catches a
// caller who never speaks; a robot talks. `caller-reputation.ts` catches a
// number that has called before and been marked spam; these rotate through
// fresh local numbers, so every call is a first offence. Neither is wrong —
// this is a third shape.
//
// WHAT #88 DID AND DID NOT DO. It fixed the LABEL — spam, not abandoned —
// and it did not shorten the call, because the predicate below was only
// ever handed the COMPLETED turn, and for a robot that means the moment the
// script ends. Calls before and after it both cost 38–56 seconds. The
// `.delta` case in call-events.ts is what fixes the bill: the same
// predicate, run on the transcript as far as it has got, so the hangup
// lands at the first "press 0" rather than at "thank you".
//
// ❌ AND WHY IT IS NOT KEYED ON THE MODEL'S OWN OPINION, which was the obvious
// idea and is in the transcripts: Sofía sometimes names them ("It sounds like
// this might be an automated marketing message"). Across the nine calls she
// did so exactly TWICE. Six times she declined the REQUEST without
// identifying the CALLER ("I can't assist with Google listings"), and twice
// she did not notice at all and simply re-greeted. A hangup on that signal
// fires on a coin flip.
//
// What IS invariant is the caller side: a recording delivers a script, and the
// script tells you which key to press. No human calling a woodworking shop
// says "press 9 to opt out".

/**
 * The IVR instruction — "press <digit> to <do something>".
 *
 * THIS, AND NOT THE PRETEXT, IS THE SIGNAL. The pretext is whatever scam is
 * current: Google listings this week, a vehicle warranty the next. The
 * instruction is what makes the thing a recording, and it is the one part a
 * person does not produce.
 *
 * ⚠️ IT IS DELIBERATELY NOT KEYED ON "Google". That was the tempting
 * heuristic — the word appears five times in the real script — and it would
 * hang up on "Hi, I found you on Google and I wanted to ask about a dining
 * table". That caller is a lead, the hangup leaves no trace they ever rang,
 * and the owner never learns. A false positive here is silently worse than
 * every robocall this guard will ever catch, which is why the negatives in
 * the test file outnumber the positives.
 *
 * Digits are matched as words too (`zero`, `nine`): the transcriber renders
 * them either way and has no obligation to be consistent between calls.
 */
const DIGIT = "(?:[0-9]|zero|one|two|three|four|five|six|seven|eight|nine)";
const IVR_INSTRUCTION = new RegExp(
  // "press 0 to speak", "press nine to be removed", "press 1 for sales"
  `\\bpress\\s+${DIGIT}\\s+(?:to|for|and|if)\\b`,
  "i",
);

/**
 * The opt-out clause, which is the other thing only a broadcaster says. A
 * caller has nothing to opt out OF.
 */
const OPT_OUT = /\b(?:to\s+opt\s+out|to\s+be\s+removed\s+from\s+(?:our|this)\s+list|to\s+unsubscribe)\b/i;

/**
 * How much text before this guard will judge at all.
 *
 * A recording delivers a script; the real one is 470 characters. This floor is
 * not about the length being suspicious — plenty of real callers monologue,
 * and the test file has one doing it — it is about not judging a FRAGMENT.
 * "press 1" on its own is a caller answering a question, or the transcriber
 * cutting a turn in half, and either way there is not enough there to end a
 * call over.
 */
const MIN_LENGTH = 120;

/**
 * True when this caller turn reads as a recorded broadcast rather than a
 * person.
 *
 * BOTH conditions, never either: enough text to be a script, AND an
 * instruction only a broadcaster gives. Length alone catches the rambling
 * customer. The instruction alone catches a transcription fragment. Requiring
 * both is what makes the negatives in the test file hold.
 */
export function looksLikeRecordedMessage(text: string): boolean {
  const t = text.trim();
  if (t.length < MIN_LENGTH) return false;
  return IVR_INSTRUCTION.test(t) || OPT_OUT.test(t);
}
