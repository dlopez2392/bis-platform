import { describe, it, expect } from "vitest";
import { matchConfirmationReply } from "@bis/db";
import {
  matchPhrase, normalisePhraseText, withoutCourtesy, PHRASES_EN, PHRASES_ES, ES_VERB_FORMS, ES_MESSAGE_WORDS,
  ES_END_OBJECTS, WHOLE_MESSAGE_PHRASES, REPEATED_KEYWORDS, ES_COURTESY_LEAD, ES_COURTESY_TRAIL, NOT_FOLLOWED_BY,
  EN_COURTESY_LEAD, EN_COURTESY_TRAIL, SINGLE_WORD_STOPS,
} from "./phrases";
import { matchKeyword } from "./keywords";

/**
 * Spec §4.2's phrase list as corrected (S9: danlo's 2026-09-28 decisions and
 * the orchestrator's calls under them, plus the orchestrator's binding
 * amendment of 2026-09-28 dispatching this task: "no quiero sus mensajes" as
 * a sentence phrase, and "borren/borre/borra mi numero" as whole-message
 * phrases), matched ignoring case, accents and punctuation (apostrophes
 * dropped, so "don't text" is "dont text"). A false hold only pauses texts
 * and staff clear it in one click; a missed stop is the risk, which is why
 * staff can still stop texts by hand.
 *
 * The expected lists are LITERALS here, not the module's own arrays: a test
 * that iterates the implementation's list cannot notice an entry dropped
 * from it (review R2-I5).
 */
const EXPECTED_EN = [
  "stop texting", "stop sending", "stop messaging", "stop contacting", "dont text", "do not text",
  "dont message", "do not message", "no more texts", "no more messages", "remove me", "take me off",
  "unsubscribe me", "wrong number",
  "no more texting", "do not contact me", "dont contact me",
  // danlo, 2026-09-28 (D2):
  "opt me out", "quit texting me", "leave me alone", "i dont want these texts", "i do not want these texts",
  // orchestrator, 2026-09-28, fix round 2:
  "i dont want texts", "i dont want your texts", "i do not want texts",
];
const EXPECTED_ES = [
  "no quiero mas mensajes", "no quiero mensajes", "no mas mensajes", "no mas textos", "numero equivocado",
  "quitenme de su lista", "quitenme de la lista", "quiteme de su lista", "quiteme de la lista",
  "quitame de su lista", "quitame de la lista", "saquenme de su lista", "saquenme de la lista",
  "saqueme de su lista", "saqueme de la lista", "sacame de su lista", "sacame de la lista",
  // orchestrator amendment, 2026-09-28 (dispatch-task-4): holds anywhere, like "no quiero mensajes".
  "no quiero sus mensajes",
  // danlo, 2026-09-28 (D2):
  "borrenme de su lista", "borrenme de la lista", "borreme de su lista", "borreme de la lista",
  "borrame de su lista", "borrame de la lista", "no quiero promociones",
  // orchestrator, 2026-09-28, fix round 2:
  "no quiero mas promociones", "no quiero sus promociones", "no quiero ofertas", "no quiero mas ofertas",
  "no quiero publicidad", "no quiero mas publicidad", "este no es mi numero", "se equivocaron de numero",
];
const EXPECTED_VERB_FORMS = [
  "no me manden", "no me mande", "no me mandes", "no me envien", "no me envie", "no me envies",
  "no me escriban", "no me escriba", "no me escribas",
  "dejen de mandarme", "deje de mandarme", "deja de mandarme", "dejen de enviarme", "deje de enviarme",
  "deja de enviarme", "dejen de escribirme", "deje de escribirme", "deja de escribirme",
  "dejen de mandar", "deje de mandar", "deja de mandar", "dejen de enviar", "deje de enviar", "deja de enviar",
  "dejen de escribir", "deje de escribir", "deja de escribir",
  "no quiero recibir",
  "no me vuelvan a mandar", "no me vuelva a mandar", "no me vuelvas a mandar",
  "no me vuelvan a enviar", "no me vuelva a enviar", "no me vuelvas a enviar",
  // danlo, 2026-09-28 (D2):
  "no quiero que me manden", "no quiero que me envien", "no quiero que me escriban",
];
const EXPECTED_MESSAGE_WORDS = [
  "mensajes", "textos", "sms", "msjs", "mensajitos", "ningun mensaje", "sus mensajes",
  // danlo, 2026-09-28 (D2): plural/mass form only — "oferta" singular does not count.
  "promociones", "ofertas", "publicidad", "sus promociones",
];
const EXPECTED_END_OBJECTS = ["mas", "nada", "nada mas", "nunca mas"];
const EXPECTED_WHOLE = [
  { phrase: "please stop", language: "en" }, { phrase: "stop please", language: "en" },
  { phrase: "borrenme", language: "es" }, { phrase: "borreme", language: "es" }, { phrase: "borrame", language: "es" },
  { phrase: "dejen de escribirme", language: "es" }, { phrase: "deje de escribirme", language: "es" },
  { phrase: "deja de escribirme", language: "es" }, { phrase: "no me escriban", language: "es" },
  { phrase: "no me escriba", language: "es" }, { phrase: "no me escribas", language: "es" },
  { phrase: "no me vuelvan a escribir", language: "es" }, { phrase: "no me vuelva a escribir", language: "es" },
  { phrase: "no me vuelvas a escribir", language: "es" },
  // orchestrator amendment, 2026-09-28 (dispatch-task-4): same rule and courtesy
  // wrapper as borrenme/borreme/borrame; a number change or an appointment
  // detail after the phrase does NOT hold (whole-message only).
  { phrase: "borren mi numero", language: "es" }, { phrase: "borre mi numero", language: "es" },
  { phrase: "borra mi numero", language: "es" },
  // danlo, 2026-09-28 (D2): the bare "que me escriban" construction (escribir is always about messages).
  { phrase: "no quiero que me escriban", language: "es" },
];
const EXPECTED_REPEATED = [
  { word: "stop", language: "en" }, { word: "parar", language: "es" }, { word: "alto", language: "es" }, { word: "baja", language: "es" },
];
// danlo, 2026-09-28 (D1): every STOP-kind keyword from keywords.ts, plus the spaced spellings
// "no mas", "opt out", "stop all" (this module's normaliser does not collapse inner spaces) —
// EXCEPT cancel/cancelar (orchestrator, fix round 2: "Cancel please" reads as an appointment
// cancellation, not a stop; the bare keyword still stops texts AND raises the To-do, unchanged).
const EXPECTED_SINGLE_WORD_STOPS = [
  { word: "stop", language: "en" }, { word: "stopall", language: "en" }, { word: "unsubscribe", language: "en" },
  { word: "end", language: "en" }, { word: "quit", language: "en" }, { word: "revoke", language: "en" },
  { word: "optout", language: "en" }, { word: "opt out", language: "en" }, { word: "stop all", language: "en" },
  { word: "parar", language: "es" }, { word: "detener", language: "es" }, { word: "alto", language: "es" },
  { word: "baja", language: "es" }, { word: "nomas", language: "es" }, { word: "no mas", language: "es" },
];
const VERB_WITH_WORD = EXPECTED_VERB_FORMS.flatMap((v) => EXPECTED_MESSAGE_WORDS.map((w) => `${v} ${w}`));
const VERB_WITH_END = EXPECTED_VERB_FORMS.flatMap((v) => EXPECTED_END_OBJECTS.map((e) => `${v} ${e}`));
const SPANISH_WHOLE = EXPECTED_WHOLE.filter((w) => w.language === "es").map((w) => w.phrase);

describe("matchPhrase — every sentence phrase, in a real sentence", () => {
  it.each(EXPECTED_EN)("English %j matches inside a sentence (mutation: drop the phrase from PHRASES_EN → FAILS)", (phrase) => {
    expect(matchPhrase(`Hi, please ${phrase} ok? Thanks`)).toEqual({ phrase, language: "en" });
  });

  it.each(EXPECTED_ES)("Spanish %j matches inside a sentence (mutation: drop the phrase from PHRASES_ES → FAILS)", (phrase) => {
    expect(matchPhrase(`Hola, por favor ${phrase} ya, gracias`)).toEqual({ phrase, language: "es" });
  });

  it.each(VERB_WITH_WORD)("Spanish verb form + message word %j matches anywhere (mutation: drop a verb form or a message word → FAILS)", (phrase) => {
    expect(matchPhrase(`Hola, por favor ${phrase} ya, gracias`)).toEqual({ phrase, language: "es" });
  });

  it.each(VERB_WITH_END)("Spanish verb form + %j matches at the END, courtesy words aside (danlo: \"mas\" / \"nada\" only at the end; mutation: drop an end object → FAILS)", (phrase) => {
    expect(matchPhrase(phrase)).toEqual({ phrase, language: "es" });
    expect(matchPhrase(`Por favor ${phrase}, gracias`)).toEqual({ phrase, language: "es" });
  });

  it.each(SPANISH_WHOLE)("Spanish whole-message %j holds bare and with one courtesy word each side (review V2; mutation: compare without withoutCourtesy → the wrapped forms are missed, FAILS)", (phrase) => {
    expect(matchPhrase(phrase)).toEqual({ phrase, language: "es" });
    expect(matchPhrase(`Ya ${phrase}`)).toEqual({ phrase, language: "es" });
    expect(matchPhrase(`Por favor ${phrase}, gracias`)).toEqual({ phrase, language: "es" });
  });
});

describe("matchPhrase — how people actually write", () => {
  it("apostrophes, curly or straight, accents, capitals and punctuation are ignored (mutation: keep apostrophes → \"Don't text me\" is missed, FAILS)", () => {
    expect(matchPhrase("Don't text me anymore")?.phrase).toBe("dont text");
    expect(matchPhrase("don’t message me!!")?.phrase).toBe("dont message");
    expect(matchPhrase("STOP TEXTING ME.")?.phrase).toBe("stop texting");
    expect(matchPhrase("Número equivocado")?.phrase).toBe("numero equivocado");
    expect(matchPhrase("Don't contact me again")?.phrase).toBe("dont contact me");
  });

  it("Spanish about MESSAGES holds — a verb form with a message word, \"mas\" or \"nada\" at the end or before a message word, the list, the new message words (danlo 2026-09-28; mutation: drop \"sms\" from the message words → FAILS)", () => {
    expect(matchPhrase("Dejen de mandarme mensajes")?.phrase).toBe("dejen de mandarme mensajes");
    expect(matchPhrase("Deje de mandarme mensajes")?.phrase).toBe("deje de mandarme mensajes");
    expect(matchPhrase("No me envíe mensajes")?.phrase).toBe("no me envie mensajes");
    expect(matchPhrase("No me mandes mensajes")?.phrase).toBe("no me mandes mensajes");
    expect(matchPhrase("Ya no me manden mensajes")?.phrase).toBe("no me manden mensajes");
    expect(matchPhrase("No me mande mensajes de texto")?.phrase).toBe("no me mande mensajes");
    expect(matchPhrase("No me manden más")?.phrase).toBe("no me manden mas");
    expect(matchPhrase("No me mande nada, gracias")?.phrase).toBe("no me mande nada");
    expect(matchPhrase("no me mande más mensajes")?.phrase).toBe("no me mande mas mensajes");
    expect(matchPhrase("Ya no me mande nada")?.phrase).toBe("no me mande nada");
    expect(matchPhrase("No me escriban nunca más")?.phrase).toBe("no me escriban nunca mas");
    expect(matchPhrase("No me escriba más, gracias")?.phrase).toBe("no me escriba mas");
    expect(matchPhrase("No quiero recibir más mensajes")?.phrase).toBe("no quiero recibir mas mensajes");
    expect(matchPhrase("No me manden SMS")?.phrase).toBe("no me manden sms");
    expect(matchPhrase("No me manden msjs")?.phrase).toBe("no me manden msjs");
    expect(matchPhrase("No me manden mensajitos")?.phrase).toBe("no me manden mensajitos");
    expect(matchPhrase("No me envíen ningún mensaje")?.phrase).toBe("no me envien ningun mensaje");
    expect(matchPhrase("No me manden ningún mensaje más")?.phrase).toBe("no me manden ningun mensaje");
    expect(matchPhrase("Ya no me manden sus mensajes")?.phrase).toBe("no me manden sus mensajes");
    expect(matchPhrase("No me vuelvan a mandar mensajes")?.phrase).toBe("no me vuelvan a mandar mensajes");
    expect(matchPhrase("No me vuelva a enviar mensajes, por favor")?.phrase).toBe("no me vuelva a enviar mensajes");
    expect(matchPhrase("Quíteme de la lista")?.phrase).toBe("quiteme de la lista");
    expect(matchPhrase("Sáquenme de su lista")?.phrase).toBe("saquenme de su lista");
    expect(matchPhrase("Sácame de la lista")?.phrase).toBe("sacame de la lista");
    expect(matchPhrase("No más textos")?.phrase).toBe("no mas textos");
    expect(matchPhrase("No quiero más mensajes")?.phrase).toBe("no quiero mas mensajes");
    // danlo's accepted list form: any "quítame de la lista …" holds, even this one.
    expect(matchPhrase("Quítame de la lista del sábado y ponme el domingo")?.phrase).toBe("quitame de la lista");
  });

  it("\"mensajes de voz\" is MESSAGES too: a false hold staff clear in one click beats a missed stop like \"no me manden mensajes de voz ni textos\" (orchestrator, review V1; mutation: exclude \"mensajes de voz\" again in verbWithObject → FAILS)", () => {
    expect(matchPhrase("No me mande mensajes de voz, mejor texto")?.phrase).toBe("no me mande mensajes");
    expect(matchPhrase("no me manden mensajes de voz ni textos")?.phrase).toBe("no me manden mensajes");
    expect(matchPhrase("No me mande más mensajes de voz ni textos")?.phrase).toBe("no me mande mas mensajes");
  });

  it("\"mensajes de voz\" holds on the SENTENCE path too (review I2: occurs() has its own NOT_FOLLOWED_BY check, separate from verbWithObject's; mutation: exclude \"mensajes de voz\" again in occurs() → FAILS)", () => {
    expect(matchPhrase("No quiero mensajes de voz ni textos")?.phrase).toBe("no quiero mensajes");
    expect(matchPhrase("No quiero más mensajes de voz")?.phrase).toBe("no quiero mas mensajes");
    expect(matchPhrase("No más mensajes de voz")?.phrase).toBe("no mas mensajes");
    expect(matchPhrase("No quiero sus mensajes de voz")?.phrase).toBe("no quiero sus mensajes");
  });

  it("Spanish NOT about messages does not hold: a bare verb form, \"mas\" / \"nada\" in the middle of the message, a list that is not the texting list, a cita (danlo 2026-09-28; mutation: let \"mas\" count anywhere → \"No me manden más a Pedro\" holds, FAILS)", () => {
    for (const text of [
      "No me mande a nadie mañana, va a llover", "No me mande la factura", "No me envíe el recibo, ya pagué",
      "Deje de mandar a Juan", "Quíteme de las 3 y póngame a las 5", "Quítame de la cita del martes",
      "Bórreme la cita del lunes", "Ya no me mande al muchacho ese, corta mal", "No me mandes la foto todavía",
      "No quiero recibir la factura en papel", "Si no me manda la dirección no puedo ir", "quiteme la cita",
      "No me manden más a Pedro, no sabe podar", "No me mande más de dos trabajadores", "Deje de mandar más muchachos",
      "No me mande nada por correo, mándelo por texto", "No quiero recibir nada por correo", "No me envíe nada, yo paso a recoger",
      "Quíteme de la lista de espera", "Dejen de mandarme", "No me envíe",
    ]) expect(matchPhrase(text), text).toBeNull();
  });
});

describe("matchPhrase — whole-message phrases, the courtesy words, a repeated stop word", () => {
  it("\"please stop\", \"stop please\", \"Bórreme\" and the ESCRIBIR forms hold as the WHOLE message, punctuation aside (danlo; the escribir forms because writing to the customer IS messaging; mutation: drop the whole-message list → FAILS)", () => {
    expect(matchPhrase("Please stop!!")).toEqual({ phrase: "please stop", language: "en" });
    expect(matchPhrase("Stop, please.")).toEqual({ phrase: "stop please", language: "en" });
    expect(matchPhrase("¡Bórreme!")).toEqual({ phrase: "borreme", language: "es" });
    expect(matchPhrase("Dejen de escribirme")).toEqual({ phrase: "dejen de escribirme", language: "es" });
    expect(matchPhrase("¡Deja de escribirme!")).toEqual({ phrase: "deja de escribirme", language: "es" });
    expect(matchPhrase("No me escriba")).toEqual({ phrase: "no me escriba", language: "es" });
    expect(matchPhrase("No me vuelvan a escribir")).toEqual({ phrase: "no me vuelvan a escribir", language: "es" });
  });

  it("the eleven courtesy-wrapped Spanish stops the verifier found all hold — one leading \"ya\" / \"por favor\" / \"porfa\" / \"porfavor\", one trailing \"por favor\" / \"porfa\" / \"porfavor\" / \"gracias\" / \"ya\" (review V2; mutation: drop withoutCourtesy → FAILS)", () => {
    for (const [text, phrase] of [
      ["Ya no me escriban", "no me escriban"], ["Ya no me escriba", "no me escriba"], ["Por favor no me escriba", "no me escriba"],
      ["No me escriba por favor", "no me escriba"], ["Deje de escribirme por favor", "deje de escribirme"],
      ["Por favor dejen de escribirme", "dejen de escribirme"], ["Dejen de escribirme ya", "dejen de escribirme"],
      ["No me escriban, gracias", "no me escriban"], ["Ya no me escribas porfa", "no me escribas"],
      ["Ya bórrenme", "borrenme"], ["Bórrenme por favor", "borrenme"],
    ] as const) expect(matchPhrase(text), text).toEqual({ phrase, language: "es" });
  });

  it("…but a whole-message form inside a longer text does not hold, courtesy words or not (review V2; mutation: strip every courtesy word anywhere → \"Ya no me escriba, yo le llamo\" holds, FAILS; mutation: match the escribir forms anywhere → FAILS)", () => {
    for (const text of ["No me escriba el martes, mejor llámeme", "Ya no me escriba, yo le llamo", "No me escriba mañana",
      "Bórreme la cita del lunes", "Please stop by Thursday", "Can you stop please at the store"]) expect(matchPhrase(text), text).toBeNull();
  });

  it("the courtesy words come off ONE at each end, no more (mutation: loop until none is left → \"ya ya no me escriba\" holds, FAILS)", () => {
    expect(withoutCourtesy("ya no me escriba gracias")).toBe("no me escriba");
    expect(withoutCourtesy("por favor no me escriba por favor")).toBe("no me escriba");
    expect(matchPhrase("Ya ya no me escriba")).toBeNull();
  });

  it("a stop word repeated as the whole message holds, however many times — English with one \"please\" at either end, Spanish with the courtesy words (mutation: drop the repeated-word rule → FAILS)", () => {
    expect(matchPhrase("STOP STOP")).toEqual({ phrase: "stop stop", language: "en" });
    expect(matchPhrase("Stop. Stop. Stop.")).toEqual({ phrase: "stop stop", language: "en" });
    expect(matchPhrase("Stop stop please")).toEqual({ phrase: "stop stop", language: "en" });
    expect(matchPhrase("Please stop stop")).toEqual({ phrase: "stop stop", language: "en" });
    expect(matchPhrase("Parar parar")).toEqual({ phrase: "parar parar", language: "es" });
    expect(matchPhrase("PARAR PARAR por favor")).toEqual({ phrase: "parar parar", language: "es" });
    expect(matchPhrase("Alto alto")).toEqual({ phrase: "alto alto", language: "es" });
    expect(matchPhrase("¡Baja, baja!")).toEqual({ phrase: "baja baja", language: "es" });
  });

  it("…but not one word on its own (that is a keyword, keywords.ts), and not inside a longer text (mutation: accept a single word → \"alto\" holds, FAILS; mutation: find the repeat anywhere → FAILS)", () => {
    expect(matchPhrase("alto")).toBeNull();
    expect(matchPhrase("stop stop by later")).toBeNull();
  });
});

describe("matchPhrase — the orchestrator amendment (2026-09-28, dispatch-task-4)", () => {
  it("'no quiero sus mensajes' holds anywhere in the message, like 'no quiero mensajes' (mutation: drop it from PHRASES_ES → FAILS)", () => {
    expect(matchPhrase("Hola, no quiero sus mensajes, gracias")).toEqual({ phrase: "no quiero sus mensajes", language: "es" });
    expect(matchPhrase("No quiero sus mensajes")).toEqual({ phrase: "no quiero sus mensajes", language: "es" });
  });

  it("'borren/borre/borra mi numero' hold as the WHOLE message, with the same courtesy wrapper as borrenme (mutation: drop the three entries from WHOLE_MESSAGE_PHRASES → FAILS)", () => {
    expect(matchPhrase("Borren mi número")).toEqual({ phrase: "borren mi numero", language: "es" });
    expect(matchPhrase("Por favor borre mi número")).toEqual({ phrase: "borre mi numero", language: "es" });
    expect(matchPhrase("Borra mi número")).toEqual({ phrase: "borra mi numero", language: "es" });
    expect(matchPhrase("Ya borren mi número")).toEqual({ phrase: "borren mi numero", language: "es" });
  });

  it("…but not a number change or an appointment detail (mutation: match 'borren mi numero' anywhere instead of as the whole message → these hold, FAILS)", () => {
    expect(matchPhrase("Borre mi número viejo, use el nuevo")).toBeNull();
    expect(matchPhrase("Borren mi número de la cita")).toBeNull();
  });

  it("no whole-message phrase equals or contains another as whole words — the pairwise sentence/verb check above does not cover WHOLE_MESSAGE_PHRASES (mutation: add 'mi numero' alone to WHOLE_MESSAGE_PHRASES → it is contained in 'borren mi numero', FAILS naming the pair)", () => {
    // Offenders collected in plain JS and asserted ONCE (review perf fix, fix round 2):
    // one `expect` per pair times out on a growing list (O(n²) `expect` calls, each with
    // vitest's own diffing overhead, is much slower than the same O(n²) comparisons in a
    // plain loop) — see the sentence-phrase version of this test below for the measured cost.
    const phrases = WHOLE_MESSAGE_PHRASES.map((w) => w.phrase);
    const offenders: string[] = [];
    for (const p of phrases) for (const q of phrases) if (p !== q && ` ${p} `.includes(` ${q} `)) offenders.push(`${p} ⊃ ${q}`);
    expect(offenders).toEqual([]);
  });
});

describe("matchPhrase — D1 (danlo, 2026-09-28): a single stop word with ONE courtesy word", () => {
  it.each([
    ["Baja por favor", "baja", "es"], ["Alto, por favor", "alto", "es"], ["Parar porfa", "parar", "es"],
    ["Ya baja", "baja", "es"], ["No más, gracias", "no mas", "es"], ["Ya no más", "no mas", "es"],
    ["No más por favor", "no mas", "es"], ["Detener gracias", "detener", "es"],
    ["Stop thanks", "stop", "en"], ["Stop thank you", "stop", "en"],
  ] as const)("%j holds as a whole-message phrase, not a keyword stop (mutation: drop the word from SINGLE_WORD_STOPS or the courtesy list → FAILS)", (text, phrase, language) => {
    expect(matchPhrase(text)).toEqual({ phrase, language });
  });

  it("the bare keyword alone is NOT a phrase — matchKeyword is tried first by every caller, this module never claims it (pins the precedence; mutation: drop the `core2 !== whole` guard → the bare word becomes a phrase too, FAILS)", () => {
    for (const [word, kind] of [["Baja", "stop"], ["Stop", "stop"], ["No mas", "stop"], ["no mas", "stop"]] as const) {
      expect(matchKeyword(word)?.kind, word).toBe(kind);
      expect(matchPhrase(word), word).toBeNull();
    }
  });

  it("a longer text is neither a keyword nor a phrase, even when a courtesy word IS present at an edge (mutation: compare with startsWith instead of exact equality → 'Por favor alto mañana' holds, FAILS)", () => {
    expect(matchKeyword("Alto, por favor mañana a las 3")).toBeNull();
    expect(matchPhrase("Alto, por favor mañana a las 3")).toBeNull();
    // "por favor" IS stripped here (it's the leading word), leaving "alto manana" —
    // a real boundary case for the exact-equality check, unlike the line above
    // (whose "por favor" sits in the middle and is never stripped at all).
    expect(matchPhrase("Por favor alto mañana")).toBeNull();
  });

  it("none of the single-word-stop + courtesy combos is a keyword or a YES/NO answer (mutation: add 'all' to EN_COURTESY_TRAIL → 'stop' + 'all' = 'stop all' collides with the STOPALL keyword, FAILS)", () => {
    const combos = SINGLE_WORD_STOPS.flatMap((s) => {
      const lead = s.language === "en" ? EN_COURTESY_LEAD : ES_COURTESY_LEAD;
      const trail = s.language === "en" ? EN_COURTESY_TRAIL : ES_COURTESY_TRAIL;
      return [...lead.map((l) => `${l} ${s.word}`), ...trail.map((t) => `${s.word} ${t}`)];
    });
    for (const p of combos) {
      expect(matchKeyword(p), p).toBeNull();
      expect(matchConfirmationReply(p), p).toBeNull();
    }
  });

  it.each(["Opt out please", "Please opt out", "Opt-out please", "Stop all please"] as const)(
    "%j holds — the spaced spellings of OPTOUT and STOPALL count too (mutation: drop 'opt out'/'stop all' from SINGLE_WORD_STOPS → FAILS)",
    (text) => {
      expect(matchPhrase(text)?.language).toBe("en");
      expect(matchPhrase(text)?.phrase).toMatch(/^opt out$|^stop all$/);
    },
  );

  it.each(["Cancel please", "Please cancel", "Cancelar por favor", "Ya cancelar"] as const)(
    "%j does NOT hold — cancel/cancelar are excluded from SINGLE_WORD_STOPS (orchestrator, fix round 2: an appointment cancellation, not a stop; mutation: re-add cancel/cancelar to SINGLE_WORD_STOPS → FAILS)",
    (text) => {
      expect(matchPhrase(text)).toBeNull();
    },
  );

  it("leading 'gracias' (Spanish) and leading 'thanks' (English) are courtesy words too (orchestrator, fix round 2; mutation: drop 'gracias' from ES_COURTESY_LEAD or 'thanks' from EN_COURTESY_LEAD → FAILS)", () => {
    expect(matchPhrase("Gracias, no me escriban")).toEqual({ phrase: "no me escriban", language: "es" });
    expect(matchPhrase("Thanks, stop")).toEqual({ phrase: "stop", language: "en" });
  });

  it("every SINGLE_WORD_STOPS entry, spaces removed, is a stop per matchKeyword (mutation: add a non-stop word to SINGLE_WORD_STOPS → FAILS naming it)", () => {
    for (const s of SINGLE_WORD_STOPS) expect(matchKeyword(s.word)?.kind, s.word).toBe("stop");
  });

  it("every STOP-kind keyword except CANCEL/CANCELAR is present in SINGLE_WORD_STOPS, and cancel/cancelar are absent (decision 4; mutation: remove 'baja' from SINGLE_WORD_STOPS → FAILS)", () => {
    for (const w of ["stop", "stopall", "unsubscribe", "end", "quit", "revoke", "optout", "parar", "detener", "alto", "baja", "nomas"]) {
      expect(SINGLE_WORD_STOPS.some((s) => s.word === w), w).toBe(true);
    }
    expect(SINGLE_WORD_STOPS.some((s) => s.word === "cancel")).toBe(false);
    expect(SINGLE_WORD_STOPS.some((s) => s.word === "cancelar")).toBe(false);
  });
});

describe("matchPhrase — D2 (danlo, 2026-09-28): additional plain stops", () => {
  it("the 'que me manden/envien/escriban' construction holds with a message object, and 'escriban' bare (whole message) too (mutation: drop an entry from ES_VERB_FORMS or WHOLE_MESSAGE_PHRASES → FAILS)", () => {
    expect(matchPhrase("Ya no quiero que me manden mensajes")?.phrase).toBe("no quiero que me manden mensajes");
    expect(matchPhrase("No quiero que me envien mensajes")?.phrase).toBe("no quiero que me envien mensajes");
    expect(matchPhrase("No quiero que me escriban")).toEqual({ phrase: "no quiero que me escriban", language: "es" });
    expect(matchPhrase("No quiero que me escriban mensajes")?.phrase).toBe("no quiero que me escriban mensajes");
  });

  it("'borrenme/borreme/borrame de su/la lista' hold anywhere, like the quitenme forms (mutation: drop an entry from PHRASES_ES → FAILS)", () => {
    expect(matchPhrase("Ya, bórrenme de su lista por favor")?.phrase).toBe("borrenme de su lista");
    expect(matchPhrase("Bórrame de la lista")?.phrase).toBe("borrame de la lista");
  });

  it("'promociones', 'ofertas' and 'publicidad' are message words — 'sus promociones' like 'sus mensajes', 'más promociones' under the mas/nada rule, and 'No quiero promociones' its own literal (mutation: drop a word from ES_MESSAGE_WORDS or PHRASES_ES → FAILS)", () => {
    expect(matchPhrase("Dejen de mandarme sus promociones")?.phrase).toBe("dejen de mandarme sus promociones");
    expect(matchPhrase("No me manden más promociones")?.phrase).toBe("no me manden mas promociones");
    expect(matchPhrase("No quiero promociones")).toEqual({ phrase: "no quiero promociones", language: "es" });
    expect(matchPhrase("No me manden ofertas")?.phrase).toBe("no me manden ofertas");
    expect(matchPhrase("No me manden publicidad")?.phrase).toBe("no me manden publicidad");
  });

  it("'oferta' SINGULAR is not a message word (danlo's own qualifier: 'unless ofertas plural is a message word'); 'No me manden la oferta del lunes' stays unheld (the intervening 'la' already blocks adjacency to the verb form regardless of the word list — 'No me manden más oferta' isolates the singular/plural question directly, with nothing else in the way; mutation: strip a trailing 's' when comparing message words, treating 'oferta' as 'ofertas' → 'No me manden más oferta' holds, FAILS)", () => {
    expect(matchPhrase("No me manden la oferta del lunes")).toBeNull();
    expect(matchPhrase("No me manden más oferta")).toBeNull();
  });

  it("'opt me out', 'quit texting me', 'leave me alone', 'i dont want these texts' hold anywhere (apostrophes normalised like the rest of the English list; mutation: drop an entry from PHRASES_EN → FAILS)", () => {
    expect(matchPhrase("Please opt me out, thanks")?.phrase).toBe("opt me out");
    expect(matchPhrase("Quit texting me please")?.phrase).toBe("quit texting me");
    expect(matchPhrase("Leave me alone")?.phrase).toBe("leave me alone");
    expect(matchPhrase("I don't want these texts anymore")?.phrase).toBe("i dont want these texts");
    expect(matchPhrase("I do not want these texts, stop")?.phrase).toBe("i do not want these texts");
  });

  it("'Leave me alone with the dog, I'll be back' HOLDS (decided, danlo's own governing rule: a false hold staff clear in one click beats a missed stop — same call as the voicemail decision; mutation: exclude it via a NOT_FOLLOWED_BY-style guard → FAILS)", () => {
    expect(matchPhrase("Leave me alone with the dog, I'll be back")?.phrase).toBe("leave me alone");
  });
});

describe("matchPhrase — the fixed negative set", () => {
  it.each([
    "Can you stop by at 3?", "I'll text you the address", "Cancel my appointment please", "No", "Yes",
    "Remove the old gutters", "Take me to the shop", "That texture looks great", "Is the number right?",
    "remove meat from the order", "don't texture the wall", "Please stop by Thursday",
  ])("%j is not a stop request (mutation: substring match without word edges → 'remove meat' or 'texture' matches, FAILS)", (text) => {
    expect(matchPhrase(text)).toBeNull();
  });
});

describe("the lists themselves", () => {
  it("every entry is already in the matcher's own form, or it could never match (mutation: add an entry with an accent or a capital → FAILS naming it)", () => {
    for (const p of [...PHRASES_EN, ...PHRASES_ES, ...ES_VERB_FORMS, ...ES_MESSAGE_WORDS, ...ES_END_OBJECTS,
      ...WHOLE_MESSAGE_PHRASES.map((w) => w.phrase), ...REPEATED_KEYWORDS.map((r) => r.word), ...ES_COURTESY_LEAD, ...ES_COURTESY_TRAIL,
      ...SINGLE_WORD_STOPS.map((s) => s.word), ...EN_COURTESY_LEAD, ...EN_COURTESY_TRAIL]) {
      expect(normalisePhraseText(p), p).toBe(p);
    }
  });

  it("no sentence phrase contains another as whole words, so their order never changes WHETHER a text holds (review M1; mutation: add \"ya no me mande\" to ES_VERB_FORMS → \"ya no me mande mensajes\" contains \"no me mande mensajes\", FAILS naming the pair)", () => {
    // Offenders collected in plain JS and asserted ONCE (review perf fix, fix round 2): with
    // one `expect` call per pair, this test's ~465*465 ≈ 216k pairs (37 verb forms * 11 message
    // words = 407 generated phrases, plus the sentence lists) took 3.8-4.4s and sometimes hit
    // vitest's 5s per-test timeout (STACK_TRACE_ERROR, no assertion) — the O(n²) `expect` calls'
    // own diffing/tracking overhead, not the O(n²) comparisons themselves, which are fast in a
    // plain loop. Collecting into an array and asserting once names every offending pair while
    // running in milliseconds. Do NOT raise the timeout — fix the assertion shape instead.
    const verbPhrases = ES_VERB_FORMS.flatMap((v) => ES_MESSAGE_WORDS.map((w) => `${v} ${w}`));
    const all = [...PHRASES_EN, ...PHRASES_ES, ...verbPhrases];
    const offenders: string[] = [];
    for (const p of all) for (const q of all) if (p !== q && ` ${p} `.includes(` ${q} `)) offenders.push(`${p} ⊃ ${q}`);
    expect(offenders).toEqual([]);
  });

  it("no phrase is a keyword, and no phrase is itself a YES/NO answer as the automation engine reads one, so YES/NO and a phrase can never both fire on one text (spec §4.2 step 5, corrected S5; the engine's own exported matcher — review R2-m14; mutation: add 'no' to PHRASES_ES → FAILS)", () => {
    const all = [...PHRASES_EN, ...PHRASES_ES, ...VERB_WITH_WORD, ...VERB_WITH_END, ...WHOLE_MESSAGE_PHRASES.map((w) => w.phrase),
      ...REPEATED_KEYWORDS.map((r) => `${r.word} ${r.word}`)];
    for (const p of all) {
      expect(matchKeyword(p), p).toBeNull();
      // YES/NO matches only a whole one-word message, so a text fires both only if it IS a phrase:
      expect(matchConfirmationReply(p), p).toBeNull();
      expect(matchConfirmationReply(`${p}!`), p).toBeNull();
    }
  });

  it("are exactly the corrected spec lists, plus the orchestrator's amendment (spec §4.2 as corrected by S9 and the dispatch-task-4 amendment; mutation: drop, add or reorder an entry → FAILS)", () => {
    expect(PHRASES_EN).toEqual(EXPECTED_EN);
    expect(PHRASES_ES).toEqual(EXPECTED_ES);
    expect(ES_VERB_FORMS).toEqual(EXPECTED_VERB_FORMS);
    expect(ES_MESSAGE_WORDS).toEqual(EXPECTED_MESSAGE_WORDS);
    expect(ES_END_OBJECTS).toEqual(EXPECTED_END_OBJECTS);
    expect(WHOLE_MESSAGE_PHRASES).toEqual(EXPECTED_WHOLE);
    expect(REPEATED_KEYWORDS).toEqual(EXPECTED_REPEATED);
    expect(ES_COURTESY_LEAD).toEqual(["ya", "por favor", "porfa", "porfavor", "gracias"]);
    expect(ES_COURTESY_TRAIL).toEqual(["por favor", "porfa", "porfavor", "gracias", "ya"]);
    expect(NOT_FOLLOWED_BY).toEqual([{ last: "lista", next: "de espera" }]);
    expect(EN_COURTESY_LEAD).toEqual(["please", "thanks"]);
    expect(EN_COURTESY_TRAIL).toEqual(["please", "thanks", "thank you"]);
    expect(SINGLE_WORD_STOPS).toEqual(EXPECTED_SINGLE_WORD_STOPS);
  });
});
