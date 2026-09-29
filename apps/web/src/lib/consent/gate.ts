import {
  readConsentState, recordCarrierBlock, readPhoneCountryFlag, readAccountTimezone, type SupabaseClient,
} from "@bis/db";
import { normalisePhone } from "@bis/db/phone";
import { getSmsProvider } from "@/lib/sms";
import { SmsProviderError, type SmsProvider } from "@/lib/sms/types";
import { resolveSmsSender } from "@/lib/sms/sender";
import { withOptOut } from "@/lib/sms/opt-out";
import { segmentsFor } from "@/lib/sms/segments";
import { smsBillable } from "@/lib/billing/usage";
import { loggableError } from "@/lib/loggable-error";
import { SMS_KINDS, isSmsKind, type SmsKind } from "./classes";
import { nextOpening, expiresBeforeOpening, hoursZone } from "./hours";

/**
 * THE SEND GATE (consent chain spec §4.1 item 3). The only module outside
 * lib/sms's own provider files that may reach an SMS provider (source scan
 * 1, scans.test.ts). Every text the platform sends — automations, the
 * missed-call text-back, the composer, staff alerts, the alert-phone code —
 * comes through `sendSms`, or through `decideSms` then `deliverSms` where a
 * caller must write a durable row between the decision and the carrier
 * round trip (the text-back, the call alert).
 *
 * The steps, in the spec's order:
 *   1. a kind missing from the registry THROWS (a programming error);
 *   2. `to` is normalised (F-009); nothing textable → blocked `no_number`;
 *   3. `resolveSmsSender`: A2P approved and a live number, else blocked
 *      with its reason (its own read error THROWS, as it always has, into
 *      each caller's existing catch);
 *   4. the ledger: stopped → blocked `stopped`, held → blocked `held` —
 *      except `consent.stop_confirmation`, the one send let through a
 *      stopped address, and only when it answers the newest `revoked` row
 *      and that row is under five minutes old (`answersStop`);
 *   5. an unconfirmed number (the normalisation said so, or the contact's
 *      `phone_country_unconfirmed`, unless the number came from the carrier)
 *      → blocked `unconfirmed_number`;
 *   6. the kind's hours: outside them → `deferred` until they open, unless
 *      the deadline falls first (choice 21) → blocked `window_after_deadline`;
 *   7. the kind's footer;
 *   8. the provider;
 *   9. a refusal whose code says the number opted out (Telnyx 40300,
 *      VERIFIED from Telnyx's docs, see the plan) appends `revoked` /
 *      `carrier_block` to the ledger — never for a provider redirected to a
 *      developer's phone, whose refusal is about THAT number.
 *
 * FAILS CLOSED: a ledger, flag or ZONE read error is blocked
 * `ledger_unavailable`, logged through `loggableError`, never a send. (A
 * zone that was read but cannot be resolved still takes the fallback zone:
 * that is the account's data, not an outage.)
 */
export type SmsRequest = {
  accountId: string;
  kind: SmsKind;
  /** The number as stored or typed. The gate normalises it (step 2). */
  to: string | null | undefined;
  body: string;
  contactId?: string | null;
  /** The body's language; it picks the footer's. English by default. */
  language?: "en" | "es";
  /** Choice 21: the latest instant this send is still useful. */
  deadline?: Date | null;
  /** The contact's own zone. BIS stores none yet (§4.1 item 2), so null. */
  contactZone?: string | null;
  /** The account's zone when the caller has it. `undefined` → the gate
   *  reads `accounts.timezone` (only for a kind that has hours). */
  accountZone?: string | null;
  /** The instant the hours are judged at. Passes hand in their tick's `now`. */
  now?: Date;
  /** `to` came from the carrier (a caller ID), not from a person: it is
   *  already E.164 and says its own country, so the contact's stored
   *  `phone_country_unconfirmed` (about the phone a person TYPED) does not
   *  hold it. The text-back sets this. */
  numberFromCarrier?: boolean;
  /** `consent.stop_confirmation` only: the id of the `revoked` row it answers.
   *  The gate lets that one kind through a stopped address only when this
   *  row is still the newest deciding row and under five minutes old (spec
   *  §4.2). Only lib/consent/replies.ts sets it (source scan). */
  answersEventId?: string;
};

export type SmsBlockReason =
  | "no_number" | "a2p_not_approved" | "no_live_number" | "stopped" | "held"
  | "unconfirmed_number" | "window_after_deadline" | "ledger_unavailable"
  /** A stop confirmation for an address that is no longer stopped (a START
   *  landed first): "you won't get any more texts" would be false. */
  | "stop_confirmation_stale";

/** Spec §4.2: the one stop confirmation goes within five minutes of the stop
 *  (today's 47 CFR 64.1200(a)(12) presumes a confirmation sent within five
 *  minutes is consented, choice 18). */
export const STOP_CONFIRMATION_WINDOW_MS = 5 * 60 * 1000;

/** How far into the future `since` may read and still count as "now-ish":
 *  ordinary clock skew between whatever wrote the ledger row and this
 *  process, not a sign the row is lying about when the stop happened. A
 *  `since` further ahead than this is wrong data, not skew, and must not
 *  read as freshly answered (review, fix round 1). */
const CLOCK_SKEW_ALLOWANCE_MS = 60_000;

/** Does a stop confirmation answer THIS stop: the newest row, still young? Pure. */
export function answersStop(
  state: { eventId: string; since: string }, answersEventId: string | null, now: Date,
): boolean {
  if (answersEventId === null || state.eventId !== answersEventId) return false;
  const age = now.getTime() - Date.parse(state.since);
  if (!Number.isFinite(age)) return false;
  return age >= -CLOCK_SKEW_ALLOWANCE_MS && age < STOP_CONFIRMATION_WINDOW_MS;
}

const CLEARED: unique symbol = Symbol("cleared-sms");

/** A send `decideSms` cleared. Only this module can make one. */
export type ClearedSms = {
  readonly [CLEARED]: true;
  readonly accountId: string;
  readonly kind: SmsKind;
  readonly to: string;
  readonly from: string;
  /** The body exactly as it will be sent, footer included. */
  readonly body: string;
  readonly contactId: string | null;
  readonly numberFromCarrier: boolean;
  /** The stop this confirmation answers, for the deliver re-check. */
  readonly answersEventId: string | null;
};

export type SmsDecision =
  | { kind: "clear"; send: ClearedSms }
  /** Outside the kind's hours: `until` is when they open, `zone` the one
   *  they were read in (a held row says "Held until 8:00 AM" in it). */
  | { kind: "deferred"; until: Date; zone: string }
  | { kind: "blocked"; reason: SmsBlockReason };

export type SmsSendOptions = {
  /** Runs once the send is cleared and a provider is in hand, with the text
   *  exactly as it will leave. Write-then-send callers write their message
   *  row here. A throw aborts the send: nothing leaves. */
  prepare?: (cleared: { body: string; to: string; from: string }) => Promise<void>;
};

export type SmsSendResult =
  | { kind: "sent"; providerMessageId: string; to: string; from: string; body: string; billable: boolean; segments: number }
  /** Outside the kind's hours: `until` is when they open, `zone` the one
   *  they were read in (a held row says "Held until 8:00 AM" in it). */
  | { kind: "deferred"; until: Date; zone: string }
  | { kind: "blocked"; reason: SmsBlockReason }
  | { kind: "failed"; stage: "provider_unavailable" | "prepare" | "provider"; error: string; carrierBlocked: boolean };

export type SmsSender = (req: SmsRequest, opts?: SmsSendOptions) => Promise<SmsSendResult>;

/** Steps 4 and 5's reads. Null = allowed; a reason = blocked. */
async function consentBlock(
  db: SupabaseClient, accountId: string, kind: SmsKind, address: string, contactId: string | null,
  numberFromCarrier: boolean, answersEventId: string | null, now: Date,
): Promise<SmsBlockReason | null> {
  try {
    const state = await readConsentState(db, accountId, "sms", address);
    if (kind === "consent.stop_confirmation") {
      // The one send a stopped address may get (spec §4.2), and ONLY there.
      if (state.state === "held") return "held";
      if (state.state !== "stopped") return "stop_confirmation_stale";
      if (!answersStop(state, answersEventId, now)) return "stopped";
    } else {
      if (state.state === "stopped") return "stopped";
      if (state.state === "held") return "held";
    }
    if (contactId && !numberFromCarrier && await readPhoneCountryFlag(db, accountId, contactId)) return "unconfirmed_number";
    return null;
  } catch (e) {
    console.error(`consent gate: ${kind} for account ${accountId} blocked, consent state unreadable: ${loggableError(e)}`);
    return "ledger_unavailable";
  }
}

export async function decideSms(db: SupabaseClient, req: SmsRequest): Promise<SmsDecision> {
  if (!isSmsKind(req.kind)) throw new Error(`consent gate: unknown SMS kind "${String(req.kind)}"`);
  const spec = SMS_KINDS[req.kind];
  const number = normalisePhone(req.to);
  if (!number) return { kind: "blocked", reason: "no_number" };

  const sender = await resolveSmsSender(db, req.accountId);
  if (!sender.ok) return { kind: "blocked", reason: sender.reason };

  const contactId = req.contactId ?? null;
  const fromCarrier = req.numberFromCarrier === true;
  const answersEventId = req.answersEventId ?? null;
  const blocked = await consentBlock(db, req.accountId, req.kind, number.e164, contactId, fromCarrier, answersEventId, req.now ?? new Date());
  if (blocked) return { kind: "blocked", reason: blocked };
  if (number.unconfirmed) return { kind: "blocked", reason: "unconfirmed_number" };

  if (spec.hours !== "any") {
    let zone = req.contactZone ?? null;
    if (!zone) {
      try {
        zone = req.accountZone !== undefined ? req.accountZone : await readAccountTimezone(db, req.accountId);
      } catch (e) {
        // FAILS CLOSED (review R1-I2): the fallback zone is America/Chicago,
        // and 08:00 there is 1-5 hours early for a Pacific, Mountain, Alaska
        // or Hawaii account. An outage is not a zone.
        console.error(`consent gate: ${req.kind} for account ${req.accountId} blocked, zone unreadable: ${loggableError(e)}`);
        return { kind: "blocked", reason: "ledger_unavailable" };
      }
    }
    const opening = nextOpening(spec.hours, req.now ?? new Date(), zone);
    if (expiresBeforeOpening(opening, req.deadline)) return { kind: "blocked", reason: "window_after_deadline" };
    if (opening) return { kind: "deferred", until: opening, zone: hoursZone(zone) };
  }

  const body = spec.footer === "stop_line" ? withOptOut(req.body, req.language) : req.body;
  return {
    kind: "clear",
    send: { [CLEARED]: true, accountId: req.accountId, kind: req.kind, to: number.e164, from: sender.from, body, contactId, numberFromCarrier: fromCarrier, answersEventId },
  };
}

async function deliver(
  db: SupabaseClient, cleared: ClearedSms, opts: SmsSendOptions, recheck: boolean,
): Promise<SmsSendResult> {
  // The CLEARED brand is never checked at runtime otherwise, so a forged
  // `{...} as unknown as ClearedSms` would skip A2P, the ledger, the hours
  // and the footer entirely — only `decideSms` may mint one.
  if (cleared?.[CLEARED] !== true) throw new Error("deliverSms: not a decision the gate cleared");
  if (recheck) {
    const blocked = await consentBlock(db, cleared.accountId, cleared.kind, cleared.to, cleared.contactId, cleared.numberFromCarrier, cleared.answersEventId, new Date());
    if (blocked) return { kind: "blocked", reason: blocked };
  }
  let provider: SmsProvider;
  try {
    provider = getSmsProvider();
  } catch (e) {
    return { kind: "failed", stage: "provider_unavailable", error: e instanceof Error ? e.message : String(e), carrierBlocked: false };
  }
  const { to, from, body } = cleared;
  try {
    await opts.prepare?.({ body, to, from });
  } catch (e) {
    return { kind: "failed", stage: "prepare", error: e instanceof Error ? e.message : String(e), carrierBlocked: false };
  }
  let providerMessageId: string;
  try {
    ({ providerMessageId } = await provider.send({ to, from, body }));
  } catch (e) {
    const carrierBlocked = e instanceof SmsProviderError && e.codes.includes("40300") && provider.redirectTo === undefined;
    if (carrierBlocked) {
      try {
        await recordCarrierBlock(db, { accountId: cleared.accountId, address: to, contactId: cleared.contactId, kind: cleared.kind });
      } catch (writeErr) {
        console.error(`consent gate: carrier block for account ${cleared.accountId} not recorded: ${loggableError(writeErr)}`);
      }
    }
    return { kind: "failed", stage: "provider", error: e instanceof Error ? e.message : String(e), carrierBlocked };
  }
  // AFTER the send's try, never inside it: the text is out, and nothing
  // about its usage may turn it into a `failed` (a caller would mark its row
  // failed and a retry would text the customer twice).
  return { kind: "sent", providerMessageId, to, from, body, ...usageOf(provider, body, cleared.accountId) };
}

/** What a delivered text bills. Never throws: a counting bug loses one text's usage, logged. */
function usageOf(provider: SmsProvider, body: string, accountId: string): { billable: boolean; segments: number } {
  try {
    return { billable: smsBillable(provider), segments: segmentsFor(body).segments };
  } catch (e) {
    console.error(`consent gate: usage not worked out for a text on account ${accountId}, so it will not bill: ${loggableError(e)}`);
    return { billable: false, segments: 0 };
  }
}

/** The second half, for a caller that wrote a durable row after `decideSms`.
 *  Re-reads the ledger first: a stop that landed in between still wins. */
export function deliverSms(db: SupabaseClient, cleared: ClearedSms, opts: SmsSendOptions = {}): Promise<SmsSendResult> {
  return deliver(db, cleared, opts, true);
}

/** Decide and deliver in one call: every path without a row to write in between. */
export async function sendSms(db: SupabaseClient, req: SmsRequest, opts: SmsSendOptions = {}): Promise<SmsSendResult> {
  const decision = await decideSms(db, req);
  if (decision.kind !== "clear") return decision;
  return deliver(db, decision.send, opts, false);
}

/** `sendSms` bound to one client: what a cron tick's `ctx.sms` is (harness.ts). */
export function smsSenderFor(db: SupabaseClient): SmsSender {
  return (req, opts) => sendSms(db, req, opts);
}
