/**
 * The free-text stop phrases (consent chain spec §4.2, decision 5): matched
 * against the message with accents removed, lowercased, apostrophes dropped
 * and every other non-letter a space. A match holds texts and asks staff (a
 * To-do); it never replies (choice 20). Reviewed in PR-2 (danlo, 2026-09-28;
 * spec S9) and extended only with tests, plus the orchestrator's binding
 * amendment of 2026-09-28 (dispatch-task-4): "no quiero sus mensajes" as a
 * sentence phrase, and "borren / borre / borra mi numero" as whole-message
 * phrases. A false hold staff clear in one click beats a missed stop, so
 * where the two conflict the rule holds.
 *
 * 1. SENTENCE phrases, found as whole words anywhere in the message.
 * 2. SPANISH VERB FORMS, which count ONLY WITH A MESSAGE OBJECT (danlo): a
 *    message word right after the form, anywhere in the message ("no me
 *    mande mensajes", "no me envien ningun mensaje"), or "mas" / "nada" only
 *    at the END of the message or right before a message word ("No me manden
 *    más", "No me mande más mensajes"; not "No me manden más a Pedro"). A
 *    bare mandar or enviar form ("No me mande la factura") is not about
 *    messages and does not hold.
 * 3. WHOLE-MESSAGE phrases, which count only when they ARE the message:
 *    "Please stop!!" holds, "Please stop by Thursday" does not. The Spanish
 *    ones — "borreme", "borren mi numero", the ESCRIBIR forms ("No me
 *    escriba": writing to the customer IS messaging), "no me vuelva a
 *    escribir" — may carry one courtesy word before and one after ("Ya no me
 *    escriban", "No me escriba, gracias"); "No me escriba el martes" and
 *    "Borre mi número viejo, use el nuevo" still do not hold.
 * 4. A stop word REPEATED as the whole message ("STOP STOP", "Parar parar"):
 *    English with one "please" at either end, Spanish with the courtesy
 *    words; one word on its own is a keyword (keywords.ts), not a phrase.
 *
 * No sentence phrase contains another (a test pins it), so their order never
 * changes WHETHER a text holds. Nor does any whole-message phrase contain
 * another (a separate test pins that too — the sentence/verb pairwise check
 * does not cover WHOLE_MESSAGE_PHRASES). One continuation is not what it
 * looks like: "lista de espera" is a waiting list, not the texting list.
 *
 * 5. A SINGLE STOP WORD with ONE courtesy word (danlo, 2026-09-28, D1) is a
 *    whole-message HOLD, not a keyword stop: "Baja por favor", "Stop thanks".
 *    The bare word alone is a keyword (keywords.ts matches it first — this
 *    module never claims it); a longer text is neither ("Alto, por favor
 *    mañana a las 3" holds nothing). The qualifying words are every STOP-kind
 *    keyword from keywords.ts (English and Spanish), plus "no mas" — the
 *    two-word spelling of NOMAS, which this module's normaliser does not
 *    collapse the way keywords.ts's does (SINGLE_WORD_STOPS).
 */
export type PhraseMatch = { phrase: string; language: "en" | "es" };

export const PHRASES_EN: readonly string[] = [
  "stop texting", "stop sending", "stop messaging", "stop contacting", "dont text", "do not text",
  "dont message", "do not message", "no more texts", "no more messages", "remove me", "take me off",
  "unsubscribe me", "wrong number",
  "no more texting", "do not contact me", "dont contact me",
  // danlo, 2026-09-28 (D2):
  "opt me out", "quit texting me", "leave me alone", "i dont want these texts", "i do not want these texts",
];

/** Spanish sentence phrases that are about messages on their own. */
export const PHRASES_ES: readonly string[] = [
  "no quiero mas mensajes", "no quiero mensajes", "no mas mensajes", "no mas textos", "numero equivocado",
  "quitenme de su lista", "quitenme de la lista", "quiteme de su lista", "quiteme de la lista",
  "quitame de su lista", "quitame de la lista", "saquenme de su lista", "saquenme de la lista",
  "saqueme de su lista", "saqueme de la lista", "sacame de su lista", "sacame de la lista",
  // orchestrator amendment, 2026-09-28 (dispatch-task-4): holds anywhere, like "no quiero mensajes".
  "no quiero sus mensajes",
  // danlo, 2026-09-28 (D2): "borrenme/borreme/borrame de su/la lista", like the quitenme forms;
  // "no quiero promociones" — "promociones" is a message word (ES_MESSAGE_WORDS) but "no quiero"
  // alone is not a verb form, so this needs its own literal (unlike "no quiero mensajes").
  "borrenme de su lista", "borrenme de la lista", "borreme de su lista", "borreme de la lista",
  "borrame de su lista", "borrame de la lista", "no quiero promociones",
];

/** Spanish verb forms: each counts only with a message object (danlo, 2026-09-28). */
export const ES_VERB_FORMS: readonly string[] = [
  "no me manden", "no me mande", "no me mandes", "no me envien", "no me envie", "no me envies",
  "no me escriban", "no me escriba", "no me escribas",
  "dejen de mandarme", "deje de mandarme", "deja de mandarme", "dejen de enviarme", "deje de enviarme",
  "deja de enviarme", "dejen de escribirme", "deje de escribirme", "deja de escribirme",
  "dejen de mandar", "deje de mandar", "deja de mandar", "dejen de enviar", "deje de enviar", "deja de enviar",
  "dejen de escribir", "deje de escribir", "deja de escribir",
  "no quiero recibir",
  "no me vuelvan a mandar", "no me vuelva a mandar", "no me vuelvas a mandar",
  "no me vuelvan a enviar", "no me vuelva a enviar", "no me vuelvas a enviar",
  // danlo, 2026-09-28 (D2): the subjunctive "que me manden/envien/escriban" construction
  // ("Ya no quiero que me manden mensajes"). ESCRIBIR is also a WHOLE_MESSAGE_PHRASES
  // entry below (bare "No quiero que me escriban" holds too); MANDAR/ENVIAR stay object-only.
  "no quiero que me manden", "no quiero que me envien", "no quiero que me escriban",
];
/** Message words: right after a verb form, anywhere in the message. */
export const ES_MESSAGE_WORDS: readonly string[] = [
  "mensajes", "textos", "sms", "msjs", "mensajitos", "ningun mensaje", "sus mensajes",
  // danlo, 2026-09-28 (D2): "ofertas" and "publicidad" only in the plural/mass form given
  // ("oferta" singular does NOT count — "No me manden la oferta del lunes" stays unheld).
  "promociones", "ofertas", "publicidad", "sus promociones",
];
/** "mas" and "nada": objects only at the END of the message (courtesy words aside) or right before a message word. */
export const ES_END_OBJECTS: readonly string[] = ["mas", "nada", "nada mas", "nunca mas"];

/** Only when they ARE the whole message; the Spanish ones may carry the courtesy words (ES_COURTESY_*). */
export const WHOLE_MESSAGE_PHRASES: readonly PhraseMatch[] = [
  { phrase: "please stop", language: "en" }, { phrase: "stop please", language: "en" },
  { phrase: "borrenme", language: "es" }, { phrase: "borreme", language: "es" }, { phrase: "borrame", language: "es" },
  // ESCRIBIR is always about messages ("writing to me" is texting me), so its
  // bare forms hold as the whole message; MANDAR / ENVIAR do not ("mandar"
  // can mean a crew or an invoice), and stay object-only.
  { phrase: "dejen de escribirme", language: "es" }, { phrase: "deje de escribirme", language: "es" },
  { phrase: "deja de escribirme", language: "es" }, { phrase: "no me escriban", language: "es" },
  { phrase: "no me escriba", language: "es" }, { phrase: "no me escribas", language: "es" },
  { phrase: "no me vuelvan a escribir", language: "es" }, { phrase: "no me vuelva a escribir", language: "es" },
  { phrase: "no me vuelvas a escribir", language: "es" },
  // orchestrator amendment, 2026-09-28 (dispatch-task-4): same rule and
  // courtesy wrapper as borrenme/borreme/borrame; a number change ("Borre mi
  // número viejo, use el nuevo") or an appointment detail ("Borren mi número
  // de la cita") after the phrase does NOT hold, because whole-message
  // matching requires the phrase (plus at most one courtesy word each side)
  // to BE the entire message.
  { phrase: "borren mi numero", language: "es" }, { phrase: "borre mi numero", language: "es" },
  { phrase: "borra mi numero", language: "es" },
  // danlo, 2026-09-28 (D2): the bare (object-free) form of the "que me escriban" construction —
  // escribir is always about messages, so it holds as the whole message like "no me escriban".
  { phrase: "no quiero que me escriban", language: "es" },
];

/** A stop word repeated as the whole message, any number of times. */
export const REPEATED_KEYWORDS: readonly { word: string; language: "en" | "es" }[] = [
  { word: "stop", language: "en" }, { word: "parar", language: "es" }, { word: "alto", language: "es" }, { word: "baja", language: "es" },
];

/** One courtesy word the Spanish whole-message forms may carry before, and one after (orchestrator, review V2). */
export const ES_COURTESY_LEAD: readonly string[] = ["ya", "por favor", "porfa", "porfavor"];
export const ES_COURTESY_TRAIL: readonly string[] = ["por favor", "porfa", "porfavor", "gracias", "ya"];
/** The English courtesy words D1's single-stop-word rule allows (one lead, one trail). */
export const EN_COURTESY_LEAD: readonly string[] = ["please"];
export const EN_COURTESY_TRAIL: readonly string[] = ["please", "thanks", "thank you"];

/**
 * Every STOP-kind keyword (keywords.ts) plus "no mas" — the two-word spelling
 * of NOMAS that this module's normaliser (unlike keywords.ts's) does not
 * collapse. Each holds as a phrase ONLY with exactly one courtesy word from
 * its own language (D1): the bare word alone is a keyword (matched first,
 * elsewhere), never a phrase.
 */
export const SINGLE_WORD_STOPS: readonly { word: string; language: "en" | "es" }[] = [
  { word: "stop", language: "en" }, { word: "stopall", language: "en" }, { word: "unsubscribe", language: "en" },
  { word: "cancel", language: "en" }, { word: "end", language: "en" }, { word: "quit", language: "en" },
  { word: "revoke", language: "en" }, { word: "optout", language: "en" },
  { word: "parar", language: "es" }, { word: "detener", language: "es" }, { word: "alto", language: "es" },
  { word: "cancelar", language: "es" }, { word: "baja", language: "es" }, { word: "nomas", language: "es" },
  { word: "no mas", language: "es" },
];

/** "lista de espera" is a waiting list: a list phrase followed by "de espera" does not count. */
export const NOT_FOLLOWED_BY: readonly { last: string; next: string }[] = [{ last: "lista", next: "de espera" }];

export function normalisePhraseText(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/['’‘`´]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * The message without ONE leading and ONE trailing courtesy word, in the
 * given language's own courtesy lists (default "es" — every existing call
 * site is Spanish-only; D1 is the first English caller, via SINGLE_WORD_STOPS).
 */
export function withoutCourtesy(whole: string, language: "en" | "es" = "es"): string {
  const leadList = language === "en" ? EN_COURTESY_LEAD : ES_COURTESY_LEAD;
  const trailList = language === "en" ? EN_COURTESY_TRAIL : ES_COURTESY_TRAIL;
  let s = ` ${whole} `;
  const lead = leadList.find((w) => s.startsWith(` ${w} `));
  if (lead) s = s.slice(lead.length + 1);
  const trail = trailList.find((w) => s.endsWith(` ${w} `));
  if (trail) s = s.slice(0, s.length - trail.length - 1);
  return s.trim();
}

/** Does the sentence phrase occur, as whole words, at least once in a way that counts? */
function occurs(hay: string, phrase: string): boolean {
  const needle = ` ${phrase} `;
  const last = phrase.slice(phrase.lastIndexOf(" ") + 1);
  for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + 1)) {
    const rest = hay.slice(at + needle.length);
    if (!NOT_FOLLOWED_BY.some((x) => x.last === last && rest.startsWith(`${x.next} `))) return true;
  }
  return false;
}

/** A Spanish verb form with its message object, in the message without its courtesy words. */
function verbWithObject(core: string): string | null {
  const hay = ` ${core} `;
  for (const form of ES_VERB_FORMS) {
    const needle = ` ${form} `;
    for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + 1)) {
      const rest = hay.slice(at + needle.length);   // the words after the form, ending in a space
      const word = ES_MESSAGE_WORDS.find((w) => rest.startsWith(`${w} `));
      if (word) return `${form} ${word}`;
      const end = ES_END_OBJECTS.find((e) => rest === `${e} `);
      if (end) return `${form} ${end}`;
      for (const x of ["mas", "nada"]) {
        const before = ES_MESSAGE_WORDS.find((w) => rest.startsWith(`${x} ${w} `));
        if (before) return `${form} ${x} ${before}`;
      }
    }
  }
  return null;
}

export function matchPhrase(text: string): PhraseMatch | null {
  const whole = normalisePhraseText(text);
  const core = withoutCourtesy(whole);
  for (const w of WHOLE_MESSAGE_PHRASES) {
    if (w.phrase === whole || (w.language === "es" && w.phrase === core)) return { phrase: w.phrase, language: w.language };
  }
  // D1: a single stop word with exactly one courtesy word (its own language's).
  // `core2 !== whole` requires a courtesy word to have actually been stripped —
  // the bare word alone (core2 === whole) is a keyword, not a phrase (precedence
  // pinned in the test file: matchKeyword is tried first by every caller).
  for (const s of SINGLE_WORD_STOPS) {
    const core2 = withoutCourtesy(whole, s.language);
    if (core2 === s.word && core2 !== whole) return { phrase: s.word, language: s.language };
  }
  for (const r of REPEATED_KEYWORDS) {
    const words = (r.language === "es" ? core : whole).split(" ");
    // English allows one "please" at either end: "Stop stop please", "Please stop stop".
    const repeat = r.language === "en" && words[0] === "please" ? words.slice(1)
      : r.language === "en" && words[words.length - 1] === "please" ? words.slice(0, -1) : words;
    if (repeat.length >= 2 && repeat.every((w) => w === r.word)) return { phrase: `${r.word} ${r.word}`, language: r.language };
  }
  const hay = ` ${whole} `;
  for (const phrase of PHRASES_EN) if (occurs(hay, phrase)) return { phrase, language: "en" };
  for (const phrase of PHRASES_ES) if (occurs(hay, phrase)) return { phrase, language: "es" };
  const verb = verbWithObject(core);
  return verb ? { phrase: verb, language: "es" } : null;
}
