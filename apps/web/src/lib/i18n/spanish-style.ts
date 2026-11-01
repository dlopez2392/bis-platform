// The Spanish dashboard's copy rules as checks (S-10 T0, spec
// docs/superpowers/specs/2026-10-31-spanish-dashboard-design.md §4 and §5.2):
// G4 the register, G5 placeholders, G6 the glossary. Pure: each takes the
// catalogue and returns the keys that break the rule, so the live test can
// freeze today's list and fail only on a NEW key (shrinking is free).

type Catalogue = Readonly<Record<string, string>>;

/** Every Spanish twin with the English it translates: `x` ↔ `x.es`, or
 *  `x.en` ↔ `x.es`. A `.es` key with no English partner is skipped. */
export function twinPairs(catalogue: Catalogue): { key: string; en: string; es: string }[] {
  const out: { key: string; en: string; es: string }[] = [];
  for (const [k, es] of Object.entries(catalogue)) {
    if (!k.endsWith(".es")) continue;
    const base = k.slice(0, -3);
    const en = catalogue[base] ?? catalogue[`${base}.en`];
    if (en !== undefined) out.push({ key: k, en, es });
  }
  return out;
}

/**
 * G4. Words that are second-person informal (*tú*) and nothing else. The
 * owner settled *usted* everywhere (Q2, 2026-10-31; `docs/crm-features.md`
 * §5.2's design note). A suffix rule cannot do this: "-iste" also matches
 * *existe*, and bare imperatives such as "revisa" or "vuelve" are also the
 * third person ("el sistema revisa"), so only unambiguous forms are listed.
 */
export const TU_WORDS: readonly string[] = [
  "tu", "tus", "tú", "ti", "te", "contigo",
  "puedes", "tienes", "quieres", "necesitas", "debes", "sabes", "prefieres", "verás", "elijas", "has",
  "volviste", "agregaste", "elegiste", "escribiste", "cambiaste", "recibiste", "hiciste",
  "recárgala", "inténtalo", "cámbiala", "avísanos", "escríbenos", "llámanos", "dinos", "revísalo", "agrégalo",
  // S-10 review M-4: present "estar"/"ser", the -rás futures listed one by
  // one (a "-rás" suffix would also catch "atrás"), present subjunctives, and
  // the possessive.
  "estás", "eres", "podrás", "tendrás", "recibirás", "sabrás", "harás", "deberás", "estarás", "encontrarás",
  "puedas", "tengas", "quieras", "hayas", "tuyo", "tuya", "tuyos", "tuyas",
];
const TU_RE = new RegExp(`(?<![\\p{L}])(${TU_WORDS.join("|")})(?![\\p{L}])`, "iu");

export function registerViolations(catalogue: Catalogue): string[] {
  return twinPairs(catalogue).filter((p) => TU_RE.test(stripPlaceholders(p.es))).map((p) => p.key).sort();
}

const PLACEHOLDER_RE = /\{(\w+)\}/g;
const placeholders = (s: string) => [...s.matchAll(PLACEHOLDER_RE)].map((x) => x[1]).sort().join(",");
const stripPlaceholders = (s: string) => s.replace(PLACEHOLDER_RE, " ");

/** G5. Twins whose `{placeholders}` differ from the English: a dropped
 *  `{count}` renders a sentence with a hole, a renamed one renders the raw
 *  token. Zero today; no frozen list. */
export function placeholderMismatches(catalogue: Catalogue): string[] {
  return twinPairs(catalogue).filter((p) => placeholders(p.en) !== placeholders(p.es)).map((p) => p.key).sort();
}

/** G6. The glossary's "Never" column (spec §4.3): when the English holds
 *  the term, the Spanish must not use the banned word. Matched with
 *  placeholders removed, so `{email}` never reads as the word "email". */
export type GlossaryRule = { id: string; en: RegExp; never: RegExp; use: string };

export const GLOSSARY_RULES: readonly GlossaryRule[] = [
  { id: "settings", en: /\bsettings\b/i, never: /\bconfiguraci[oó]n\b/i, use: "ajustes" },
  { id: "delete", en: /\bdelet/i, never: /\belimin/i, use: "borrar" },
  { id: "book", en: /\bbook(s|ed|ing)?\b/i, never: /\breserv/i, use: "agendar, cita" },
  { id: "try-again", en: /\btry again\b/i, never: /\breintentar\b|\bvuelva a intentarlo\b/i, use: "Intentar de nuevo / Inténtelo de nuevo." },
  { id: "estimate", en: /\b(estimates?|quotes?)\b/i, never: /\b(presupuesto|cotizaci[oó]n)/i, use: "estimado" },
  { id: "add", en: /\badd/i, never: /\bañad/i, use: "agregar" },
  { id: "email", en: /\bemails?\b/i, never: /\be-?mails?\b/i, use: "correo" },
  { id: "text", en: /\btexts?\b/i, never: /\bSMS\b/, use: "texto" },
  { id: "lead", en: /\bleads?\b/i, never: /\bprospecto/i, use: "cliente potencial" },
  // The role, not "agency staff" (the agency's own people: "el personal de la agencia").
  { id: "staff", en: /(?<!agency )\bstaff\b/i, never: /\bpersonal\b/i, use: "empleado" },
  { id: "owner", en: /\bowners?\b/i, never: /\bpropietari/i, use: "dueño" },
  { id: "upload", en: /\bupload/i, never: /\bcarg(ar|ue)\b/i, use: "subir" },
  // S-10 review I-4: the glossary's other "Never" entries. None has a breach
  // today, so each is hard from the day it lands. Left out on purpose
  // (spec §4.3): "servicio" for job (it is also "service", as in Services &
  // prices), "registro" for record (it is also a log, the access log's word),
  // "inicio" for dashboard (also "inicio de sesión", sign-in), and
  // "contacto" for customer in prose (a contact row is legitimately one).
  { id: "dashboard", en: /\bdashboard\b/i, never: /\btablero\b/i, use: "panel" },
  { id: "deal", en: /\bdeals?\b/i, never: /\btratos?\b/i, use: "oportunidad" },
  { id: "appointment", en: /\b(appointments?|bookings?)\b/i, never: /\breserva(s|ci[oó]n|ciones)?\b/i, use: "cita" },
  { id: "reschedule", en: /\breschedul/i, never: /\breprogram/i, use: "cambiar la cita" },
  { id: "answered", en: /\banswered\b/i, never: /\bcontestad[oa]s?\b/i, use: "atendida" },
  { id: "trade", en: /\btrades?\b/i, never: /\boficios?\b/i, use: "giro" },
  { id: "to-do", en: /\bto do\b/i, never: /\btareas?\b/i, use: "pendientes" },
];

/** `key|rule` pairs that break a glossary rule, sorted. */
export function glossaryViolations(catalogue: Catalogue, rules: readonly GlossaryRule[] = GLOSSARY_RULES): string[] {
  const out: string[] = [];
  for (const p of twinPairs(catalogue)) {
    const en = stripPlaceholders(p.en);
    const es = stripPlaceholders(p.es);
    for (const r of rules) if (r.en.test(en) && r.never.test(es)) out.push(`${p.key}|${r.id}`);
  }
  return out.sort();
}
