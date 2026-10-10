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

// ─── Spanish (F-010) ────────────────────────────────────────────────────────
//
// The SAME two signals, said in Spanish — never a third. Keyed on what the
// script tells the caller to DO, never on what it is about: "lo encontré en
// Google" is a customer, exactly as "I found you on Google" is.
//
// No real Spanish robocall is on record yet. The shapes below are the ones US
// Spanish IVR scripts use (usted commands, digits after "el"), which is an
// assumption until a real call's transcript confirms or corrects it.

const ES_DIGIT = "(?:[0-9]|cero|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve)";

/**
 * The keypad COMMAND, usted form only: oprima, presione, pulse, marque.
 *
 * Only the command. The past tense a customer uses to tell a story is
 * "oprimí / presioné / pulsé / marqué" — the accent makes it a different
 * word, and "oprimí" stays different even with the accent dropped. Where
 * dropping it collides ("presione", "marque"), the narrative almost always
 * carries a subject in front — "llamé y presione el 1", "me dijo que marque
 * el 2" — so a command right after "y", "yo" or "que" is not judged a
 * command. The tú forms ("oprime", "presiona") are left out on purpose:
 * "presiona" is also the plain present ("cuando uno presiona el 1…").
 *
 * The digit may come bare or after "el", "el número" or "la tecla". Each
 * rule below then says what must FOLLOW it, and that is what tells a keypad
 * option from a person reading out "marque el 956 555 0134".
 */
const ES_COMMAND = `(?<!\\b(?:y|yo|que)\\s+)\\b(?:oprima|presione|pulse|marque)\\s+(?:el\\s+(?:n[uú]mero\\s+)?|la\\s+tecla\\s+)?${ES_DIGIT}`;

/** "oprima 1 para hablar con un agente", "marque el 9 si desea…" — the
 *  English rule's order: command, digit, purpose. */
const ES_IVR_COMMAND_FIRST = new RegExp(`${ES_COMMAND}\\s+(?:para|si)\\b`, "i");

/**
 * "Para hablar con un representante, oprima 1." — purpose FIRST, which
 * Spanish scripts use far more than English ones, and which leaves nothing
 * after the digit for the rule above to see.
 *
 * The purpose clause cannot cross a sentence.
 *
 * AND THE DIGIT MUST BE SEEN TO END — a full stop, or "(,) o …" offering the
 * next option. That is what keeps a phone number out: "…marque el 956…" and
 * "…marque el 9, 5, 6…" never end on their first digit. And it is the ONLY
 * thing that can, because this predicate runs on the caller's turn while
 * they are still talking (`call-events.ts` judges every transcription
 * delta's prefix): "Para cualquier cosa, marque el nueve" is a complete
 * purpose-then-command right up until " cinco seis" arrives, and no
 * look-ahead for a next digit can see a digit that has not been said yet.
 * The rule above needs no such ending because "para"/"si" after the digit
 * already is one.
 *
 * What it costs, both ways: an unpunctuated script that stops on its digit
 * is missed here; a caller who dictates a number as "9. 5. 6." after a
 * "para …," and past the length floor would be judged at "9." — not seen in
 * any transcript on record, and left for a real call to show.
 */
const ES_IVR_PURPOSE_FIRST = new RegExp(
  `\\b(?:para|si)\\s+[^.;:!?¿¡]{1,60}?,?\\s+${ES_COMMAND}(?=\\s*(?:[.;!?]|,?\\s+o\\b))`,
  "i",
);

/**
 * The broadcaster's opt-out. Only what a list-holder says: "para ser
 * eliminado de nuestra lista", "para darse de baja".
 *
 * NOT "para no recibir más llamadas" on its own, though scripts say it: a
 * customer fed up with sales calls says it too ("¿qué hago para no recibir
 * más llamadas de ustedes?"). After a keypad command — "oprima 9 para no
 * recibir más llamadas" — the command rules above already catch it.
 */
const ES_OPT_OUT = /\bpara\s+(?:ser\s+)?(?:eliminad|removid|borrad|retirad|quitad)[oa]s?\s+de\s+(?:nuestra|esta)s?\s+listas?\b|\bpara\s+darse\s+de\s+baja\b/i;

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
  return IVR_INSTRUCTION.test(t) || OPT_OUT.test(t)
    || ES_IVR_COMMAND_FIRST.test(t) || ES_IVR_PURPOSE_FIRST.test(t) || ES_OPT_OUT.test(t);
}
