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

// ─── How a script is told from a person (F-010 review rounds 1–3) ──────────
//
// FOUR things, all required, because each one short of them was shown to
// hang up on real customers:
//
//  1. A keypad COMMAND ("press 1", "oprima 1"), never a topic word.
//  2. A PURPOSE from a closed list — reach an agent / representative /
//     operator / specialist / advisor, opt out or stop receiving calls, be
//     removed from OUR list, more information. "press 1 for appointments",
//     "oprima 2 para español", "marque el 3 para mi extensión" are customers
//     retelling a menu or giving their own.
//  3. The instruction BEGINS A SENTENCE — start of the turn, or right after
//     . ! ? ¿ ¡ (an optional "please" / "por favor" may open it). The list
//     purposes are ALSO what real business menus offer ("press 0 to talk to
//     an operator" is the commonest real option there is), so a customer
//     describing a menu says the very same words a robocall does. Mostly they
//     say them mid-sentence, after the words that make it a story: "…and the
//     recording said press 0 to talk to an operator…", "ayer llamé y después
//     presione el 0 para hablar con una operadora…". A script says each as
//     its own sentence: "…finding you. Press 0 to speak with an agent."
//  4. TWO such instructions in the call (owner decision O-3, danlo,
//     2026-10-09). A customer CAN open a sentence with a menu line — "…got
//     your phone menu. Press 0 to talk to an operator, it says…" — but says
//     it once; a robocall reads several. Counted across the caller's turns
//     (a robot the turn detector splits in two is one script), within one
//     turn too (the real robocall reads both in one monologue), and the same
//     instruction twice counts twice (robots repeat; a customer repeating one
//     quote word for word, each time as its own sentence, is not a shape on
//     record). One sentence matched by two rules is one instruction.
//
// A COMMA IS NOT A SENTENCE START, on evidence: "la grabación dijo, presione
// 0 para hablar con un agente…" and "it said, press 0 to speak with an
// agent…" are customers (the test file's saidCommaPress), and a comma rule
// trips both. Nor is a colon ("decía: oprima 1…" is a quote). The real
// robocall on record opens its instructions after full stops, so leaving
// both out loses nothing it has.
//
// THE TRADE, decided by the owner's standing rule that hanging up on a real
// customer is strictly worse than letting a robocall through: a script that
// reads only ONE instruction gets through (O-3), and so does one the
// transcriber wrote WITHOUT punctuation ("…your google business account press
// zero to speak with an agent…"), "por favor, oprima…" with nothing before
// it but a comma's clause, and a mid-sentence opt-out ("…or reply to this
// message to be removed from our list"). Those robots bill their minutes;
// the silence guard and the repeat-caller guard still stand behind this one.
// The test file lists every one of them as a KNOWN MISS.
const SENTENCE_START = "(?:^|[.!?¿¡])\\s*(?:(?:please|por\\s+favor),?\\s+)?";

/**
 * WHAT THE KEY IS FOR (point 2 above), English.
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
  // "…finding you. Press 0 to speak with an agent", "Press nine to opt out",
  // "Press 1 for more information" — and never "press 1 for appointments",
  // nor "the recording said press 0 to talk to an operator".
  `${SENTENCE_START}press\\s+${DIGIT}\\s+(?:to\\s+${EN_PURPOSE_AFTER_TO}|for\\s+${EN_PURPOSE_AFTER_FOR})\\b`,
  "gi",
);

/**
 * The opt-out with no keypad command: only the list-holder's own words, "to
 * be removed from OUR list", and only opening a sentence ("To be removed
 * from our list, reply STOP."). A customer says "I'd like to opt out of the
 * texts", "please take me off this list", or quotes a letter — "it says to
 * be removed from our list call this number" — and hanging up on them is
 * the false positive that is never seen.
 */
const OPT_OUT = new RegExp(`${SENTENCE_START}to\\s+be\\s+removed\\s+from\\s+our\\s+list\\b`, "gi");

// ─── Spanish (F-010) ────────────────────────────────────────────────────────
//
// The same three requirements, said in Spanish. Keyed on what the script
// tells the caller to DO, never on what it is about: "lo encontré en Google"
// is a customer, exactly as "I found you on Google" is.
//
// No real Spanish robocall is on record yet. The shapes below are the ones US
// Spanish IVR scripts use (usted commands, digits after "el"), which is an
// assumption until a real call's transcript confirms or corrects it.

const ES_DIGIT = "(?:[0-9]|cero|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve)";

/**
 * The keypad COMMAND, usted form only: oprima, presione, pulse, marque. The
 * digit may come bare or after "el", "el número" or "la tecla".
 *
 * The past tense a customer uses to tell a story is "oprimí / presioné /
 * pulsé / marqué"; with the accent dropped, "presione" and "marque" are
 * spelled exactly like the command, which is why the sentence-start rule
 * (point 3) is what keeps "ayer llamé y luego presione el 0 para hablar con
 * un asesor" a person. The tú forms ("oprime", "presiona") are left out on
 * purpose: "presiona" is also the plain present ("cuando uno presiona el
 * 1…").
 */
const ES_COMMAND = `(?:oprima|presione|pulse|marque)\\s+(?:el\\s+(?:n[uú]mero\\s+)?|la\\s+tecla\\s+)?${ES_DIGIT}`;

/**
 * WHAT THE KEY IS FOR (point 2), Spanish:
 *   - hablar con un agente / representante / operador / especialista /
 *     asesor (or "uno de nuestros …")
 *   - no recibir más llamadas
 *   - ser eliminado / removido … de NUESTRA lista
 *   - (recibir) más información
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

/** "…no lo pueden encontrar. Oprima 0 para hablar con un agente." —
 *  command, digit, purpose: the English rule's order. */
const ES_IVR_COMMAND_FIRST = new RegExp(
  `${SENTENCE_START}${ES_COMMAND}\\s+${ES_FOR}\\s+${ES_PURPOSE}\\b`, "gi",
);

/**
 * "Para hablar con un representante, oprima 1." — purpose FIRST, which
 * Spanish scripts use far more than English ones; the purpose opens the
 * sentence. Up to a few words may follow it ("…con un representante de
 * servicio al cliente, oprima 1") but not a sentence break.
 *
 * AND THE DIGIT MUST BE SEEN TO END — a full stop, or "(,) o …" offering the
 * next option, where the "o" is followed by an option word (el, espere,
 * oprima, presione, marque, para): "…marque el 9, o sea, el 956…" is a
 * person correcting themselves, and at the prefix "…marque el nueve o" the
 * "o" is the first letter of "ocho" (review round 3). A list purpose followed by a PHONE NUMBER is a vendor or a
 * card being read out ("Para hablar con un asesor de nosotros marque el 956
 * 555 0101…"), and this predicate runs on the caller's turn while they are
 * still talking (`call-events.ts` judges every transcription delta's
 * prefix), so at "…marque el 9" nothing yet shows a number is coming. Only
 * the digit visibly ending can. (Round 1 dropped this check and six callers
 * of that shape were hung up on; round 2 restored it.) The command-first
 * rule needs no such ending: the purpose AFTER its digit already is one.
 */
const ES_IVR_PURPOSE_FIRST = new RegExp(
  `${SENTENCE_START}${ES_FOR}\\s+${ES_PURPOSE}[^.;:!?¿¡]{0,40}?,?\\s+${ES_COMMAND}(?=\\s*(?:[.;!?]|,?\\s+o\\s+(?:el|espere|oprima|presione|marque|para)\\b))`,
  "gi",
);

/**
 * The broadcaster's opt-out with no keypad command: only the list-holder's
 * own words, "para ser eliminado de NUESTRA lista" (or "darse de baja de
 * nuestra lista"), opening a sentence. A customer says "¿qué hago para ser
 * removido de esta lista?" or "para darse de baja del servicio" — asking to
 * be left alone, or cancelling a plan — and hanging up on them is never
 * seen. "para no recibir más llamadas" alone is the same: a customer says it
 * too. After a keypad command, the rules above count it.
 */
const ES_OPT_OUT = new RegExp(
  `${SENTENCE_START}para\\s+(?:ser\\s+(?:eliminad|removid|borrad|retirad|quitad)[oa]s?|darse\\s+de\\s+baja)\\s+de\\s+nuestras?\\s+listas?\\b`,
  "gi",
);

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

const RULES: readonly RegExp[] = [
  IVR_INSTRUCTION, OPT_OUT, ES_IVR_COMMAND_FIRST, ES_IVR_PURPOSE_FIRST, ES_OPT_OUT,
];

/**
 * How many broadcaster instructions this text holds: sentences that OPEN
 * with a keypad command for a robocall's purpose, or with the list-holder's
 * opt-out (points 1–3 of the design note above).
 *
 * Counted by SENTENCE, not by rule. Every rule starts its match at the same
 * place — the punctuation (or text start) the sentence opens after — so one
 * sentence two rules both see ("Para ser eliminado de nuestra lista, oprima
 * 9.") is one instruction, not two, and a customer's single quote never
 * counts double.
 */
export function countInstructions(text: string): number {
  const sentences = new Set<number>();
  for (const rule of RULES) {
    for (const m of text.matchAll(rule)) sentences.add(m.index);
  }
  return sentences.size;
}

/** O-3 (owner, 2026-10-09): how many instructions in one call end it. */
export const INSTRUCTIONS_TO_HANG_UP = 2;

/**
 * True when the caller reads as a recorded broadcast rather than a person.
 *
 * `text` is this turn as far as it has got (a delta's prefix, or the
 * finished turn); `earlierCallerTurns` are the caller's finished turns
 * before it in this call. A recording when, across them all, there is
 * enough text to be a script AND at least `INSTRUCTIONS_TO_HANG_UP`
 * instructions (`countInstructions`). Length alone catches the rambling
 * customer; one instruction alone catches the customer who quotes a menu
 * line; the purpose and the sentence start are what keep a customer
 * retelling a menu mid-sentence on the line.
 *
 * The floor is on all the caller's words together, so a script the turn
 * detector cut in two is judged as the script it is, and two short fragments
 * are still never judged.
 */
export function looksLikeRecordedMessage(
  text: string, earlierCallerTurns: readonly string[] = [],
): boolean {
  const turns = [...earlierCallerTurns, text].map((s) => s.trim());
  const length = turns.reduce((n, s) => n + s.length, 0);
  if (length < MIN_LENGTH) return false;
  const instructions = turns.reduce((n, s) => n + countInstructions(s), 0);
  return instructions >= INSTRUCTIONS_TO_HANG_UP;
}
