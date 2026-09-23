import { m } from "@/lib/messages";

/**
 * Appends the opt-out disclosure to a PROGRAM message.
 *
 * CTIA's messaging principles require every recurring message programme to
 * tell the recipient how to stop it, and A2P 10DLC campaign vetting reads the
 * sample messages for that language — a sample that does not match real
 * traffic is itself a rejection reason, and the vetting fee is charged per
 * submission. Neither of those is the real reason it is here, which is that a
 * text from a number you do not recognise, with no way out of it, is the
 * behaviour this product exists not to have.
 *
 * WHAT THIS IS NOT: the opt-out MECHANISM. Telnyx detects STOP (and STOPALL,
 * UNSUBSCRIBE, CANCEL, END, QUIT) on the way in, adds the number to its own
 * opt-out list, auto-replies, and blocks every later send to it — at the
 * messaging-profile level, before this platform sees anything. Implementing a
 * second opt-out list here would be a race against that one, so we owe the
 * carriers the LANGUAGE and nothing else. Do not "finish the job" by adding
 * keyword handling to the inbound webhook.
 *
 * WHERE IT IS APPLIED — the two places a message goes out unprompted:
 * `sendAutomationSms` (reminders, review requests, no-show nudges, the form
 * instant reply) and the missed-call text-back. Deliberately NOT applied to
 * an operator's own typed reply in Conversations — that is a human in a
 * thread the customer opened, and CTIA asks for the disclosure on programme
 * messages, not on every line of a conversation — nor to the lead alert or
 * the alert-phone verification code, which go to the BUSINESS OWNER about
 * their own account and are not a marketing programme they can leave.
 *
 * Applied where the body is BUILT, not at the provider call, so the message
 * row written to the conversation is the text that was actually sent. An
 * operator reading the thread must not see a shorter message than the
 * customer got.
 *
 * SEGMENTS. This costs 23 characters in English and 29 in Spanish, and this
 * codebase counts septets for good reason (segments.ts). The text-back is the
 * long one and it still fits: `defaultTextbackBody("956 Woodworks", "en")` is
 * 83 characters, 106 with this, well inside GSM-7's 160. A message carrying a
 * URL can be pushed into a second segment by it — accepted, and visible,
 * because the settings counter renders the real `segmentsFor()` count.
 *
 * The Spanish string carries no á/í/ó/ú for the same reason the rest of the
 * Spanish copy does not: those four sit outside GSM7_BASE and a single one
 * drops the WHOLE message to UCS-2 at 70 characters a segment. "para
 * cancelar" says it without them; "para no recibir más mensajes" would not.
 *
 * The KEYWORD stays the English "STOP" in both languages, which is not an
 * oversight: STOP is what Telnyx recognises by default. PARAR and DETENER
 * work only once they are registered as custom keywords on the messaging
 * profile, and telling a Spanish-speaking customer to reply with a word that
 * does nothing is worse than telling them one that works.
 */
export function withOptOut(body: string, language: "en" | "es" = "en"): string {
  const trimmed = body.trim();
  // Idempotent, and the guard is load-bearing rather than defensive: an
  // operator's own `textback_body` may already carry the disclosure (the
  // settings copy tells them it will be added if they leave it out), and a
  // message reading "...Reply STOP to opt out. Reply STOP to opt out." is
  // the kind of thing that gets a campaign looked at twice. Matched on an
  // INSTRUCTION (hasOptOutInstruction), not our exact sentence, so a
  // hand-written "Text STOP to unsubscribe" keeps its own wording — and not
  // on the bare word, because "We'll stop by Tuesday." is not a way out and
  // must still get one.
  if (hasOptOutInstruction(trimmed)) return trimmed;
  const disclosure = language === "es" ? m["sms.optOut.es"] : m["sms.optOut.en"];
  return `${trimmed} ${disclosure}`;
}

/**
 * Does this body already TELL the recipient how to opt out? Three parts, all
 * required, any case:
 *
 * 1. An instruction VERB, as a whole word: English reply/text/txt/send,
 *    Spanish responde/responda/envia (envía)/escribe and the formal
 *    envie (envíe)/escriba — the text-back's own Spanish default is usted-form.
 *    "resend STOP" and "pretext stop" are not instructions.
 * 2. Spaces or tabs, then STOP, optionally quoted (`Reply "STOP"`, and the
 *    curly quotes a phone types on its own). NOT a newline: "Just reply\nStop
 *    by the shop anytime!" is two sentences, the second of which is an
 *    invitation to visit.
 * 3. A TERMINATOR, so STOP is the keyword and not the first word of something
 *    else: end of text, one of . , ! ; : ), or a space and then to / para /
 *    or / o / anytime / at any time / en cualquier momento as a whole word.
 *    "send stop-work orders", "text Stop & Shop coupons", "text stop sign
 *    photos", "Text stopwatch" and "Reply STOPALL" all fail here.
 *
 * The word "stop" on its own is never enough — "We'll stop by Tuesday." and
 * "STOP by the shop" are ordinary sentences, and treating them as the
 * disclosure sent a programme message with no way out of it.
 *
 * The failure modes are deliberately lopsided: a phrasing this misses gets
 * our sentence appended after theirs (a doubled disclosure, cosmetic), while
 * a phrasing it wrongly accepts ships a text the customer cannot leave. So
 * every part is short and literal, and anything outside it is a miss.
 *
 * KNOWN GAP, accepted: a NEGATED instruction still counts. "No need to reply
 * STOP." matches parts 1–3 and suppresses the disclosure. Reading negation is
 * a grammar problem this regex should not pretend to solve, the phrasing is
 * rare in a message an operator writes to their own customers, and Telnyx
 * honours STOP whether or not the text told them to send it.
 *
 * Exported so a caller that needs the same decision asks this, never a regex
 * of its own; the settings cards' counters need nothing extra, because they
 * count `withOptOut(...)` and inherit it.
 */
export function hasOptOutInstruction(body: string): boolean {
  return /\b(?:reply|text|txt|send|responde|responda|env[ií]a|env[ií]e|escribe|escriba)[ \t]+["'“‘]?stop["'”’]?(?:$|[.,!;:)]|[ \t]+(?:to|para|or|o|anytime|at any time|en cualquier momento)\b)/i.test(body);
}
