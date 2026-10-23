// S-47c (spec 5.7; C13, C16; SD11, SD17): the Voice page's two knowledge forms, card state <-> stored shape.
// Pure; client and server (the cards seed from formFromHours/formFromServices, the actions validate with
// hoursFromForm/servicesFromForm). Relative imports and `import type` only. The database refuses every shape
// these refuse (app.voice_business_hours_valid, the voice_services CHECKs); these exist so the operator reads a
// sentence naming the day or the row instead of a generic refusal.
import type { VoiceServiceInput } from "@bis/db";
import type { OpenHours } from "../../booking/slots";
import type { MessageKey } from "../../messages";
import { HOURS_DAYS_MONDAY_FIRST } from "./hours";
import { PRICE_KINDS, type PriceKind } from "./price-sentence";

export type WeekdayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type HoursFormDay = { day: WeekdayKey; open: boolean; spans: { from: string; to: string }[] };
export type HoursError = { code: "blank" | "endBeforeStart" | "overlap"; day: WeekdayKey } | { code: "noDay" };

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Seven rows, Monday first. A stored "24:00" closing shows as "00:00", the only midnight a time field can
 *  hold (SD11). Spans in start order. */
export function formFromHours(hours: OpenHours | null): HoursFormDay[] {
  return HOURS_DAYS_MONDAY_FIRST.map((day) => {
    const raw = hours?.[day];
    const spans = Array.isArray(raw) ? [...raw].sort((a, b) => minutes(a[0]) - minutes(b[0])) : [];
    return {
      day,
      open: spans.length > 0,
      spans: spans.map(([from, to]) => ({ from, to: to === "24:00" ? "00:00" : to })),
    };
  });
}

/** The card's week to the stored shape. Days are checked Monday first, so the first error the operator reads is
 *  the earliest day's. A closed day is an absent key (SD17); a closing "00:00" is "24:00" (SD11). */
export function hoursFromForm(days: readonly HoursFormDay[]): { ok: true; hours: OpenHours } | { ok: false; error: HoursError } {
  const hours: OpenHours = {};
  for (const day of HOURS_DAYS_MONDAY_FIRST) {
    const d = days.find((x) => x.day === day);
    if (!d || !d.open) continue;
    if (d.spans.length === 0) return { ok: false, error: { code: "blank", day } };
    const spans: [string, string][] = [];
    for (const s of d.spans) {
      const from = s.from.trim();
      const to = s.to.trim();
      if (!TIME.test(from) || !TIME.test(to)) return { ok: false, error: { code: "blank", day } };
      const close = to === "00:00" ? "24:00" : to;
      if (minutes(close) <= minutes(from)) return { ok: false, error: { code: "endBeforeStart", day } };
      spans.push([from, close]);
    }
    spans.sort((a, b) => minutes(a[0]) - minutes(b[0]));
    for (let i = 1; i < spans.length; i++) {
      if (minutes(spans[i]![0]) < minutes(spans[i - 1]![1])) return { ok: false, error: { code: "overlap", day } };
    }
    hours[day] = spans;
  }
  if (Object.keys(hours).length === 0) return { ok: false, error: { code: "noDay" } };
  return { ok: true, hours };
}

export function hoursErrorKey(e: HoursError): MessageKey {
  switch (e.code) {
    case "blank": return "voice.hours.error.blank";
    case "endBeforeStart": return "voice.hours.error.endBeforeStart";
    case "overlap": return "voice.hours.error.overlap";
    case "noDay": return "voice.hours.error.noDay";
  }
}

export type ServiceForm = {
  name_en: string; name_es: string; description_en: string; description_es: string;
  price_kind: PriceKind | ""; amount: string; amount_max: string; unit_en: string; unit_es: string;
};
export type ServiceError = { code: "name" | "amount" | "range" | "units" | "tooLong" | "lineBreak" | "tooMany"; name: string };

/** voice_services_amount_cents_check's upper bound. */
const MAX_CENTS = 100_000_000;
const MAX_SERVICES = 50;
const PLAIN = /^\d+(\.\d{1,2})?$/;
const GROUPED = /^\d{1,3}(,\d{3})+(\.\d{1,2})?$/;

/** Dollars as typed to whole cents: trims, drops one leading "$" and thousands commas, at most two decimals.
 *  null for anything else, for zero, and above the CHECK's bound. */
export function parseDollars(raw: string): number | null {
  let s = raw.trim();
  if (s.startsWith("$")) s = s.slice(1);
  if (!PLAIN.test(s) && !GROUPED.test(s)) return null;
  const [whole, frac = ""] = s.replace(/,/g, "").split(".");
  if (whole!.length > 9) return null;
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return cents < 1 || cents > MAX_CENTS ? null : cents;
}

/** Cents back to what the amount field shows: 2500 -> "25", 2550 -> "25.50", null -> "". */
export function dollarsOf(cents: number | null): string {
  if (cents === null) return "";
  const rest = cents % 100;
  return rest === 0 ? String(Math.floor(cents / 100)) : `${Math.floor(cents / 100)}.${String(rest).padStart(2, "0")}`;
}

export function formFromServices(rows: readonly VoiceServiceInput[]): ServiceForm[] {
  return rows.map((r) => ({
    name_en: r.name_en, name_es: r.name_es ?? "", description_en: r.description_en ?? "", description_es: r.description_es ?? "",
    price_kind: r.price_kind, amount: dollarsOf(r.amount_cents), amount_max: dollarsOf(r.amount_max_cents),
    unit_en: r.unit_en ?? "", unit_es: r.unit_es ?? "",
  }));
}

const BREAK = /[\r\n]/;
const orNull = (s: string) => (s === "" ? null : s);

function serviceFromForm(row: ServiceForm, insurance: boolean): { ok: true; service: VoiceServiceInput } | { ok: false; error: ServiceError } {
  const t = {
    name_en: row.name_en.trim(), name_es: row.name_es.trim(),
    description_en: row.description_en.trim(), description_es: row.description_es.trim(),
    unit_en: row.unit_en.trim(), unit_es: row.unit_es.trim(),
  };
  const name = t.name_en;
  const fail = (code: ServiceError["code"]) => ({ ok: false as const, error: { code, name } });
  if (name === "") return fail("name");
  if (Object.values(t).some((v) => BREAK.test(v))) return fail("lineBreak");
  if (t.name_en.length > 80 || t.name_es.length > 80 || t.description_en.length > 300 || t.description_es.length > 300
    || t.unit_en.length > 30 || t.unit_es.length > 30) return fail("tooLong");

  // C13: on insurance a row added there has no kind; it is saved as the one kind with no number.
  const kind: PriceKind | null = row.price_kind === "" && insurance ? "after_visit"
    : (PRICE_KINDS as readonly string[]).includes(row.price_kind) ? (row.price_kind as PriceKind) : null;
  const base = {
    name_en: name, name_es: orNull(t.name_es), description_en: orNull(t.description_en), description_es: orNull(t.description_es),
  };
  const none = { amount_cents: null, amount_max_cents: null, unit_en: null, unit_es: null };
  switch (kind) {
    case null: return fail("amount");
    case "free":
    case "after_visit":
      return { ok: true, service: { ...base, price_kind: kind, ...none } };
    case "fixed":
    case "from": {
      const a = parseDollars(row.amount);
      if (a === null) return fail("amount");
      return { ok: true, service: { ...base, price_kind: kind, ...none, amount_cents: a } };
    }
    case "range": {
      const lo = parseDollars(row.amount);
      const hi = parseDollars(row.amount_max);
      if (lo === null || hi === null) return fail("amount");
      if (hi <= lo) return fail("range");
      return { ok: true, service: { ...base, price_kind: kind, ...none, amount_cents: lo, amount_max_cents: hi } };
    }
    case "per_unit": {
      const a = parseDollars(row.amount);
      if (a === null) return fail("amount");
      // C16: both units, no English fallback for the Spanish one.
      if (t.unit_en === "" || t.unit_es === "") return fail("units");
      return { ok: true, service: { ...base, price_kind: kind, amount_cents: a, amount_max_cents: null, unit_en: t.unit_en, unit_es: t.unit_es } };
    }
  }
}

/** The card's list to the stored shape, in order; the first refused row is the one reported. A row that came in
 *  carrying a stored kind is validated and saved exactly as sent, on insurance too ("sent back as it was stored"). */
export function servicesFromForm(rows: readonly ServiceForm[], o: { insurance: boolean }):
  { ok: true; services: VoiceServiceInput[] } | { ok: false; error: ServiceError } {
  if (rows.length > MAX_SERVICES) return { ok: false, error: { code: "tooMany", name: "" } };
  const services: VoiceServiceInput[] = [];
  for (const row of rows) {
    const r = serviceFromForm(row, o.insurance);
    if (!r.ok) return r;
    services.push(r.service);
  }
  return { ok: true, services };
}

/**
 * C13, the save layer's half: on an insurance account the card can only send a price back as it was stored, so
 * every posted row that carries one (any kind but after_visit, the no-number kind a row added there becomes) must
 * match a stored row's price exactly (kind, both amounts, both units). Names and descriptions may differ: the card
 * shows them there, so an operator can rename a priced row. Each stored row matches at most one posted row, so a
 * price cannot be copied onto a second service. False means a hand-built POST is planting a price that would be
 * spoken once the module changes off insurance.
 */
export function insurancePricesKept(posted: readonly VoiceServiceInput[], stored: readonly VoiceServiceInput[]): boolean {
  const unused = [...stored];
  for (const p of posted) {
    if (p.price_kind === "after_visit") continue;
    const i = unused.findIndex((s) => s.price_kind === p.price_kind && s.amount_cents === p.amount_cents
      && s.amount_max_cents === p.amount_max_cents && s.unit_en === p.unit_en && s.unit_es === p.unit_es);
    if (i < 0) return false;
    unused.splice(i, 1);
  }
  return true;
}

/** A line break can only come from a hand-built POST (an input cannot hold one), so it reads the card's generic
 *  refusal; too many reads the cap. */
export function serviceErrorKey(e: ServiceError): MessageKey {
  switch (e.code) {
    case "name": return "voice.services.error.name";
    case "amount": return "voice.services.error.amount";
    case "range": return "voice.services.error.range";
    case "units": return "voice.services.error.units";
    case "tooLong": return "voice.services.error.tooLong";
    case "lineBreak": return "voice.knowledge.invalid";
    case "tooMany": return "voice.services.max";
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
function json(raw: unknown): unknown {
  if (typeof raw !== "string") return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** The posted `days` field, or null when it is not the card's shape. */
export function parseHoursFormJson(raw: unknown): HoursFormDay[] | null {
  const v = json(raw);
  if (!Array.isArray(v)) return null;
  const out: HoursFormDay[] = [];
  for (const d of v) {
    if (!isObj(d) || !(HOURS_DAYS_MONDAY_FIRST as readonly unknown[]).includes(d.day) || typeof d.open !== "boolean"
      || !Array.isArray(d.spans)) return null;
    const spans: { from: string; to: string }[] = [];
    for (const s of d.spans) {
      if (!isObj(s) || !isStr(s.from) || !isStr(s.to)) return null;
      spans.push({ from: s.from, to: s.to });
    }
    out.push({ day: d.day as WeekdayKey, open: d.open, spans });
  }
  return out;
}

const SERVICE_FIELDS = ["name_en", "name_es", "description_en", "description_es", "price_kind", "amount", "amount_max", "unit_en", "unit_es"] as const;

/** The posted `services` field, or null when it is not the card's shape. The kind is checked by servicesFromForm. */
export function parseServicesFormJson(raw: unknown): ServiceForm[] | null {
  const v = json(raw);
  if (!Array.isArray(v)) return null;
  const out: ServiceForm[] = [];
  for (const r of v) {
    if (!isObj(r) || !SERVICE_FIELDS.every((k) => isStr(r[k]))) return null;
    out.push({
      name_en: r.name_en as string, name_es: r.name_es as string, description_en: r.description_en as string,
      description_es: r.description_es as string, price_kind: r.price_kind as ServiceForm["price_kind"],
      amount: r.amount as string, amount_max: r.amount_max as string, unit_en: r.unit_en as string, unit_es: r.unit_es as string,
    });
  }
  return out;
}
