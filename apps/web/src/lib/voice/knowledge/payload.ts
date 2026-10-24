// S-47c (spec 4.2, 5.5, 5.6): the snapshot payload, "exactly what she was given". The SAME object is sent to
// ensure_knowledge_snapshot / save_voice_knowledge and builds the prompt (promptKnowledge), so the two cannot
// disagree. Deterministic: fixed key order, positions 1..n, spans sorted, never a row id. Pure; relative imports.
import { normalizeOpenHours, type OpenHours } from "../../booking/slots";
import { priceSentence, PRICE_KINDS, type PriceKind, type PricedService } from "./price-sentence";
import { hasOpenDay, hoursLines } from "./hours";
import { closedDayLine, type ClosedDayLine } from "./closure-lines";
import type { ClosedDay } from "../../business-status/status";

/** Bump with ANY change to a template here, in ./price-sentence.ts or in ./hours.ts's lines: the next call then
 *  records a new snapshot (spec 4.2, 5.6). */
export const KNOWLEDGE_RENDERER_VERSION = 2; // 2: S-47d's closed-day line (./closure-lines.ts)

export type ServiceInput = PricedService & { description_en: string | null; description_es: string | null };
export type KnowledgeService = ServiceInput & { position: number; sentence_en: string; sentence_es: string };
/** schema 1 = S-47c (stored before S-47d; read with closed_days []); schema 2 = S-47d, the only one built now. */
export type KnowledgePayload = {
  schema: 1 | 2; facts: string; services_text: string; timezone: string;
  business_hours: OpenHours | null; hours_lines: string[] | null;
  services: KnowledgeService[]; closed_days: ClosedDayLine[]; renderer_version: number;
};
/** At most this many upcoming closed ranges enter a payload (spec 4.2). */
export const MAX_PAYLOAD_CLOSED_DAYS = 20;
const CLOSED_DAY_REASONS: readonly unknown[] = ["holiday", "vacation", "other"];
/** S-47d (plan Task 10): REQUIRED on every caller, so none can forget it — every surface now reads the switch
 *  and the closed days together. `closedDays` is the account's full set (possibly []); it is `knowledgeFromLive`
 *  that turns a FAILED read into [] here, never this function. */
type ClosedDaysInput = { closedDays: readonly ClosedDay[]; today: string };

/** Ranges ending on or after `today`, soonest first (starts_on, then ends_on), at most 20, each by its fields with
 *  the line she reads: never a row's id, account or author. */
function upcomingClosedDays(closedDays: readonly ClosedDay[], today: string): ClosedDayLine[] {
  return closedDays
    .filter((d) => d.ends_on >= today)
    .map((d) => ({ starts_on: d.starts_on, ends_on: d.ends_on, reason: d.reason }))
    .sort((a, b) => (a.starts_on < b.starts_on ? -1 : a.starts_on > b.starts_on ? 1 : a.ends_on < b.ends_on ? -1 : a.ends_on > b.ends_on ? 1 : 0))
    .slice(0, MAX_PAYLOAD_CLOSED_DAYS)
    .map((d) => ({ ...d, line: closedDayLine(d) }));
}
export type RenderedService = Pick<KnowledgeService,
  "name_en" | "name_es" | "description_en" | "description_es" | "sentence_en" | "sentence_es">;

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const mins = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));

/** Normalized (slots.ts's defensive reader), spans sorted, keys Sunday first; null when no day is open (SD17). */
export function usableHours(raw: unknown): OpenHours | null {
  const n = normalizeOpenHours(raw);
  if (!hasOpenDay(n)) return null;
  const out: OpenHours = {};
  for (const d of DAYS) {
    const spans = n[d];
    if (spans && spans.length > 0) out[d] = [...spans].sort((a, b) => mins(a[0]) - mins(b[0])).map(([f, t]): [string, string] => [f, t]);
  }
  return out;
}

export function buildKnowledgePayload(input: {
  facts: string; servicesText: string; timezone: string; businessHours: unknown; services: readonly ServiceInput[];
} & ClosedDaysInput): KnowledgePayload {
  const hours = usableHours(input.businessHours);
  return {
    schema: 2,
    facts: input.facts,
    services_text: input.servicesText,
    timezone: input.timezone,
    business_hours: hours,
    hours_lines: hours ? hoursLines(hours) : null,
    // Each row by its fields, never spread: a stored row's id, account_id, position and created_at never enter.
    services: input.services.map((s, i) => ({
      position: i + 1,
      name_en: s.name_en, name_es: s.name_es,
      description_en: s.description_en, description_es: s.description_es,
      price_kind: s.price_kind, amount_cents: s.amount_cents, amount_max_cents: s.amount_max_cents,
      unit_en: s.unit_en, unit_es: s.unit_es,
      sentence_en: priceSentence(s, "en"), sentence_es: priceSentence(s, "es"),
    })),
    closed_days: upcomingClosedDays(input.closedDays, input.today),
    renderer_version: KNOWLEDGE_RENDERER_VERSION,
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStrOrNull = (v: unknown): v is string | null => v === null || typeof v === "string";
const isIntOrNull = (v: unknown): v is number | null => v === null || Number.isInteger(v);

/** The stored hours must BE their own normalization (what usableHours wrote), day by day; jsonb reorders object
 *  keys, so the comparison is per day, never on the serialized whole. */
function sameHours(raw: Record<string, unknown>, norm: OpenHours): boolean {
  if (Object.keys(raw).some((k) => !(DAYS as readonly string[]).includes(k))) return false;
  return DAYS.every((d) => JSON.stringify(raw[d] ?? null) === JSON.stringify(norm[d] ?? null));
}

function parseService(raw: unknown, position: number): KnowledgeService | null {
  if (!isObj(raw)) return null;
  const r = raw;
  if (r.position !== position) return null;
  if (typeof r.name_en !== "string" || !isStrOrNull(r.name_es)) return null;
  if (!isStrOrNull(r.description_en) || !isStrOrNull(r.description_es)) return null;
  if (!(PRICE_KINDS as readonly unknown[]).includes(r.price_kind)) return null;
  if (!isIntOrNull(r.amount_cents) || !isIntOrNull(r.amount_max_cents)) return null;
  if (!isStrOrNull(r.unit_en) || !isStrOrNull(r.unit_es)) return null;
  if (typeof r.sentence_en !== "string" || typeof r.sentence_es !== "string") return null;
  const s: KnowledgeService = {
    position,
    name_en: r.name_en, name_es: r.name_es,
    description_en: r.description_en, description_es: r.description_es,
    price_kind: r.price_kind as PriceKind, amount_cents: r.amount_cents, amount_max_cents: r.amount_max_cents,
    unit_en: r.unit_en, unit_es: r.unit_es,
    sentence_en: r.sentence_en, sentence_es: r.sentence_es,
  };
  // A shape the CHECK refuses could never have been built. The sentences are NOT compared with a fresh render:
  // a stored snapshot is what she was given then, whatever the renderer says now.
  try {
    priceSentence(s, "en");
    priceSentence(s, "es");
  } catch {
    return null;
  }
  return s;
}

/** A stored schema-2 range, or null when it is not one build could have written. The line is NOT re-rendered. */
function parseClosedDay(raw: unknown): ClosedDayLine | null {
  if (!isObj(raw)) return null;
  if (typeof raw.starts_on !== "string" || typeof raw.ends_on !== "string" || typeof raw.line !== "string") return null;
  if (raw.reason !== null && !CLOSED_DAY_REASONS.includes(raw.reason)) return null;
  return { starts_on: raw.starts_on, ends_on: raw.ends_on, reason: raw.reason as ClosedDay["reason"], line: raw.line };
}

/** A stored snapshot (a jsonb read) back into the payload, or null when it is not one buildKnowledgePayload could
 *  have built. Returns a NEW object in build's key order, so it round-trips with toStrictEqual. Never re-renders. */
export function parseKnowledgePayload(raw: unknown): KnowledgePayload | null {
  if (!isObj(raw)) return null;
  // Schema 1 (S-47c) has no closed_days key and reads as []; schema 2 must carry the array.
  if (raw.schema !== 1 && raw.schema !== 2) return null;
  if (raw.schema === 1 ? "closed_days" in raw : !Array.isArray(raw.closed_days)) return null;
  if (typeof raw.facts !== "string" || typeof raw.services_text !== "string" || typeof raw.timezone !== "string") return null;
  if (!Number.isInteger(raw.renderer_version) || (raw.renderer_version as number) < 1) return null;

  let business_hours: OpenHours | null = null;
  if (raw.business_hours !== null) {
    if (!isObj(raw.business_hours)) return null;
    business_hours = usableHours(raw.business_hours);
    if (business_hours === null || !sameHours(raw.business_hours, business_hours)) return null;
  }
  let hours_lines: string[] | null = null;
  if (raw.hours_lines !== null) {
    if (!Array.isArray(raw.hours_lines) || raw.hours_lines.length !== 7) return null;
    if (!raw.hours_lines.every((l) => typeof l === "string")) return null;
    hours_lines = [...(raw.hours_lines as string[])];
  }
  if ((business_hours === null) !== (hours_lines === null)) return null;

  if (!Array.isArray(raw.services)) return null;
  const services: KnowledgeService[] = [];
  for (let i = 0; i < raw.services.length; i++) {
    const s = parseService(raw.services[i], i + 1);
    if (!s) return null;
    services.push(s);
  }

  const closed_days: ClosedDayLine[] = [];
  if (raw.schema === 2) {
    for (const d of raw.closed_days as unknown[]) {
      const c = parseClosedDay(d);
      if (!c) return null;
      closed_days.push(c);
    }
  }

  return {
    schema: raw.schema,
    facts: raw.facts,
    services_text: raw.services_text,
    timezone: raw.timezone,
    business_hours,
    hours_lines,
    services,
    closed_days,
    renderer_version: raw.renderer_version as number,
  };
}

/** The live read (spec 5.5; SD9, C20). `services === null` means the list read FAILED: the free text and hours
 *  stay, the list is empty, and the payload is NOT recordable (a snapshot must never claim "no prices" when the
 *  list was unknown). A row that cannot render is the same as a failed read, never a throw; the routes log it. An
 *  EMPTY list is a successful read. */
export function knowledgeFromLive(input: {
  profile: { facts: string; services: string; business_hours?: unknown };
  timezone: string;
  services: readonly ServiceInput[] | null;
  /** S-47d (plan Task 10): REQUIRED on every caller — null means the closed-days read FAILED, never "none planned"
   *  ([] says that). `today` is always needed to filter them, whichever way the read went. */
  closedDays: readonly ClosedDay[] | null;
  today: string;
}): {
  payload: KnowledgePayload; recordable: boolean; listUnavailable: boolean; closedDaysUnavailable: boolean;
} {
  // S-47d (spec 4.2): closedDays null is a FAILED read, C20's rule applied to the closed days: no CLOSED DAYS block
  // and not recordable, so a snapshot never claims "no closed days" when they were unknown.
  const closedDaysUnavailable = input.closedDays === null;
  const days: ClosedDaysInput = { closedDays: input.closedDays ?? [], today: input.today };
  const base = {
    facts: input.profile.facts, servicesText: input.profile.services,
    timezone: input.timezone, businessHours: input.profile.business_hours, ...days,
  };
  const failed = () => ({ payload: buildKnowledgePayload({ ...base, services: [] }), recordable: false, listUnavailable: true, closedDaysUnavailable });
  if (input.services === null) return failed();
  try {
    return { payload: buildKnowledgePayload({ ...base, services: input.services }), recordable: !closedDaysUnavailable, listUnavailable: false, closedDaysUnavailable };
  } catch {
    return failed();
  }
}

/** What the prompt reads from a payload. An empty list and no hours are nulls, so the prompt stays byte-identical
 *  to today's (C3). */
export function promptKnowledge(p: KnowledgePayload): {
  facts: string; services: string; businessHours: OpenHours | null; priceList: RenderedService[] | null;
  closedDays: ClosedDayLine[] | null;
} {
  return {
    facts: p.facts,
    services: p.services_text,
    businessHours: p.business_hours,
    priceList: p.services.length === 0 ? null
      : p.services.map(({ name_en, name_es, description_en, description_es, sentence_en, sentence_es }) =>
        ({ name_en, name_es, description_en, description_es, sentence_en, sentence_es })),
    // S-47d: none (or a failed read, which stores none) gives no CLOSED DAYS block.
    closedDays: p.closed_days.length === 0 ? null : p.closed_days.map((d) => ({ ...d })),
  };
}
