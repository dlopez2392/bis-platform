// F-140 slice 1, "Hear your receptionist before you buy": on a sales visit the agency types a prospect's
// business into /dashboard/demo and hands over the device; the prospect talks to Sofía answering as THEIR
// business, in the browser. This file is the one place that typed form becomes a session.
//
// There is no second prompt. The typed profile is turned into the same inputs the phone line and the website
// demo read from the database — a knowledge payload (`buildKnowledgePayload`, so prices are said by the same
// sentences), a `VoicePromptInput`, `buildRealtimeSessionConfig`, and the phone's own `openingGreeting` —
// and the differences are expressed here, as `web-demo.ts` expresses the website's:
//
//   - No tools. Nothing the prospect says reaches a calendar, a contact or a message: there is no account.
//   - Disclosed, always: the greeting carries the AI sentence a disclosing call says, and the prompt gets the
//     disclosed IDENTITY line. The prospect is about to buy an AI receptionist; it says what it is.
//   - "This is a demo" is SPOKEN only where the real line would act (book, take a message), because that is
//     the one moment the preview behaves differently from the real line. The greeting is the business's own,
//     so the prospect hears their name, not ours.
//   - Advisory length (WEB_DEMO_MAX_SECONDS), for web-demo.ts's reason: the browser talks to OpenAI directly.
//
// Slice 2's seam: `ProspectDemoProfile` is the validated, typed business. Converting a demo into a real
// account starts from it (business name, trade, hours as OpenHours, services as price rows, languages).
//
// Pure: no database, no network, no React.
import type { TradeModuleSetting } from "@bis/db";
import type { OpenHours } from "../booking/slots";
import { buildRealtimeSessionConfig, type VoicePromptInput } from "./session-config";
import { openingGreeting } from "./greeting";
import { buildKnowledgePayload, promptKnowledge, type ServiceInput } from "./knowledge/payload";
import { WEB_DEMO_MAX_SECONDS, webDemoMinutes } from "./web-demo";
import { dayKey } from "../business-status/status";
import { checkTradeChoice, sofiaGate, tradeEntry } from "../vetting/trades";
import { sofiaGateText, tradeChoiceRefusal } from "../vetting/copy";
import { m } from "../messages";

/** The form's service rows. Six covers what a prospect rattles off in a minute. */
export const PROSPECT_DEMO_MAX_SERVICES = 6;
/** The persona every new profile starts with (voice_profiles' default). */
export const PROSPECT_DEMO_PERSONA = "Sofía";
/** The Valley's zone, which every BIS account so far is in. The "Right now" line is computed in it. */
export const PROSPECT_DEMO_TIMEZONE = "America/Chicago";

/**
 * The cap, counted from agency-only `events` rows (@bis/db's recordProspectDemo / countProspectDemosSince)
 * before a secret is minted: no new table, and nothing about the prospect is stored (the row's payload is
 * empty). Per agency person, rolling 24 hours. Twenty is several sales visits' worth; past it, something is
 * wrong. Not env-tunable, for web-demo.ts's reason.
 */
export const PROSPECT_DEMO_MAX_PER_USER_PER_DAY = 20;
export const PROSPECT_DEMO_WINDOW_MS = 86_400_000;

export type DemoHoursRow = { open: boolean; from: string; to: string };
export type ProspectDemoForm = {
  businessName: string; trade: string; tradeOther: string;
  languages: "en" | "es" | "both";
  hours: { weekdays: DemoHoursRow; saturday: DemoHoursRow; sunday: DemoHoursRow };
  services: { name: string; price: string; minutes: string }[];
};

export type ProspectDemoService = { name: string; priceCents: number | null; minutes: number | null };
export type ProspectDemoProfile = {
  businessName: string; trade: string; tradeOther: string | null; tradeLabel: string;
  languages: "en" | "es" | "both"; businessHours: OpenHours; services: ProspectDemoService[];
};

export type ProspectDemoParse = { ok: true; profile: ProspectDemoProfile } | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const oneLine = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
const hasControl = (s: string) => [...s].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127);
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const PRICE = /^\$?(\d{1,6})(?:\.(\d{1,2}))?$/;
const fail = (error: string): ProspectDemoParse => ({ ok: false, error });

/** The hours rows into OpenHours, or the reason they cannot be. Weekdays fill Monday to Friday. */
function parseHours(raw: unknown): OpenHours | string {
  if (!isObj(raw)) return m["prospectDemo.error.hours"];
  const out: OpenHours = {};
  const rows: [string, readonly ("mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun")[]][] = [
    ["weekdays", ["mon", "tue", "wed", "thu", "fri"]], ["saturday", ["sat"]], ["sunday", ["sun"]],
  ];
  for (const [key, days] of rows) {
    const row = raw[key];
    if (!isObj(row) || typeof row.open !== "boolean") return m["prospectDemo.error.hours"];
    if (!row.open) continue;
    const from = typeof row.from === "string" ? row.from : "";
    const to = typeof row.to === "string" ? row.to : "";
    if (!TIME.test(from) || !TIME.test(to) || to <= from) return m["prospectDemo.error.hours"];
    for (const d of days) out[d] = [[from, to]];
  }
  if (Object.keys(out).length === 0) return m["prospectDemo.error.noOpenDay"];
  return out;
}

function parseServices(raw: unknown): ProspectDemoService[] | string {
  if (!Array.isArray(raw) || raw.length > PROSPECT_DEMO_MAX_SERVICES) return m["prospectDemo.error.services"];
  const out: ProspectDemoService[] = [];
  for (const row of raw) {
    if (!isObj(row)) return m["prospectDemo.error.services"];
    const name = oneLine(row.name);
    // A row left blank is a row the agency did not use, not a mistake.
    if (name === "") continue;
    if (name.length > 60 || hasControl(name)) return m["prospectDemo.error.services"];
    const price = oneLine(row.price).replace(/,/g, "");
    let priceCents: number | null = null;
    if (price !== "") {
      const p = PRICE.exec(price);
      if (!p) return m["prospectDemo.error.price"];
      priceCents = Number(p[1]) * 100 + Number((p[2] ?? "").padEnd(2, "0"));
      if (priceCents <= 0) return m["prospectDemo.error.price"];
    }
    const mins = oneLine(row.minutes);
    let minutes: number | null = null;
    if (mins !== "") {
      if (!/^\d{1,3}$/.test(mins) || Number(mins) < 5 || Number(mins) > 600) return m["prospectDemo.error.minutes"];
      minutes = Number(mins);
    }
    out.push({ name, priceCents, minutes });
  }
  return out;
}

/**
 * The form, off the wire. A server action's argument is whatever the browser sent, so nothing is trusted.
 * The trade goes through the SAME two checks as creating a company and switching Sofía on: a held or
 * turned-away trade is refused with its own reason, and a CRM-only trade with the sentence the Voice page
 * shows, because a demo of a product the business cannot buy would be a promise BIS cannot keep.
 */
export function parseProspectDemo(raw: unknown): ProspectDemoParse {
  if (!isObj(raw)) return fail(m["prospectDemo.error.form"]);
  const businessName = oneLine(raw.businessName);
  if (businessName === "" || businessName.length > 80 || hasControl(businessName)) {
    return fail(m["prospectDemo.error.businessName"]);
  }
  const check = checkTradeChoice(raw.trade, raw.tradeOther);
  if (!check.ok) return fail(tradeChoiceRefusal(check, "en"));
  const gate = sofiaGate(check.choice.trade);
  if (!gate.ok) return fail(sofiaGateText(gate, "en"));
  const languages = raw.languages;
  if (languages !== "en" && languages !== "es" && languages !== "both") return fail(m["prospectDemo.error.form"]);
  const businessHours = parseHours(raw.hours);
  if (typeof businessHours === "string") return fail(businessHours);
  const services = parseServices(raw.services);
  if (typeof services === "string") return fail(services);
  const tradeLabel = check.choice.tradeOther ?? tradeEntry(check.choice.trade)!.label.en;
  return {
    ok: true,
    profile: {
      businessName, trade: check.choice.trade, tradeOther: check.choice.tradeOther, tradeLabel,
      languages, businessHours, services,
    },
  };
}

/** The trades whose rules exist as a module (lib/voice/modules), so the demo answers as that trade's real line. */
const TRADE_MODULE: Partial<Record<string, TradeModuleSetting>> = { insurance: "insurance_pc", events: "events" };

/**
 * Appended to her instructions, never a replacement — `webDemoNotice`'s shape, for a different room: the
 * person on the other end is the business's owner trying her out, not a stranger on the business's website,
 * so she is told where to stop (booking, messages) and nothing else changes.
 */
export function prospectDemoNotice(maxSeconds: number = WEB_DEMO_MAX_SECONDS): string {
  const minutes = webDemoMinutes(maxSeconds);
  return [
    "",
    "## This conversation is a preview in a web browser, not the phone line",
    "",
    "The person talking to you is trying out how you will answer this business's phone. They may be the owner, or they may play a customer. Answer exactly as you would on the real line.",
    `Keep this to about ${minutes} minutes. If you are still talking near the end, wrap up warmly rather than starting something new.`,
    "",
    "You CANNOT book, reschedule or cancel anything in this conversation, and you cannot take a message that reaches anyone. Do not say you have booked, noted, saved or passed anything along — that would be a lie. When they ask you to book, or to take a message, say in one short sentence that this is a preview so nothing is booked or saved, and that on the real line you would take care of it right then. Then carry on as you would on a call. Do not otherwise mention that this is a preview.",
  ].join("\n");
}

/** The session to mint and the opening line the browser asks for once the audio is up. */
export function buildProspectDemoSession(p: ProspectDemoProfile, now: Date) {
  const services: ServiceInput[] = p.services.filter((s) => s.priceCents !== null).map((s) => ({
    name_en: s.name, name_es: null, price_kind: "fixed", amount_cents: s.priceCents, amount_max_cents: null,
    unit_en: null, unit_es: null,
    description_en: s.minutes ? `Usually takes about ${s.minutes} minutes.` : null,
    description_es: s.minutes ? `Normalmente toma unos ${s.minutes} minutos.` : null,
  }));
  // Every service by name; a duration rides here only for a service with no price (a priced one carries it
  // in the price list's own description line).
  const servicesText = p.services
    .map((s) => (s.minutes && s.priceCents === null ? `${s.name} (usually about ${s.minutes} minutes)` : s.name))
    .join(", ");
  const payload = buildKnowledgePayload({
    facts: `What ${p.businessName} does: ${p.tradeLabel}.`,
    servicesText, timezone: PROSPECT_DEMO_TIMEZONE, businessHours: p.businessHours, services,
    closedDays: [], today: dayKey(now, PROSPECT_DEMO_TIMEZONE),
  });
  const pk = promptKnowledge(payload);
  const input: VoicePromptInput = {
    personaName: PROSPECT_DEMO_PERSONA, businessName: p.businessName,
    facts: pk.facts, services: pk.services, languages: p.languages,
    // No tools reach this session, so a prompt that promised booking would promise what cannot happen.
    bookingEnabled: false,
    timezone: PROSPECT_DEMO_TIMEZONE, slotDurationMinutes: 30,
    afterHours: "hours_then_message", callerNumber: null, meetingType: "in_person",
    medium: "web_voice", disclosed: true,
    tradeModule: TRADE_MODULE[p.trade] ?? null,
    businessHours: pk.businessHours, priceList: pk.priceList, priceListUnavailable: false,
    businessStatus: null, closedDays: pk.closedDays,
  };
  const base = buildRealtimeSessionConfig(input, now);
  // Blank greetings: each falls back to its own language's line naming the business, as a new profile's does.
  const greeting = openingGreeting(
    { languages: p.languages, greeting_en: "", greeting_es: "" }, p.businessName,
    { disclose: true, personaName: PROSPECT_DEMO_PERSONA },
  ).instruction;
  // `tools: []` by construction, as the website demo does: no tool reaches a session with no account behind it.
  return { session: { ...base, tools: [], instructions: base.instructions + prospectDemoNotice() }, greeting };
}
