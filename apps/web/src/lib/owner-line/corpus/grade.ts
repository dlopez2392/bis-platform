// apps/web/src/lib/owner-line/corpus/grade.ts
// F-032 plan Task 14: the code grader for the no-guessing corpus (spec §7: "Sofía never states a number or a name
// the tools did not return"). It measures the PROMPT and guards no security property (spec §2.3; memory
// bis-prompt-only-limits: wording-only rules did not converge in three runs, so this is judged by code over repeat=3,
// and a person reads every transcript). If an item fails, change the prompt or the tool payload, never the grader.

export type CorpusItem = { id: string; locale: "en" | "es"; lines: string[]; stub: Record<string, unknown>; must: string[] };

const SPELLED: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  // No "una"/"un": in Spanish they are articles far more often than counts ("una persona nueva").
  cero: 0, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
};
/** Words a reply may capitalise without a tool saying them: sentence openers, the persona, days, months, words of the line. */
const ALLOWED = new Set(["I", "You", "Your", "Usted", "Su", "Sofía", "Sofia", "Hi", "Hola", "Today", "Hoy", "Tomorrow", "Mañana",
  "Yesterday", "Ayer", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday", "Lunes", "Martes",
  "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo", "AM", "PM", "To", "There", "No", "Yes", "Sí", "Nothing", "Nada",
  "The", "La", "El", "Los", "Las", "A", "An", "It", "That", "This", "Ese", "Esa", "Eso", "And", "Y", "Also", "También"]);

/** A phone number as written: 7 or more digits with the punctuation a person writes them with. */
const PHONE = /\+?\(?[0-9][0-9().\s-]{5,}[0-9]/g;
const digitsOf = (s: string) => s.replace(/[^0-9]/g, "");
/** The word before "one"/"uno" that makes it a pronoun, not a count. "the one" and "another one" can claim a count, so they stay judged. */
const PRONOUN_ONE = /\b(either|neither|each|no|any|every|which|this|that|cada)\s+$/i;

/**
 * Every number (digits, times, spelled 0-12, a phone number) and every capitalised name in `reply` that no ok:true
 * tool output in the same item contains. `session` lists words the SESSION gives the model (the person's first name
 * and the business's name, both in its instructions): grounded, not guessed (I-14).
 * A phone number is grounded when its digits are a grounded phone number's digits, so a callback number read aloud as
 * the To do writes it, with or without its punctuation, is grounded (the callback-number ruling); a country code the
 * tool carries and the reply drops is allowed (the shorter is a suffix of the longer, and at least 7 digits long).
 */
export function ungrounded(reply: string, toolOutputs: string[], session: string[] = []): string[] {
  const grounded = [...toolOutputs.filter((o) => !o.includes('"ok":false')), ...session].join(" ");
  const groundedNums = new Set<number>([...grounded.matchAll(/[0-9]+/g)].map((x) => Number(x[0])));
  const groundedPhones = [...grounded.matchAll(PHONE)].map((x) => digitsOf(x[0])).filter((d) => d.length >= 7);
  const bad: string[] = [];
  // Phone numbers first, then the rest of the reply with each phone number blanked out (so its digit groups are not
  // judged again as counts).
  let rest = reply;
  for (const mt of reply.matchAll(PHONE)) {
    const d = digitsOf(mt[0]);
    if (d.length < 7) continue;
    const ok = groundedPhones.some((g) => g === d || (g.endsWith(d) || d.endsWith(g)));
    if (!ok) bad.push(mt[0].trim());
    rest = rest.replace(mt[0], " ".repeat(mt[0].length));
  }
  for (const mt of rest.matchAll(/[0-9]{1,2}:[0-9]{2}|[0-9]+|[A-Za-zÀ-ÿ]+/g)) {
    const tok = mt[0];
    if (/^[0-9]{1,2}:[0-9]{2}$/.test(tok)) { if (!grounded.includes(tok)) bad.push(tok); continue; }
    if (/^[0-9]+$/.test(tok)) { if (!groundedNums.has(Number(tok))) bad.push(tok); continue; }
    const spelled = SPELLED[tok.toLowerCase()];
    // "either one", "each one", "no one", "cada uno": a pronoun, not a count (O-4 run 2026-11-10, 04-normal r1).
    if ((tok.toLowerCase() === "one" || tok.toLowerCase() === "uno") && PRONOUN_ONE.test(rest.slice(0, mt.index))) continue;
    if (spelled !== undefined) { if (!groundedNums.has(spelled)) bad.push(tok); continue; }
    // A sentence's first word is capitalised by grammar, not because it is a name.
    const before = rest.slice(0, mt.index).trimEnd();
    const opener = before === "" || /[.!?¿¡]$/.test(before);
    if (!opener && /^[A-ZÁÉÍÓÚÑ]/.test(tok) && !ALLOWED.has(tok) && !grounded.includes(tok)) bad.push(tok);
  }
  return bad;
}

/** The required words an answer lacks. Case-blind, curly apostrophes read as straight; "a|b" means either will do. */
export function missingMust(answer: string, must: string[]): string[] {
  const norm = (s: string) => s.toLowerCase().replace(/[\u2018\u2019]/g, "'");
  const a = norm(answer);
  return must.filter((m) => !m.split("|").some((alt) => a.includes(norm(alt))));
}
