// S-47c (spec 5.2, 5.2.1, 5.4; plan SD5-SD8): the prompt lines structured knowledge adds. Model input, not
// catalogue copy (spec 6): every string here is pinned word for word by system-prompt.test.ts and
// prompt-blocks.test.ts. Pure; relative imports only (scripts/sofia-corpus.ts loads system-prompt.ts under tsx).
import type { OpenHours } from "../../booking/slots";
import { hoursLines, openNow, type OpenNowClosures } from "./hours";
import type { RenderedService } from "./payload";

export const BUSINESS_HOURS_HEADING =
  "BUSINESS HOURS (the regular weekly hours; where hours written above differ, these are right, except a closure written above for a specific date):";
export const SERVICES_AND_PRICES_HEADING =
  "SERVICES AND PRICES (the only prices you may give; for a price, say that service's sentence exactly as it is written here, in the language you are speaking):";
/** Insurance accounts (C13, SD8): names and descriptions only; no sentence, no amount, no promise of prices. */
export const SERVICES_NAMES_ONLY_HEADING = "SERVICES (what the business offers):";

/** Replaces the HARD LIMITS price line only when a list is given on a non-insurance account (spec 5.2). Its last
 *  sentence is what keeps the events module's "word for word from the facts above" pointed at the list (C12). */
export const LIST_PRICE_LINE =
  "- Give a price only by saying, word for word, that service's sentence from SERVICES AND PRICES above. Any other amount written above, in the facts or the services, is not a price you may give. Never multiply, add up, estimate or round a price, never work out a total, and never quote a service that is not on the list: say the business will confirm pricing and offer to take their details. Wherever a rule below speaks of prices \"in the facts\", it means this list.";

/** Owner decision C20 (2026-10-23): replaces the HARD LIMITS price line when the price-list READ FAILED on a non-insurance
 *  account, so no amount left in the prose can be quoted while the list is unknown. An EMPTY list keeps today's line.
 *  Its last sentence settles the events module, which (unchanged, C12) allows prices "only by repeating what the facts
 *  above say" (modules/events.ts:94): two rules that disagree lose to the more concrete one (system-prompt.ts's "decline path is MEETING-TYPE-CONDITIONAL" note),
 *  so this line says outright that it wins (plan re-review, 2026-10-23). */
export const CLOSED_PRICE_LINE =
  "- Do not give, confirm or estimate any price, rate or amount right now, not even one written above. If asked, say the business will confirm pricing and offer to take their details. This overrides any rule below that allows a price from the facts.";

export const AFTER_HOURS_CLOSED_WEB =
  "AFTER HOURS — The business is closed right now (see Right now above); say so briefly, and use capture_lead to get their name and a way to reach them so the team can follow up.";
export const AFTER_HOURS_CLOSED_WEB_VOICE =
  "AFTER HOURS — The business is closed right now (see Right now above); say so briefly and take a message; do not attempt anything else.";

/** S-47d (spec 5.4.2; SD16): the same two lines when a closure holds and there is no hours block to point at. */
export const AFTER_HOURS_CLOSED_WEB_TODAY =
  "AFTER HOURS — The business is closed right now (see TODAY above); say so briefly, and use capture_lead to get their name and a way to reach them so the team can follow up.";
export const AFTER_HOURS_CLOSED_WEB_VOICE_TODAY =
  "AFTER HOURS — The business is closed right now (see TODAY above); say so briefly and take a message; do not attempt anything else.";

/** Phone, "Follow business hours, then take a message", closed now (spec 5.2; SD5). `see` (S-47d, spec 5.4.2) names
 *  the line it points at: "TODAY" when a closure holds with no hours block; absent is "Right now", byte for byte. */
export function afterHoursClosedPhoneLine(o: { canBook: boolean; handoffAvailable: boolean; hasTradeRules: boolean; see?: "Right now" | "TODAY" }): string {
  const book = o.canBook ? ", and book a time that check_availability returns" : "";
  const person = !o.handoffAvailable ? ""
    : o.hasTradeRules ? " If they ask for a person, or it is urgent, you can still put them through."
      : " If they ask for a person, you can still put them through.";
  return `AFTER HOURS — The business is closed right now (see ${o.see ?? "Right now"} above). If it matters to what they need, say so and say when it opens. You can still answer questions from what you know above${book}. For anything that needs someone on the team, take a message and say the team will call them back once it opens.${person}`;
}

/** The TOOLS line for transfer_to_human when the phone is closed now and a transfer number exists (spec 5.2.1 point 2). */
export function transferToolLineClosed(hasTradeRules: boolean): string {
  return `- transfer_to_human() — the business is closed right now, so do not offer this. Call it only when the caller asks to speak to a person${hasTradeRules ? ", or when they accept the offer on the URGENT path in the trade rules above" : ""}. Do not ask them to hold first; that line is spoken for you the moment the transfer starts. If the tool comes back with an error, apologize and take a message instead.`;
}

/** ["", heading, seven day lines, the Right now line], and whether it is open now. `closures` (S-47d) reaches
 *  openNow unchanged; absent, the block is S-47c's. */
export function businessHoursBlock(hours: OpenHours, timeZone: string, now: Date, closures?: OpenNowClosures): { lines: string[]; open: boolean } {
  const state = openNow(hours, timeZone, now, closures);
  return { lines: ["", BUSINESS_HOURS_HEADING, ...hoursLines(hours), state.line], open: state.open };
}

/** [] for an empty list; else ["", heading, item lines]. `namesOnly` on insurance accounts (C13). SD7: each
 *  description that exists gets its own line. */
export function servicesBlock(list: readonly RenderedService[], namesOnly: boolean): string[] {
  if (list.length === 0) return [];
  return ["", namesOnly ? SERVICES_NAMES_ONLY_HEADING : SERVICES_AND_PRICES_HEADING, ...list.flatMap((s) => [
    namesOnly
      ? `- ${s.name_en}${s.name_es ? ` (in Spanish: ${s.name_es})` : ""}`
      : `- ${s.name_en} — English: "${s.sentence_en}" Spanish: "${s.sentence_es}"`,
    ...(s.description_en ? [`  About it, in English: ${s.description_en}`] : []),
    ...(s.description_es ? [`  About it, in Spanish: ${s.description_es}`] : []),
  ])];
}
