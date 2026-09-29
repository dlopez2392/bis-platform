import {
  appendConsentEventGuarded, ensureConsentTask, getContact, nextBookedStart, readAccountTimezone,
  completeTasksForConsentEvents, readConsentHistory,
  type ConsentAppend, type SupabaseClient,
} from "@bis/db";
import { m } from "@/lib/messages";
import { formatDateInZone } from "@/lib/format";
import { loggableError } from "@/lib/loggable-error";
import { hoursZone } from "./hours";
import { matchKeyword, keywordDisplay, CANCEL_WORDS, type KeywordMatch } from "./keywords";
import { matchPhrase, type PhraseMatch } from "./phrases";
import type { ReplyKind } from "./replies";

/**
 * The inbound consent step (consent chain spec §4.2, plan Tasks 8–9): what a
 * customer's text means for their texts, written to the ledger, and whether
 * BIS owes them its own reply.
 *
 * THE TELNYX SPLIT (plan G4, F1, F4). Telnyx answers the keywords it knows
 * itself and marks the webhook `autoresponse_type`; its STOP block also
 * refuses BIS's own send. So when `autoresponse_type` carries ANY value, the
 * customer's confirmation IS Telnyx's configured reply, and BIS sends
 * nothing; the spelling of the value is not trusted (review R2-I2: INFO is
 * the OpenAPI's help, and the facts file's caveat that a custom word may be
 * reported as itself). BIS replies only when it is absent. Only the value
 * STOP is read as the carrier's block when BIS's list does not match; a
 * START, HELP or unknown value BIS does not match is logged and not recorded
 * — unless the text is a stop SENTENCE, which is held all the same (review
 * R2-m-b: the hold is the safe direction).
 *
 * RETRIES (plan G1). Every write is sourced to the message id, so a retried
 * webhook appends nothing new (0055) and finds the To-do it already made; a
 * reply is owed only by the attempt that APPENDED the row it answers (stop,
 * start) or that FILED the message (help), and it is owed the moment the
 * append answers, before any To-do, so a To-do failure (503) cannot lose it
 * (review R2-I1a).
 */
export type Autoresponse = "STOP" | "START" | "HELP" | "OTHER";

/** Any non-blank `autoresponse_type` means Telnyx replied. INFO is the OpenAPI's name for help (plan F11). */
export function parseAutoresponse(v: unknown): Autoresponse | null {
  if (typeof v !== "string" || v.trim() === "") return null;
  const up = v.trim().toUpperCase();
  if (up === "INFO") return "HELP";
  return up === "STOP" || up === "START" || up === "HELP" ? up : "OTHER";
}

export type InboundClass =
  | { kind: "stop"; keyword: KeywordMatch | null }
  | { kind: "start"; keyword: KeywordMatch }
  | { kind: "help"; keyword: KeywordMatch }
  | { kind: "telnyx_only"; autoresponse: "START" | "HELP" | "OTHER" }
  | { kind: "phrase"; phrase: PhraseMatch }
  | { kind: "none" };

/** Pure. A stop wins over everything, Telnyx's included; then START, HELP; then a stop sentence, even when Telnyx answered something else (review R2-m-b); telnyx_only or none last. */
export function classifyInbound(text: string, autoresponse: Autoresponse | null): InboundClass {
  const keyword = matchKeyword(text);
  if (autoresponse === "STOP" || keyword?.kind === "stop") {
    return { kind: "stop", keyword: keyword?.kind === "stop" ? keyword : null };
  }
  if (keyword?.kind === "start") return { kind: "start", keyword };
  if (keyword?.kind === "help") return { kind: "help", keyword };
  // A stop SENTENCE is held even when Telnyx answered something else: the
  // hold is the safe direction (review R2-m-b).
  const phrase = matchPhrase(text);
  if (phrase) return { kind: "phrase", phrase };
  return autoresponse !== null ? { kind: "telnyx_only", autoresponse } : { kind: "none" };
}

/**
 * A stop or a START that lands on a HELD address decides the hold: the
 * To-dos of EVERY hold on that number are closed (review R3-N3: after Not a
 * stop and its Undo, the reopened To-do links the older hold, not the one
 * this row replaced), so none sits open with two buttons that can only say
 * "already decided" (review R3-I1). Cleanup, so contained: the ledger row is
 * what matters, and the To-do's own buttons close a stale row on a click.
 */
async function closeHoldTodo(db: SupabaseClient, i: InboundConsentInput, r: ConsentAppend): Promise<void> {
  if (r.outcome !== "appended" || r.prior?.action !== "held") return;
  try {
    const holds = (await readConsentHistory(db, i.accountId, "sms", i.address)).filter((row) => row.action === "held").map((row) => row.id);
    await completeTasksForConsentEvents(db, i.accountId, holds, ACTOR, "system");
  } catch (e) {
    console.error(`inbound consent: the hold To-do for account ${i.accountId} was not closed: ${loggableError(e)}`);
  }
}

/** The texts whose handling must not be lost: a failure answers 503 so Telnyx retries (plan G2). */
export const CHANGES_CONSENT: ReadonlySet<InboundClass["kind"]> = new Set(["stop", "start", "phrase"]);

export type ConsentReplyPlan = { kind: ReplyKind; language: "en" | "es"; answersEventId?: string };

export type InboundConsentInput = {
  accountId: string;
  /** The sender, E.164 from the carrier. */
  address: string;
  text: string;
  autoresponse: Autoresponse | null;
  /** Telnyx's own string, unparsed, kept beside the parsed value for the record (review — an OTHER spelling must stay legible on the ledger). */
  autoresponseRaw: string | null;
  providerMessageId: string | null;
  messagingProfileId: string | null;
  /** The contact the route filed the text under; null for the alert phone (plan G10). */
  contactId: string | null;
  /** This attempt filed the message; false on Telnyx's retry of one already filed. */
  firstFiling: boolean;
  now: Date;
};

const ACTOR = "sms-inbound";
/** The ledger's own cap on an excerpt (0054's evidence CHECK). */
const EVIDENCE_EXCERPT = 160;
/** What a To-do line quotes. */
const TODO_EXCERPT = 60;

/** At most `max` characters (code points, so an emoji is never split), whitespace collapsed, the cut marked. */
export function excerptOf(text: string, max: number = EVIDENCE_EXCERPT): string {
  const chars = Array.from(text.trim().replace(/\s+/g, " "));
  return chars.length <= max ? chars.join("") : `${chars.slice(0, max - 1).join("")}…`;
}

async function contactLabel(db: SupabaseClient, i: InboundConsentInput): Promise<string> {
  const contact = await getContact(db, i.accountId, i.contactId as string);
  const name = [contact?.first_name, contact?.last_name].filter(Boolean).join(" ").trim();
  return name || i.address;
}

/** Spec §4.2 step 2: a CANCEL with an upcoming appointment asks staff whether the appointment was meant too. */
async function cancelTodo(db: SupabaseClient, i: InboundConsentInput, eventId: string, word: string): Promise<void> {
  const startsAt = await nextBookedStart(db, i.accountId, i.contactId as string, i.now.toISOString());
  if (!startsAt) return;
  const [name, zone] = await Promise.all([contactLabel(db, i), readAccountTimezone(db, i.accountId)]);
  const title = m["todo.consent.cancel.en"]
    .replace("{name}", () => name)
    .replace("{word}", () => keywordDisplay(word))
    .replace("{date}", () => formatDateInZone(startsAt, hoursZone(zone)));
  await ensureConsentTask(db, i.accountId, { contactId: i.contactId as string, consentEventId: eventId, title }, ACTOR, "system");
}

/** Decision 5: a sentence holds texts and asks staff to confirm or undo. */
async function holdTodo(db: SupabaseClient, i: InboundConsentInput, eventId: string): Promise<void> {
  const name = await contactLabel(db, i);
  const title = m["todo.consent.hold.en"]
    .replace("{name}", () => name)
    .replace("{excerpt}", () => excerptOf(i.text, TODO_EXCERPT));
  await ensureConsentTask(db, i.accountId, { contactId: i.contactId as string, consentEventId: eventId, title }, ACTOR, "system");
}

/**
 * Writes what the text means and says which reply BIS owes. THROWS when a
 * stop, a start, a hold or its To-do cannot be written: the route answers 503
 * and Telnyx retries (spec §5). The grant is evidence and never throws.
 */
export async function recordInboundConsent(
  db: SupabaseClient, i: InboundConsentInput, c: InboundClass, owe: (reply: ConsentReplyPlan) => void,
): Promise<void> {
  const base = { accountId: i.accountId, channel: "sms" as const, address: i.address, contactId: i.contactId, sourceRef: i.providerMessageId };
  const excerpt = excerptOf(i.text);

  // Step 6 (decision 8): a first text is a grant. Evidence only (choice 28,
  // choice 29), and never for the alert phone, which is not a customer.
  if (i.contactId !== null) {
    try {
      await appendConsentEventGuarded(db, { ...base, action: "granted", method: "inbound_text", evidence: { excerpt } }, "if_empty");
    } catch (e) {
      console.error(`inbound consent: the first-text grant for account ${i.accountId} was not recorded: ${loggableError(e)}`);
    }
  }

  switch (c.kind) {
    case "stop": {
      const kw = c.keyword;
      const r: ConsentAppend = await appendConsentEventGuarded(db, {
        ...base, action: "revoked", method: kw ? "keyword" : "carrier_block",
        evidence: {
          keyword: kw?.word ?? null, language: kw?.language ?? null, autoresponse_type: i.autoresponse,
          autoresponse_type_raw: i.autoresponseRaw,
          messaging_profile_id: i.messagingProfileId, excerpt,
        },
      }, "unless_customer_stopped");
      if (r.outcome === "refused") return;   // the customer's own stop already stands (danlo 2026-09-28)
      // Owed FIRST, before anything below can throw (review R2-I1a). Not over
      // a staff stop: the texts were already off, so there is nothing to
      // confirm; the new row makes the stop the customer's own (spec S8).
      if (r.outcome === "appended" && kw && i.autoresponse === null && r.prior?.action !== "revoked") {
        owe({ kind: "consent.stop_confirmation", language: kw.language, answersEventId: r.id });
      }
      // Telnyx answered with a spelling BIS does not recognise (review
      // R2-I2): BIS still sends nothing (ANY non-blank value means Telnyx
      // replied), but the ambiguity is on record — never with the
      // customer's own number, which this line has no reason to carry.
      if (i.autoresponse === "OTHER") {
        console.error(`inbound consent: account ${i.accountId}'s stop carries an autoresponse_type BIS reads as OTHER (raw ${JSON.stringify(i.autoresponseRaw)}); BIS is not sending its own confirmation`);
      }
      await closeHoldTodo(db, i, r);
      if (kw && CANCEL_WORDS.has(kw.word) && i.contactId !== null) await cancelTodo(db, i, r.id, kw.word);
      return;
    }
    case "start": {
      const r = await appendConsentEventGuarded(db, {
        ...base, action: "resubscribed", method: "start_keyword",
        evidence: { keyword: c.keyword.word, autoresponse_type: i.autoresponse, messaging_profile_id: i.messagingProfileId },
      }, "if_stopped_or_held");
      if (r.outcome === "appended" && i.autoresponse === null) {
        owe({ kind: "consent.start_confirmation", language: r.prior?.evidence.language === "es" ? "es" : "en" });
      }
      await closeHoldTodo(db, i, r);
      return;
    }
    case "help":
      // No ledger row: HELP changes nothing. The gate refuses a stopped or held address (spec §4.2 step 4).
      if (i.autoresponse === null && i.firstFiling) owe({ kind: "consent.help", language: c.keyword.language });
      return;
    case "phrase": {
      const r = await appendConsentEventGuarded(db, {
        ...base, action: "held", method: "free_text",
        evidence: { phrase: c.phrase.phrase, language: c.phrase.language, excerpt },
      }, "if_allowed");
      if (r.outcome !== "refused" && i.contactId !== null) await holdTodo(db, i, r.id);
      return;   // choice 20: a free-text hold is never confirmed by text
    }
    case "telnyx_only":
      console.error(`inbound consent: Telnyx answered ${c.autoresponse} for account ${i.accountId} to a text BIS's keyword list does not match; nothing recorded`);
      return;
    case "none":
      return;
  }
}
