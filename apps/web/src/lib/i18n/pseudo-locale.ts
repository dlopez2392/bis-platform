// A synthetic third "locale" for F-014's overflow check only — never shown
// to a real user, never translated by a human, so it can never drift from
// real Spanish copy the way a stale translation could. Accented vowels
// stress font glyph coverage; the bracket wrapper makes truncation visible
// in a screenshot that a plain length increase would not.
//
// `{placeholder}` tokens are left byte-for-byte untouched wherever they fall
// in the input: t.ts's `interpolate()` matches them with an exact
// `replaceAll(`{${k}}`, ...)`, and that match can happen either before this
// runs (the rendered-string case Task 11 uses) or, if this is ever pointed
// at a raw catalogue entry, after. Either way, accenting a vowel inside the
// brace (e.g. "{count}" → "{cóúnt}") would silently break the substitution,
// leaving the literal token on screen — so placeholders are carved out
// before the vowel pass runs, not swept up by it.
const ACCENTS: Record<string, string> = { a: "á", e: "é", i: "í", o: "ó", u: "ú" };
const PAD_WORDS = ["Ẋẋ", "Ṿṿ"];
const PLACEHOLDER_RE = /\{[^{}]*\}/g;

function accentVowels(segment: string): string {
  return segment.replace(/[aeiou]/gi, (ch) => {
    const lower = ACCENTS[ch.toLowerCase()];
    if (!lower) return ch;
    return ch === ch.toUpperCase() ? lower.toUpperCase() : lower;
  });
}

export function pseudoLocale(text: string): string {
  let accented = "";
  let last = 0;
  for (const match of text.matchAll(PLACEHOLDER_RE)) {
    const start = match.index ?? 0;
    accented += accentVowels(text.slice(last, start));
    accented += match[0];
    last = start + match[0].length;
  }
  accented += accentVowels(text.slice(last));

  let out = accented;
  let i = 0;
  while (out.length < Math.ceil(text.length * 1.35) + 2) {
    out = `${out} ${PAD_WORDS[i % PAD_WORDS.length]}`;
    i += 1;
  }
  return `[${out}]`;
}
