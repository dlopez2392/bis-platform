// S-47c (spec section 5.3; C1, C3, C11): the Voice page's two flags on the free text. Hours written in Facts
// (Business hours now owns them) and amounts written in Facts or Services (the price list now owns them). Flags
// never block a save; the page re-computes them as the operator types. Pure; no imports.
//
// Every number pattern is bounded on both sides by "not a letter or digit" (Unicode-aware lookarounds, not \b,
// which is ASCII-only and has no boundary after an accented letter such as the e in "mié"), so a phone number,
// a ZIP, a year and "24/7" never read as hours.

export type AmountMatch = { source: "facts" | "services"; index: number; text: string };

/** A dash range or a "de N a M" followed by one of these is a duration ("2-3 day turnaround"), not hours. */
const DURATION = String.raw`(?!\s*(?:days?|weeks?|months?|hours?|d[ií]as?|semanas?)(?![\p{L}\p{N}]))`;
const WEEKDAY = [
  "mon(?:day)?", "tue(?:s(?:day)?)?", "wed(?:nesday)?", "thu(?:r(?:s(?:day)?)?)?", "fri(?:day)?", "sat(?:urday)?", "sun(?:day)?",
  "lun(?:es)?", "mar(?:tes)?", "mi[eé](?:rcoles)?", "jue(?:ves)?", "vie(?:rnes)?", "s[aá]b(?:ado)?", "dom(?:ingo)?",
].join("|");

const HOURS_PATTERNS: readonly RegExp[] = [
  // A 12-hour time with a.m./p.m.: "8am", "8 am", "8:00 a.m.", "8 p.m.".
  /(?<![\p{L}\p{N}])(?:1[0-2]|0?[1-9])(?::[0-5][0-9])?\s?[ap]\.?m\.?(?![\p{L}\p{N}])/iu,
  // A 24-hour clock: "17:30", "8:00", "24:00".
  /(?<![\p{L}\p{N}:])(?:[01]?[0-9]|2[0-4]):[0-5][0-9](?![\p{L}\p{N}:])/u,
  // A dash range of two 1-12 numbers: "8-5", "8–5" (not "$8-12", not "1-2-3", not a duration).
  new RegExp(String.raw`(?<![\p{L}\p{N}$.:/\-–])(?:1[0-2]|0?[1-9])\s?[-–]\s?(?:1[0-2]|0?[1-9])(?![\p{N}.:/\-–])` + DURATION, "iu"),
  // Spanish: "de 8 a 5", "de 8:00 a 17:00" (not a duration).
  new RegExp(String.raw`(?<![\p{L}\p{N}])de\s+(?:[01]?[0-9]|2[0-4])(?::[0-5][0-9])?\s+a\s+(?:[01]?[0-9]|2[0-4])(?::[0-5][0-9])?(?![\p{L}\p{N}])` + DURATION, "iu"),
  // Spanish: "a las 5", "a las 17:30".
  /(?<![\p{L}\p{N}])a\s+las\s+(?:[01]?[0-9]|2[0-4])(?::[0-5][0-9])?(?![\p{L}\p{N}])/iu,
  // A weekday, English or Spanish, short or long, with or without accents, followed within 20 characters by a
  // 1-2 digit number: "Monday 9 to 3", "lunes a viernes 9", "Sábado 10".
  new RegExp(String.raw`(?<![\p{L}\p{N}])(?:${WEEKDAY})s?(?![\p{L}\p{N}])[^0-9\n]{0,20}(?<![0-9])[0-9]{1,2}(?![0-9])`, "iu"),
];

/** "$40", "$1,200.50"; "40 dollars", "40 dólares", "40 USD"; "USD 40". Global: every amount, by position. */
const NUM = String.raw`(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\.[0-9]{2})?`;
const AMOUNT = new RegExp(
  String.raw`\$\s?${NUM}(?![0-9])` +
  String.raw`|(?<![\p{L}\p{N}$.,])${NUM}\s?(?:dollars?|d[oó]lares|usd)(?![\p{L}\p{N}])` +
  String.raw`|(?<![\p{L}\p{N}])usd\s?${NUM}(?![0-9])`,
  "giu",
);
/** The words after an amount stop at the end of its phrase. */
const PHRASE_END = /[.,;:!?\r\n]/;
const FIVE_WORDS = /^(?:[ \t]+[^\s]+){0,5}/;

function amountsIn(box: string, source: AmountMatch["source"]): AmountMatch[] {
  const out: AmountMatch[] = [];
  for (const m of box.matchAll(AMOUNT)) {
    const rest = box.slice(m.index + m[0].length);
    const stop = rest.search(PHRASE_END);
    const words = FIVE_WORDS.exec(stop === -1 ? rest : rest.slice(0, stop))![0];
    out.push({ source, index: m.index, text: (m[0] + words).trimEnd() });
  }
  return out;
}

export function factsWarnings(
  facts: string,
  servicesText: string,
  o: { hasHours: boolean; hasPriceList: boolean },
): { hours: "notice" | "hint" | null; amounts: AmountMatch[] } {
  const hoursFound = HOURS_PATTERNS.some((re) => re.test(facts));
  return {
    hours: hoursFound ? (o.hasHours ? "notice" : "hint") : null,
    amounts: o.hasPriceList ? [...amountsIn(facts, "facts"), ...amountsIn(servicesText, "services")] : [],
  };
}
