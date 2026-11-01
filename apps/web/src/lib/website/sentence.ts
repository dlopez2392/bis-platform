import type { Locale } from "@/lib/i18n/locale";
import { tag } from "@/lib/format";
import type { Period } from "./view-model";

export type SentenceSegment = { text: string; strong?: true };
type Ranked = { name: string; visitors: number; share: number };

const LEAD_MARGIN = 0.10;        // top vs runner-up, in share points
const SAME_THRESHOLD = 0.05;     // under this the change reads "about the same"
const PLAIN_COUNT_BELOW = 20;    // no percentages for a tiny site
const DEVICE_SHARE = 0.60;
const TENTHS = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
// S-10 T2: the Spanish tenths, 1:1 with TENTHS above — only 6-9 are ever
// reachable (DEVICE_SHARE gates everything below six, and ten rounds into
// the separate "nearly all"/"casi todos" branch), but every index is filled
// for the same reason TENTHS itself is: this is a generic word table, not a
// table sized to today's thresholds.
const TENTHS_ES = ["", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve"];

function periodWords(period: Period): string {
  return period === 7 ? "the week" : period === 14 ? "the two weeks" : "the month";
}
function deviceWords(name: string): string {
  const n = name.toLowerCase();
  return n === "mobile" ? "a phone" : n === "desktop" ? "a computer" : n === "tablet" ? "a tablet" : `a ${n}`;
}
const fmt = (n: number, locale: Locale = "en") => n.toLocaleString(tag(locale));

// --- Spanish word banks (usted register throughout; §4.3's glossary: "su
// sitio web", never "tu"). Kept separate from the English ones above rather
// than threaded through one shared table, so the already-pinned English
// control flow below is untouched byte-for-byte. ---
/** "que la semana anterior" / "que las dos semanas anteriores" / "que el mes
 *  anterior" — the comparison clause's tail, both for a real delta and for
 *  "casi igual que …". */
function periodBeforeEs(period: Period): string {
  if (period === 7) return "la semana anterior";
  if (period === 14) return "las dos semanas anteriores";
  return "el mes anterior";
}
/** "la última semana" / "las últimas dos semanas" / "el último mes" — the
 *  "in the last …" clause, for the zero- and plain-count branches. */
function lastPeriodEs(period: Period): string {
  if (period === 7) return "la última semana";
  if (period === 14) return "las últimas dos semanas";
  return "el último mes";
}
function deviceWordsEs(name: string): string {
  const n = name.toLowerCase();
  if (n === "mobile") return "el celular";
  if (n === "desktop") return "la computadora";
  if (n === "tablet") return "la tableta";
  // M-3 (review): an unknown device name has no known gender to pick an
  // article for — "su" (their) sidesteps the guess rather than mismatching
  // one, and still reads naturally after "usaron" (used their X).
  return `su ${n}`;
}
/** I-3 (review): channelOf's (lib/website/channel.ts) category names take
 *  an article in a sentence ("desde las redes sociales", "desde otros
 *  sitios web"); brand names (Google, Bing, DuckDuckGo, Yahoo) are proper
 *  nouns and take none ("desde Google"). Mirrors the panel's own
 *  website.channel.* keys in wording, but is NOT sourced from them —
 *  sentence.ts reads no catalogue key at all (generated prose). */
function sourceNameEs(name: string): string {
  if (name === "Social") return "las redes sociales";
  if (name === "AI assistants") return "los asistentes de IA";
  if (name === "Other websites") return "otros sitios web";
  return name;
}

/** The Spanish half of `websiteSentence` below — same four restraint rules,
 *  same control flow, Valley Spanish wording (glossary §4.3: "llegó desde"
 *  rather than a literal "lo encontraron", which read as addressing the
 *  reader directly in an awkward object-pronoun construction). */
function websiteSentenceEs(input: {
  period: Period; visitors: number; priorVisitors: number;
  topSource: Ranked | null; runnerUpSourceShare: number;
  topPage: Ranked | null; runnerUpPageShare: number;
  topDevice: Ranked | null;
}): SentenceSegment[] {
  if (input.visitors === 0) {
    return [{ text: `Todavía nadie ha visitado su sitio web en ${lastPeriodEs(input.period)}.` }];
  }
  if (input.visitors < PLAIN_COUNT_BELOW || input.priorVisitors === 0) {
    const noun = input.visitors === 1 ? "persona" : "personas";
    const verb = input.visitors === 1 ? "visitó" : "visitaron";
    return [
      { text: `${fmt(input.visitors, "es")} ${noun}`, strong: true },
      { text: ` ${verb} su sitio web en ${lastPeriodEs(input.period)}.` },
    ];
  }

  const out: SentenceSegment[] = [{ text: `${fmt(input.visitors, "es")} personas`, strong: true }, { text: " visitaron su sitio web, " }];
  const change = (input.visitors - input.priorVisitors) / input.priorVisitors;
  if (Math.abs(change) < SAME_THRESHOLD) {
    // M-3 (review): "que en" (than IN the two weeks before), not a bare
    // "que" — the natural Spanish preposition this comparison needs.
    out.push({ text: `casi igual que en ${periodBeforeEs(input.period)}.` });
  } else {
    const pct = Math.round(Math.abs(change) * 100);
    out.push({ text: `${pct}% ${change > 0 ? "más" : "menos"}`, strong: true }, { text: ` que en ${periodBeforeEs(input.period)}.` });
  }

  const clauses: SentenceSegment[][] = [];
  if (input.topSource && input.topSource.share - input.runnerUpSourceShare >= LEAD_MARGIN && input.topSource.name !== "Direct") {
    clauses.push([{ text: "la mayoría llegó desde " }, { text: sourceNameEs(input.topSource.name), strong: true }]);
  }
  if (input.topPage && input.topPage.share - input.runnerUpPageShare >= LEAD_MARGIN) {
    clauses.push([{ text: "la página que más leyeron fue " }, { text: input.topPage.name, strong: true }]);
  }
  if (input.topDevice && input.topDevice.share >= DEVICE_SHARE) {
    const tenths = Math.round(input.topDevice.share * 10);
    // M-3 (review): "usaron" (used), not "estaban en" (were on/in) — and
    // "casi todas" (feminine, agreeing with "personas") not "casi todos".
    clauses.push([{ text: tenths >= 10 ? `casi todas usaron ${deviceWordsEs(input.topDevice.name)}` : `${TENTHS_ES[tenths]} de cada diez usaron ${deviceWordsEs(input.topDevice.name)}` }]);
  }
  if (clauses.length === 0) return out;

  out.push({ text: " " });
  clauses.forEach((clause, i) => {
    // M-2 (review): no serial comma before the last clause — Spanish joins
    // with a bare " y ", unlike the English mockup's ", and".
    if (i > 0) out.push({ text: i === clauses.length - 1 ? " y " : ", " });
    const first = clause[0]!;
    out.push(i === 0 ? { ...first, text: first.text.charAt(0).toUpperCase() + first.text.slice(1) } : first);
    out.push(...clause.slice(1));
  });
  out.push({ text: "." });
  return out;
}

/**
 * The sentence panel. Built from the same numbers as the tiles, so it can
 * never disagree with them. Four restraint rules, each pinned by a test: a
 * tiny site gets a plain count and no percentages; under 5% reads "about the
 * same"; a top source or page is named only with a 10-point lead; a device
 * is named only at 60% share.
 */
export function websiteSentence(input: {
  period: Period; visitors: number; priorVisitors: number;
  topSource: Ranked | null; runnerUpSourceShare: number;
  topPage: Ranked | null; runnerUpPageShare: number;
  topDevice: Ranked | null;
}, locale: Locale = "en"): SentenceSegment[] {
  if (locale === "es") return websiteSentenceEs(input);
  const p = periodWords(input.period);
  const inThe = p.replace("the ", "");
  if (input.visitors === 0) return [{ text: `No one has visited your website in the last ${inThe} yet.` }];
  if (input.visitors < PLAIN_COUNT_BELOW || input.priorVisitors === 0) {
    const noun = input.visitors === 1 ? "person" : "people";
    return [{ text: `${fmt(input.visitors)} ${noun}`, strong: true }, { text: ` visited your website in the last ${inThe}.` }];
  }

  const out: SentenceSegment[] = [{ text: `${fmt(input.visitors)} people`, strong: true }, { text: " visited your website, " }];
  const change = (input.visitors - input.priorVisitors) / input.priorVisitors;
  if (Math.abs(change) < SAME_THRESHOLD) {
    out.push({ text: `about the same as ${p} before.` });
  } else {
    const pct = Math.round(Math.abs(change) * 100);
    out.push({ text: `${pct}% ${change > 0 ? "more" : "fewer"}`, strong: true }, { text: ` than ${p} before.` });
  }

  const clauses: SentenceSegment[][] = [];
  if (input.topSource && input.topSource.share - input.runnerUpSourceShare >= LEAD_MARGIN && input.topSource.name !== "Direct") {
    clauses.push([{ text: "Most of them found you on " }, { text: input.topSource.name, strong: true }]);
  }
  if (input.topPage && input.topPage.share - input.runnerUpPageShare >= LEAD_MARGIN) {
    clauses.push([{ text: "the page they read most was " }, { text: input.topPage.name, strong: true }]);
  }
  if (input.topDevice && input.topDevice.share >= DEVICE_SHARE) {
    const tenths = Math.round(input.topDevice.share * 10);
    clauses.push([{ text: tenths >= 10 ? `nearly all of them were on ${deviceWords(input.topDevice.name)}` : `${TENTHS[tenths]} in ten were on ${deviceWords(input.topDevice.name)}` }]);
  }
  if (clauses.length === 0) return out;

  out.push({ text: " " });
  clauses.forEach((clause, i) => {
    if (i > 0) out.push({ text: i === clauses.length - 1 ? ", and " : ", " });
    const first = clause[0]!;
    // Sentence case only for the first clause; the others continue the sentence.
    out.push(i === 0 ? { ...first, text: first.text.charAt(0).toUpperCase() + first.text.slice(1) } : first);
    out.push(...clause.slice(1));
  });
  out.push({ text: "." });
  return out;
}
