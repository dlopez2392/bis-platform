/**
 * S-53 tenant vetting: THE list of trades and what BIS may sell each one
 * (docs/superpowers/specs/2026-10-27-tenant-vetting-design.md section 3; owner decisions V1-V4).
 *
 * The single source. Migration 0101's accounts_trade_check lists exactly creatableTradeKeys()
 * (trades.test.ts parses the file), so a key that leaves this list's creatable verdicts without a new
 * migration fails the build, and a key the database admits that this list does not know fails it too.
 * A verdict changes only by a dated owner decision plus a change here AND a new migration (V3). There is
 * no in-app override.
 *
 * Pure: no database, no React. Labels and reasons are data here (en/es) because they belong to the
 * entry; the sentences around them live in lib/messages.ts under vetting.* (copy.ts joins the two).
 */
import type { Locale } from "@/lib/i18n/locale";

/** allowed: created, every product available (subject to plan and billing as today).
 *  crm_only: created; Sofía and the web chat cannot be switched on.
 *  held: not created; the reason says what must happen first.
 *  turned_away: not created; a polite sentence the agency can pass on. */
export type TradeVerdict = "allowed" | "crm_only" | "held" | "turned_away";
export type Bilingual = { readonly en: string; readonly es: string };
export type TradeGroupKey =
  | "home_services" | "auto" | "personal_care" | "professional" | "food_and_care" | "health"
  | "care_at_home" | "other";

export type TradeEntry = {
  readonly key: string;
  readonly group: TradeGroupKey;
  readonly label: Bilingual;
  readonly verdict: TradeVerdict;
  /** Present exactly on held and turned_away entries (trades.test.ts). */
  readonly reason?: Bilingual;
};

/** Other's description: one line, at most this many characters (spec 5.1; 0101 accounts_trade_other_check). */
export const TRADE_OTHER_MAX = 120;

export const TRADE_GROUPS: readonly { readonly key: TradeGroupKey; readonly label: Bilingual }[] = [
  { key: "home_services", label: { en: "Home services", es: "Servicios para el hogar" } },
  { key: "auto", label: { en: "Auto", es: "Automotriz" } },
  { key: "personal_care", label: { en: "Personal care", es: "Cuidado personal" } },
  { key: "professional", label: { en: "Professional", es: "Servicios profesionales" } },
  { key: "food_and_care", label: { en: "Food and care", es: "Comida y cuidado" } },
  { key: "health", label: { en: "Health", es: "Salud" } },
  { key: "care_at_home", label: { en: "Care at home", es: "Cuidado en casa" } },
  { key: "other", label: { en: "Something else", es: "Otra cosa" } },
];

const HEALTH_HELD: Bilingual = {
  en: "Health-care businesses aren't open yet: they need protections for patient information that BIS doesn't have today.",
  es: "Aún no aceptamos negocios de salud: necesitan protecciones para la información de los pacientes que BIS no tiene hoy.",
};

const CARE_AT_HOME_TURNED_AWAY: Bilingual = {
  en: "BIS doesn't serve adult day care or home health, so we can't take this business on.",
  es: "BIS no atiende guarderías para adultos ni salud en el hogar, así que no podemos aceptar este negocio.",
};

/** The spec's section 3 table, in its order. */
export const TRADES = [
  { key: "hvac", group: "home_services", label: { en: "Heating and air conditioning", es: "Aire acondicionado y calefacción" }, verdict: "allowed" },
  { key: "plumbing", group: "home_services", label: { en: "Plumbing", es: "Plomería" }, verdict: "allowed" },
  { key: "electrical", group: "home_services", label: { en: "Electrical", es: "Electricidad" }, verdict: "allowed" },
  { key: "roofing", group: "home_services", label: { en: "Roofing", es: "Techos" }, verdict: "allowed" },
  { key: "landscaping", group: "home_services", label: { en: "Landscaping and lawn care", es: "Jardinería y paisajismo" }, verdict: "allowed" },
  { key: "pool", group: "home_services", label: { en: "Pools and spas", es: "Albercas y spas" }, verdict: "allowed" },
  { key: "pest_control", group: "home_services", label: { en: "Pest control", es: "Control de plagas" }, verdict: "allowed" },
  { key: "cleaning", group: "home_services", label: { en: "Cleaning", es: "Limpieza" }, verdict: "allowed" },
  { key: "painting", group: "home_services", label: { en: "Painting", es: "Pintura" }, verdict: "allowed" },
  { key: "remodeling", group: "home_services", label: { en: "Construction and remodeling", es: "Construcción y remodelación" }, verdict: "allowed" },
  { key: "woodworking", group: "home_services", label: { en: "Woodworking and cabinets", es: "Carpintería y muebles" }, verdict: "allowed" },
  { key: "handyman", group: "home_services", label: { en: "Handyman and repairs", es: "Reparaciones generales" }, verdict: "allowed" },
  { key: "auto", group: "auto", label: { en: "Auto repair and detailing", es: "Taller mecánico y detallado" }, verdict: "allowed" },
  { key: "beauty", group: "personal_care", label: { en: "Salons, barbers and spas", es: "Salones, barberías y spas" }, verdict: "allowed" },
  { key: "fitness", group: "personal_care", label: { en: "Gyms and trainers", es: "Gimnasios y entrenadores" }, verdict: "allowed" },
  { key: "insurance", group: "professional", label: { en: "Insurance", es: "Seguros" }, verdict: "allowed" },
  { key: "real_estate", group: "professional", label: { en: "Real estate", es: "Bienes raíces" }, verdict: "allowed" },
  { key: "events", group: "professional", label: { en: "Events and venues", es: "Eventos y salones de fiestas" }, verdict: "allowed" },
  {
    key: "law", group: "professional", label: { en: "Law firm", es: "Despacho de abogados" }, verdict: "held",
    reason: {
      en: "Law firms open once our Texas cloud-storage sheet for lawyers (Opinions 680 and 705) is ready.",
      es: "Los despachos de abogados se abrirán cuando esté lista nuestra hoja para abogados sobre el almacenamiento en la nube en Texas (Opiniones 680 y 705).",
    },
  },
  {
    key: "tax", group: "professional", label: { en: "Tax preparation", es: "Preparación de impuestos" }, verdict: "held",
    reason: {
      en: "Tax preparers aren't open yet; planned for the 2028 tax season.",
      es: "Aún no aceptamos preparadores de impuestos; está previsto para la temporada de impuestos de 2028.",
    },
  },
  { key: "restaurant", group: "food_and_care", label: { en: "Restaurant", es: "Restaurante" }, verdict: "crm_only" },
  { key: "child_care", group: "food_and_care", label: { en: "Child care", es: "Guardería" }, verdict: "crm_only" },
  { key: "medical", group: "health", label: { en: "Medical clinic", es: "Clínica médica" }, verdict: "held", reason: HEALTH_HELD },
  { key: "dental", group: "health", label: { en: "Dental", es: "Dental" }, verdict: "held", reason: HEALTH_HELD },
  { key: "therapy", group: "health", label: { en: "Therapy and mental health", es: "Terapia y salud mental" }, verdict: "held", reason: HEALTH_HELD },
  { key: "chiropractic", group: "health", label: { en: "Chiropractic and physical therapy", es: "Quiropráctica y fisioterapia" }, verdict: "held", reason: HEALTH_HELD },
  { key: "other_health", group: "health", label: { en: "Other health care", es: "Otros servicios de salud" }, verdict: "held", reason: HEALTH_HELD },
  { key: "adult_day_care", group: "care_at_home", label: { en: "Adult day care", es: "Guardería para adultos" }, verdict: "turned_away", reason: CARE_AT_HOME_TURNED_AWAY },
  { key: "home_health", group: "care_at_home", label: { en: "Home health", es: "Salud en el hogar" }, verdict: "turned_away", reason: CARE_AT_HOME_TURNED_AWAY },
  { key: "other", group: "other", label: { en: "Other (describe it)", es: "Otro (descríbalo)" }, verdict: "allowed" },
] as const satisfies readonly TradeEntry[];

export type TradeKey = (typeof TRADES)[number]["key"];

/** The same list, widened so `.reason` reads on every entry. */
export const TRADE_ENTRIES: readonly TradeEntry[] = TRADES;

const BY_KEY: ReadonlyMap<string, TradeEntry> = new Map(TRADE_ENTRIES.map((e) => [e.key, e]));

export function tradeEntry(key: string | null | undefined): TradeEntry | null {
  return key ? BY_KEY.get(key) ?? null : null;
}

export function tradeVerdict(key: string | null | undefined): TradeVerdict | null {
  return tradeEntry(key)?.verdict ?? null;
}

export function isCreatableVerdict(v: TradeVerdict): v is "allowed" | "crm_only" {
  return v === "allowed" || v === "crm_only";
}

/** Every key a company may be created with, in the list's order. 0101's CHECK lists exactly these. */
export function creatableTradeKeys(): string[] {
  return TRADE_ENTRIES.filter((e) => isCreatableVerdict(e.verdict)).map((e) => e.key);
}

export function tradeLabel(key: string | null | undefined, locale: Locale): string | null {
  return tradeEntry(key)?.label[locale] ?? null;
}

export type TradeChoice = { trade: string; tradeOther: string | null };

export type TradeChoiceCheck =
  | { ok: true; choice: TradeChoice; verdict: "allowed" | "crm_only" }
  | { ok: false; problem: "missing" | "other_description" }
  | { ok: false; problem: "not_creatable"; entry: TradeEntry };

/**
 * The ONE validation every server action that records a trade runs (Add company, Add as a company,
 * the Settings Trade card). Values come from the browser, so nothing is trusted: an unknown key is
 * "missing" (the picker never offers one), a held or turned-away key is refused with its entry (its
 * reason is the refusal), and Other needs one line of 1-120 characters. Whitespace collapses to single
 * spaces, so what is stored is one trimmed line - the shape 0101's CHECKs admit.
 */
export function checkTradeChoice(rawTrade: unknown, rawOther: unknown): TradeChoiceCheck {
  const key = typeof rawTrade === "string" ? rawTrade.trim() : "";
  const entry = tradeEntry(key);
  if (!entry) return { ok: false, problem: "missing" };
  if (!isCreatableVerdict(entry.verdict)) return { ok: false, problem: "not_creatable", entry };
  if (entry.key !== "other") return { ok: true, choice: { trade: entry.key, tradeOther: null }, verdict: entry.verdict };
  const other = typeof rawOther === "string" ? rawOther.replace(/\s+/g, " ").trim() : "";
  if (other === "" || other.length > TRADE_OTHER_MAX) return { ok: false, problem: "other_description" };
  // \s folded tab, newline and carriage return into spaces above; any control character left (NUL above
  // all, which Postgres text cannot hold) is refused here, so what passes this check 0101's CHECK admits.
  if ([...other].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127)) {
    return { ok: false, problem: "other_description" };
  }
  return { ok: true, choice: { trade: "other", tradeOther: other }, verdict: entry.verdict };
}

export type SofiaGate =
  | { ok: true }
  | { ok: false; reason: "crm_only"; trade: string }
  | { ok: false; reason: "no_trade" };

/**
 * Whether Sofía and the web chat may be SWITCHED ON for a company with this stored trade (spec 5.3).
 * Only an allowed trade opens the gate. A crm_only trade closes it, naming the trade. No trade - and any
 * stored key this module does not know or no longer calls creatable - closes it as "set the trade first".
 * Never consulted to switch anything OFF.
 */
export function sofiaGate(trade: string | null | undefined): SofiaGate {
  const entry = tradeEntry(trade);
  if (entry?.verdict === "allowed") return { ok: true };
  if (entry?.verdict === "crm_only") return { ok: false, reason: "crm_only", trade: entry.key };
  return { ok: false, reason: "no_trade" };
}

export function canUseSofia(trade: string | null | undefined): boolean {
  return sofiaGate(trade).ok;
}
