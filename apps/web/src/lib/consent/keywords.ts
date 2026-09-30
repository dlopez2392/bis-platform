/**
 * The stop, start and help keywords (consent chain spec decisions 10 and 11,
 * choice 26), matched against the WHOLE message: accents, case, spaces, inner
 * hyphens and the punctuation or symbols at either end are ignored (plan G9:
 * choice 26's reasoning — customers type both — applied to "¡Alto!" and
 * "Opt-out" too). Anything longer than the word itself is not a keyword; the
 * phrase list (phrases.ts) reads sentences.
 *
 * The lists are the spec's. Telnyx's defaults (STOP, STOPALL, STOP ALL,
 * UNSUBSCRIBE, CANCEL, END, QUIT; START, UNSTOP; HELP — plan F2) are all here,
 * so a word Telnyx handles is always one BIS knows too.
 */
export type KeywordKind = "stop" | "start" | "help";
export type KeywordLanguage = "en" | "es";
export type KeywordMatch = { kind: KeywordKind; word: string; language: KeywordLanguage };

const STOP_EN = { kind: "stop", language: "en" } as const;
const STOP_ES = { kind: "stop", language: "es" } as const;

/** Each word in the matcher's own form (no accents, spaces or hyphens) → what it means. */
const KEYWORDS: ReadonlyMap<string, Omit<KeywordMatch, "word">> = new Map<string, Omit<KeywordMatch, "word">>([
  ["STOP", STOP_EN], ["STOPALL", STOP_EN], ["UNSUBSCRIBE", STOP_EN], ["CANCEL", STOP_EN],
  ["END", STOP_EN], ["QUIT", STOP_EN], ["REVOKE", STOP_EN], ["OPTOUT", STOP_EN],
  ["PARAR", STOP_ES], ["DETENER", STOP_ES], ["ALTO", STOP_ES], ["CANCELAR", STOP_ES],
  ["BAJA", STOP_ES], ["NOMAS", STOP_ES],
  ["START", { kind: "start", language: "en" }], ["UNSTOP", { kind: "start", language: "en" }],
  ["HELP", { kind: "help", language: "en" }], ["AYUDA", { kind: "help", language: "es" }],
]);

/** The two words that may also have meant an appointment (spec §4.2 step 2). */
export const CANCEL_WORDS: ReadonlySet<string> = new Set(["CANCEL", "CANCELAR"]);

/** How staff read a matched word: the spec's spaced spellings where it has them. */
const DISPLAY: Readonly<Record<string, string>> = { OPTOUT: "OPT OUT", NOMAS: "NO MAS" };

export function keywordDisplay(word: string): string {
  return DISPLAY[word] ?? word;
}

export function normaliseKeyword(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase()
    .replace(/^[\s\p{P}\p{S}\p{Cf}]+|[\s\p{P}\p{S}\p{Cf}]+$/gu, "")
    .replace(/[\s\p{Pd}]+/gu, "");
}

export function matchKeyword(text: string): KeywordMatch | null {
  const word = normaliseKeyword(text);
  const hit = KEYWORDS.get(word);
  return hit ? { ...hit, word } : null;
}
