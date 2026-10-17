import type { SmsGate } from "@/lib/sms/sender";
import type { SmsRecipientState, EmailRecipientState } from "@/lib/consent/composer-state";
import { canTextFrom } from "@/lib/record/header-actions";

/**
 * S-06 part 3, spec §6: the channel the inbox composer opens on. PURE, called only on the server
 * (page.tsx, through composer-facts.ts) and handed to the client as data. Never "webchat": nothing
 * sends a web chat row (decision 5).
 */
export type LastReply = "sms" | "email" | "other" | null;
export type Readiness = "ready" | "stopped" | "unavailable";
/** The thread's own rows (listMessages, oldest first), only the fields this reads. */
export type ThreadRow = { direction: string; channel: string; author_kind?: string | null };

/** The newest row that is the customer reaching the business (G11). */
export function lastCustomerReply(messages: readonly ThreadRow[]): LastReply {
  for (let i = messages.length - 1; i >= 0; i--) {
    const x = messages[i]!;
    if (x.direction !== "inbound") continue;
    if (x.channel === "sms" || x.channel === "email") {
      // A teammate's forward (author 'person', S-06 part 2) is not the customer.
      if (x.author_kind === "customer") return x.channel;
      continue;
    }
    // A call's inbox copy is the receptionist's (author 'ai') and still counts: decision 2 names a call.
    if (x.channel === "webchat" || x.channel === "form" || x.channel === "voice") return "other";
  }
  return null;
}

/** Text: ready exactly when the composer's text form would open (canTextFrom, the record header's
 *  predicate); stopped when they stopped texts; otherwise unavailable. */
export function textReadiness(i: { phone: string | null; smsGate: SmsGate | null; smsBlockedLine: string | null; recipient: SmsRecipientState }): Readiness {
  if (canTextFrom({ phone: i.phone, smsGate: i.smsGate, smsBlockedLine: i.smsBlockedLine })) return "ready";
  return i.recipient.kind === "stopped" ? "stopped" : "unavailable";
}

/** Email: stopped for any stop (an unsubscribe, a staff stop, a bounce, a complaint); ready with an
 *  address and nothing stopped; otherwise unavailable (no address, or a read that failed). */
export function emailReadiness(i: { email: string | null; recipient: EmailRecipientState }): Readiness {
  if (i.recipient.kind === "stopped") return "stopped";
  return i.email && i.email.trim() && i.recipient.kind === "ok" ? "ready" : "unavailable";
}

/** §6 steps 1-3 (G10). */
export function startChannel(i: { lastReply: LastReply; text: Readiness; email: Readiness }): "sms" | "email" {
  const preferred: "sms" | "email" = i.lastReply === "sms" ? "sms" : i.lastReply === "email" ? "email" : i.text === "ready" ? "sms" : "email";
  const other: "sms" | "email" = preferred === "sms" ? "email" : "sms";
  const r = (c: "sms" | "email") => (c === "sms" ? i.text : i.email);
  if (r(preferred) === "ready") return preferred;
  if (r(other) === "ready") return other;
  // Neither ready: never the channel they stopped, when the other is not stopped too.
  if (r(preferred) === "stopped" && r(other) !== "stopped") return other;
  return preferred;
}
