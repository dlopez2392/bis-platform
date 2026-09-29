import { m } from "@/lib/messages";

/**
 * The consent replies (spec §4.2's table): the ONE stop confirmation, the
 * start confirmation and the help reply, BIS's own words. BIS sends one only
 * when Telnyx did not already answer the keyword itself (plan G4); when Telnyx
 * did, the customer's reply IS the profile's configured text, which
 * `telnyxReplyText` gives for Task 16's step 0.
 */
export type ReplyKind = "consent.stop_confirmation" | "consent.start_confirmation" | "consent.help";

const LINES = {
  "consent.stop_confirmation": { en: ["sms.consentReply.stop.en", "sms.consentReply.stop.noName.en"], es: ["sms.consentReply.stop.es", "sms.consentReply.stop.noName.es"] },
  "consent.start_confirmation": { en: ["sms.consentReply.start.en", "sms.consentReply.start.noName.en"], es: ["sms.consentReply.start.es", "sms.consentReply.start.noName.es"] },
  "consent.help": { en: ["sms.consentReply.help.en", "sms.consentReply.help.noName.en"], es: ["sms.consentReply.help.es", "sms.consentReply.help.noName.es"] },
} as const satisfies Record<ReplyKind, Record<"en" | "es", readonly [keyof typeof m, keyof typeof m]>>;

/** The reply in the language asked, signed with the customer-facing name; a blank name drops the prefix. */
export function consentReplyBody(kind: ReplyKind, language: "en" | "es", brandName: string): string {
  const [named, nameless] = LINES[kind][language];
  const name = brandName.trim();
  return name ? m[named].replace("{Business}", () => name) : m[nameless];
}

/**
 * The keywords each business's Telnyx profile lists: one bilingual config per
 * operation for each sender country, US, MX and CA (Task 16; plan F2, F3;
 * danlo 2026-09-28 — a Canadian +1 sender gets the named reply too). Every
 * stop word of decision 10 is in the stop config, so each one gets the
 * business-named reply below; START, UNSTOP and HELP are Telnyx's own
 * defaults, listed so their replies are ours.
 */
export const TELNYX_KEYWORDS = {
  stop: [
    "STOP", "STOPALL", "STOP ALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "REVOKE", "OPT OUT", "OPTOUT",
    "PARAR", "DETENER", "ALTO", "CANCELAR", "BAJA", "NO MAS", "NO MÁS",
  ],
  start: ["START", "UNSTOP"],
  help: ["HELP", "AYUDA"],
} as const satisfies Record<"stop" | "start" | "help", readonly string[]>;

/** One bilingual reply per operation: the English line, then the Spanish line without its prefix (spec §5 step 0). */
export function telnyxReplyText(op: "stop" | "start" | "help", brandName: string): string {
  const kind: ReplyKind = op === "stop" ? "consent.stop_confirmation" : op === "start" ? "consent.start_confirmation" : "consent.help";
  return `${consentReplyBody(kind, "en", brandName)} ${consentReplyBody(kind, "es", "")}`;
}
