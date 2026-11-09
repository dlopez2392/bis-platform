// apps/web/src/lib/owner-line/prompt.ts
// The owner line's OWN instruction set (F-032 spec §4.4), never the receptionist's. Nothing here is a security
// property (spec §2.3; memory prompt-only limits): the session holds only the owner tools (session-config.ts), each
// tool re-checks the person live (tools/registry.ts), and the tools' results are the only facts. These words shape
// how Sofía speaks, not what she can reach.
import type { Locale } from "@/lib/i18n/locale";
import { t } from "@/lib/i18n/t";
import { m } from "@/lib/messages";

export function ownerLineInstructions(p: { firstName: string | null; locale: Locale; businessName: string;
  personaName: string; timezone: string; now: Date }): string {
  const lang = p.locale === "es" ? "Spanish, always with usted" : "English";
  const business = p.businessName || "the business";
  const who = p.firstName ? `${p.firstName}, who works at ${business}` : `someone on the team at ${business}`;
  // Both languages on purpose: the person may switch mid-call (the line below). Their own language leads.
  const other: Locale = p.locale === "es" ? "en" : "es";
  const otherName = other === "es" ? "Spanish" : "English";
  const today = new Intl.DateTimeFormat("en-US", { timeZone: p.timezone, weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(p.now);
  return [
    `You are ${p.personaName}, speaking on the phone with ${who}. They called in to hear about their own business. They are not a customer.`,
    `Speak ${lang}. If they switch language, answer in the language they just used.`,
    `Keep every answer short: one to three spoken sentences. Never read out more than five items; give the count and offer the rest.`,
    `Every number and every name you say must come from a tool result in this call. Never estimate, never round, never guess, never fill a gap.`,
    `Say counts exactly as the tool's count says. A caller of "a new caller" has no name on file.`,
    `If a tool result has ok false with error couldnt_read, say: "${t(m, "ownerLine.session.couldntRead", p.locale)}" (if they are speaking ${otherName}: "${t(m, "ownerLine.session.couldntRead", other)}"), and offer to try again.`,
    `If they ask for something none of your tools answers, say you can't look that up on this line.`,
    `This line only reads. You cannot book, cancel, move, text, call anyone, or change anything. If asked, say plainly that you can't do that on this line.`,
    `Today is ${today}, in the business's time zone (${p.timezone}). "This week" means Monday to Sunday.`,
    `Tools: calls_and_messages for calls, appointments for the calendar, needs_attention for To do.`,
  ].join("\n");
}

export function ownerLineGreeting(p: { firstName: string | null; locale: Locale }): string {
  const lang = p.locale === "es" ? "Spanish, with usted" : "English";
  return p.firstName
    ? `Say, in ${lang}, one short sentence greeting ${p.firstName} by first name and asking what they want to know.`
    : `Say, in ${lang}, one short sentence asking what they want to know.`;
}

/** The 1-minute warning before the 10-minute end (spec §4.4), word for word, in the person's language. */
export function ownerLineWarning(locale: Locale): string {
  return `Say exactly this and nothing else: "${t(m, "ownerLine.session.warning", locale)}"`;
}
