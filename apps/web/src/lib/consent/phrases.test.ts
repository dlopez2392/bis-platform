import { describe, it, expect } from "vitest";
import { matchConfirmationReply } from "@bis/db";
import {
  matchPhrase, normalisePhraseText, withoutCourtesy, PHRASES_EN, PHRASES_ES, ES_VERB_FORMS, ES_MESSAGE_WORDS,
  ES_END_OBJECTS, WHOLE_MESSAGE_PHRASES, REPEATED_KEYWORDS, ES_COURTESY_LEAD, ES_COURTESY_TRAIL, NOT_FOLLOWED_BY,
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
];
const EXPECTED_ES = [
  "no quiero mas mensajes", "no quiero mensajes", "no mas mensajes", "no mas textos", "numero equivocado",
  "quitenme de su lista", "quitenme de la lista", "quiteme de su lista", "quiteme de la lista",
  "quitame de su lista", "quitame de la lista", "saquenme de su lista", "saquenme de la lista",
  "saqueme de su lista", "saqueme de la lista", "sacame de su lista", "sacame de la lista",
  // orchestrator amendment, 2026-09-28 (dispatch-task-4): holds anywhere, like "no quiero mensajes".
  "no quiero sus mensajes",
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
];
const EXPECTED_MESSAGE_WORDS = ["mensajes", "textos", "sms", "msjs", "mensajitos", "ningun mensaje", "sus mensajes"];
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
];
const EXPECTED_REPEATED = [
  { word: "stop", language: "en" }, { word: "parar", language: "es" }, { word: "alto", language: "es" }, { word: "baja", language: "es" },
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

  it("\"mensajes de voz\" is MESSAGES too: a false hold staff clear in one click beats a missed stop like \"no me manden mensajes de voz ni textos\" (orchestrator, review V1; mutation: exclude \"mensajes de voz\" again → FAILS)", () => {
    expect(matchPhrase("No me mande mensajes de voz, mejor texto")?.phrase).toBe("no me mande mensajes");
    expect(matchPhrase("no me manden mensajes de voz ni textos")?.phrase).toBe("no me manden mensajes");
    expect(matchPhrase("No me mande más mensajes de voz ni textos")?.phrase).toBe("no me mande mas mensajes");
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

  it("no whole-message phrase equals or contains another as whole words — the pairwise sentence/verb check above does not cover WHOLE_MESSAGE_PHRASES (mutation: add 'mi numero' alone to WHOLE_MESSAGE_PHRASES → it is contained in 'borren mi numero', FAILS)", () => {
    const phrases = WHOLE_MESSAGE_PHRASES.map((w) => w.phrase);
    for (const p of phrases) for (const q of phrases) if (p !== q) expect(` ${p} `.includes(` ${q} `), `${p} ⊃ ${q}`).toBe(false);
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
      ...WHOLE_MESSAGE_PHRASES.map((w) => w.phrase), ...REPEATED_KEYWORDS.map((r) => r.word), ...ES_COURTESY_LEAD, ...ES_COURTESY_TRAIL]) {
      expect(normalisePhraseText(p), p).toBe(p);
    }
  });

  it("no sentence phrase contains another as whole words, so their order never changes WHETHER a text holds (review M1; mutation: add \"ya no me mande\" to ES_VERB_FORMS → \"ya no me mande mensajes\" contains \"no me mande mensajes\", FAILS)", () => {
    const verbPhrases = ES_VERB_FORMS.flatMap((v) => ES_MESSAGE_WORDS.map((w) => `${v} ${w}`));
    const all = [...PHRASES_EN, ...PHRASES_ES, ...verbPhrases];
    for (const p of all) for (const q of all) if (p !== q) expect(` ${p} `.includes(` ${q} `), `${p} ⊃ ${q}`).toBe(false);
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
    expect(ES_COURTESY_LEAD).toEqual(["ya", "por favor", "porfa", "porfavor"]);
    expect(ES_COURTESY_TRAIL).toEqual(["por favor", "porfa", "porfavor", "gracias", "ya"]);
    expect(NOT_FOLLOWED_BY).toEqual([{ last: "lista", next: "de espera" }]);
  });
});
