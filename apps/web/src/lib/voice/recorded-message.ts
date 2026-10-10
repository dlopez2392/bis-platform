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

/**
 * WHAT THE KEY IS FOR, from a CLOSED list: the purposes a broadcaster offers
 * and a caller's own story does not (review round 1, 2026-10-09).
 *
 * The command alone is not enough. "press 1 for appointments", "it said
 * press 2 for service", "press 1 for English" are a CUSTOMER retelling the
 * menu they got when they last rang — and a hangup on that customer leaves
 * no trace they called. What a robocall offers is a way to reach ITS agent,
 * to get off ITS list, or to hear more of its pitch; that is the list.
 *   - speak/talk with/to an agent, representative, operator, specialist or
 *     advisor (one word may qualify it: "a warranty specialist")
 *   - opt out, be removed from OUR list, stop receiving calls
 *   - more information
 */
const EN_PURPOSE_AFTER_TO =
  "(?:(?:speak|talk)\\s+(?:with|to)\\s+(?:(?:an?|our|one\\s+of\\s+our)\\s+)?(?:[a-z]+\\s+)?"
  + "(?:agent|representative|operator|specialist|advisor)s?"
  + "|opt\\s+out|be\\s+removed\\s+from\\s+our\\s+list|stop\\s+receiving\\s+(?:these\\s+|our\\s+)?calls"
  + "|(?:receive|get|hear)\\s+more\\s+information)";
const EN_PURPOSE_AFTER_FOR =
  "(?:more\\s+information|(?:an?\\s+)?(?:live\\s+)?(?:agent|representative|operator))";
const IVR_INSTRUCTION = new RegExp(
  // "press 0 to speak with an agent", "press nine to opt out",
  // "press 1 for more information" — and never "press 1 for appointments".
  `\\bpress\\s+${DIGIT}\\s+(?:to\\s+${EN_PURPOSE_AFTER_TO}|for\\s+${EN_PURPOSE_AFTER_FOR})\\b`,
  "i",
);

/**
 * The opt-out clause on its own, without a keypad command: only the
 * list-holder's own words, "to be removed from OUR list". A customer says
 * "I'd like to opt out of the texts", "I'm calling to unsubscribe", "please
 * take me off this list" — each of them is a person asking to be left alone,
 * and hanging up on them is the false positive that is never seen. (Opt out
 * still counts after a keypad command, above: "press 9 to opt out".)
 */
const OPT_OUT = /\bto\s+be\s+removed\s+from\s+our\s+list\b/i;

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
 * The digit may come bare or after "el", "el número" or "la tecla".
 *
 * The "y / yo / que" guard is a PARTIAL defence and nothing more: it keeps
 * out a quoted command in its commonest frame ("me dijeron que oprima el 1
 * para hablar con un agente") at the cost of a script that says "le pedimos
 * que oprima…". The real defence is the closed purpose list below; this only
 * narrows the quoting gap it cannot close (see the test file's KNOWN GAP).
 */
const ES_COMMAND = `(?<!\\b(?:y|yo|que)\\s+)\\b(?:oprima|presione|pulse|marque)\\s+(?:el\\s+(?:n[uú]mero\\s+)?|la\\s+tecla\\s+)?${ES_DIGIT}`;

/**
 * WHAT THE KEY IS FOR — the same CLOSED list as English, in Spanish (review
 * round 1). "presione el 1 para citas", "oprima 2 para español", "marque el
 * 3 para mi extensión" are customers retelling a menu or giving their own;
 * "para citas" and "para servicio" are what a real business's menu offers,
 * which is exactly why a customer repeats them. A robocall offers:
 *   - hablar con un agente / representante / operador / especialista /
 *     asesor (or "uno de nuestros …")
 *   - no recibir más llamadas
 *   - ser eliminado / removido … de NUESTRA lista
 *   - (recibir) más información
 * The accent-dropped past tense ("presione", "marque") is spelled exactly
 * like the command, so the PURPOSE is what tells a story from a script.
 */
const ES_PURPOSE =
  "(?:hablar\\s+con\\s+(?:(?:un|una|uno\\s+de\\s+nuestros|una\\s+de\\s+nuestras|nuestros?|nuestras?)\\s+)?"
  + "(?:agente|representante|operador|operadora|especialista|asesor|asesora)(?:es|s)?"
  + "|no\\s+recibir\\s+m[aá]s\\s+llamadas"
  + "|ser\\s+(?:eliminad|removid|borrad|retirad|quitad)[oa]s?\\s+de\\s+nuestras?\\s+listas?"
  + "|(?:recibir\\s+|obtener\\s+)?m[aá]s\\s+informaci[oó]n)";

/** Introduces the purpose: "para …", or "si desea / si quiere / si gusta …".
 *  A bare "si" is not one ("si no contesto, marque el 2." is a customer),
 *  and needing the purpose AFTER it means a partial transcript ending
 *  "…marque el uno si" — the first half of "siete" — can never match. */
const ES_FOR = "(?:para|si\\s+(?:desea|quiere|gusta))";

/** "oprima 1 para hablar con un agente", "marque el 1 si desea hablar con un
 *  especialista" — command, digit, purpose: the English rule's order. */
const ES_IVR_COMMAND_FIRST = new RegExp(`${ES_COMMAND}\\s+${ES_FOR}\\s+${ES_PURPOSE}\\b`, "i");

/**
 * "Para hablar con un representante, oprima 1." — purpose FIRST, which
 * Spanish scripts use far more than English ones. The purpose must be one
 * from the closed list; up to a few words may follow it ("…con un
 * representante de servicio al cliente, oprima 1") but not a sentence break.
 */
const ES_IVR_PURPOSE_FIRST = new RegExp(
  `\\b${ES_FOR}\\s+${ES_PURPOSE}[^.;:!?¿¡]{0,40}?,?\\s+${ES_COMMAND}`,
  "i",
);

/**
 * The broadcaster's opt-out with no keypad command: only the list-holder's
 * own words, "para ser eliminado de NUESTRA lista" (or "darse de baja de
 * nuestra lista"). A customer says "¿qué hago para ser removido de esta
 * lista?" or "para darse de baja del servicio" — asking to be left alone, or
 * cancelling a plan — and hanging up on them is never seen. "para no recibir
 * más llamadas" alone is the same: a customer says it too. After a keypad
 * command, the rules above count it.
 */
const ES_OPT_OUT = /\bpara\s+(?:ser\s+(?:eliminad|removid|borrad|retirad|quitad)[oa]s?|darse\s+de\s+baja)\s+de\s+nuestras?\s+listas?\b/i;

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
