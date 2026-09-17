import type { serviceDb, Branding, CallOutcome } from "@bis/db";
import {
  createContact, fillContactBlanks, ensureConversation, createMessage, incrementUnreadCount,
  updateMessageStatus, hasRecentOutboundSms, finishCallRow, emit, getAlertPhone,
} from "@bis/db";
import { emailBrand, brandDisplayName } from "@/lib/email/templates/shell";
import { getEmailProvider } from "@/lib/email";
import { voiceCallAlertEmail } from "@/lib/email/templates/voice";
import { getSmsProvider } from "@/lib/sms";
import { resolveSmsSender } from "@/lib/sms/sender";
import { composeCallAlertSms, prepareAlertSms, deliverAlertSms, type PendingAlertSms } from "@/lib/sms/alerts";
import { defaultTextbackBody } from "./textback-body";
import { withOptOut } from "@/lib/sms/opt-out";
import type { CallState } from "./call-state";
import { classifyOutcome, wasServed } from "./call-state";
import { detectSpokenLanguage } from "./language";
import { generateSummary } from "./summary-service";
import { summaryFactLine } from "./summarize";
import { toE164 } from "./phone-number";

/**
 * DELIBERATELY ABSENT: `accountName`. `accounts.name` is the agency's internal
 * label for the company ("Rio Roofing — trial") and it reached a stranger's
 * phone from exactly this context once already. The staff alert and the
 * text-back both resolve the customer-facing name from `branding` alone
 * (`brandDisplayName`), so there is nothing here left to get wrong.
 */
export interface FinishContext {
  db: ReturnType<typeof serviceDb>;
  accountId: string;
  branding: Branding;
  notifyEmails: string[];
  callerNumber: string | null;
  /** Absolute origin ("https://x.example") of the request that ended the
   *  call. Always present — voice runs server-side off Telnyx's webhook, not
   *  off a browser request that might carry no host header. */
  origin: string;
  profileLanguage: "en" | "es" | "both";
  /** IANA zone the account operates in (e.g. "America/Chicago"). Threaded
   *  into generateSummary so the prose states booking times in local form
   *  instead of the raw UTC the booking records carry. */
  timezone: string;
  /** `voice_profiles.textback_enabled` — the per-company missed-call
   *  text-back switch (migration 0024). Off is the shipped default and the
   *  honest one: this sends a text to a real phone with no human in the loop. */
  textbackEnabled: boolean;
  /** `voice_profiles.textback_body`. EMPTY means "use the live default at
   *  send time" — the default is deliberately never persisted, so an operator
   *  who never wrote their own keeps getting the current copy. */
  textbackBody: string;
}

export interface FinishMeta {
  /** The row `startCallRow` created at pickup. Null means the row was never
   *  opened (e.g. the start write itself failed) — there is nothing to
   *  finish, so the row update is skipped entirely rather than attempted
   *  against an id that doesn't exist. */
  callRowId: string | null;
  startedAt: Date;
  endedAt: Date;
}

export interface FinishResult {
  stored: boolean;
  notified: boolean;
  outcome: CallOutcome;
}

// Every write finishCall makes is attributed to the AI, not to whichever
// human happens to own the request context — a voice call has no signed-in
// user, and crediting one would be the same actor_type bug M1b fixed for the
// Resend webhook.
const ACTOR_ID = "voice";
const ACTOR_TYPE = "ai";

/**
 * How long one caller is left alone after a text-back.
 *
 * A repeat abandoned caller would otherwise get a byte-identical message on
 * every call, and repeated identical bodies to one number is exactly what
 * carrier filtering hunts for under 10DLC — with the CLIENT'S OWN A2P
 * registration as the thing that gets blocked, not ours. This is a rate limit,
 * not an opt-out: STOP is enforced upstream at the carrier level by Telnyx,
 * deliberately not reimplemented here.
 *
 * Module-private on purpose. finish-call.test.ts pins the window with its own
 * literal 24h rather than importing this — a test that reads the constant it
 * is checking proves only that multiplication works, and would stay green if
 * someone quietly dropped this to an hour.
 */
const TEXTBACK_COOLDOWN_HOURS = 24;
const TEXTBACK_COOLDOWN_MS = TEXTBACK_COOLDOWN_HOURS * 60 * 60 * 1000;

/**
 * Outcomes worth a human seeing: a durable contact/conversation trail and a
 * staff alert. `abandoned`/`spam` get neither — nobody picks those up, so
 * there is no one to hand off to. (`abandoned` may still get a contact and a
 * conversation from the text-back leg further down, when the account has
 * opted in; that trail exists to hold the text, not to summon a human.)
 *
 * A type predicate (not a plain boolean) so the staff alert SMS leg below
 * can call this directly and get `outcome` narrowed to
 * `composeCallAlertSms`'s own literal union — no cast, and the two alert
 * legs (email above, SMS below) are provably gated on the identical set of
 * outcomes rather than two hand-copies of the same three strings.
 */
function isMeaningful(outcome: CallOutcome): outcome is "booked" | "lead" | "message" {
  return outcome === "booked" || outcome === "lead" || outcome === "message";
}

/** Split on the LAST space, so "Ana Maria Ruiz" keeps "Ana Maria" together
 *  as the first name rather than splitting on the first space. A caller with
 *  no space in their name becomes a first-name-only contact. */
function splitFullName(fullName: string): { firstName: string; lastName?: string } {
  const trimmed = fullName.trim();
  const idx = trimmed.lastIndexOf(" ");
  if (idx === -1) return { firstName: trimmed };
  return { firstName: trimmed.slice(0, idx).trim(), lastName: trimmed.slice(idx + 1).trim() };
}

/**
 * Resolves who this call is about, creating a contact only when the state
 * genuinely has nobody yet.
 *
 * `state.contactId` wins outright — set by an in-call booking or an explicit
 * lookup, it is never second-guessed here. Absent that, a captured lead's
 * fields build a real contact (name split, phone normalized, source
 * "voice"). Absent even a lead, a caller ID still deserves a contact record
 * for the message that follows — that gets the minimal shape, `firstName:
 * "Caller"` plus the number, rather than leaving the conversation orphaned.
 */
async function resolveContactId(state: CallState, ctx: FinishContext): Promise<string | null> {
  if (state.contactId) return state.contactId;

  const lead = state.leads[0];
  if (lead) {
    const fields = lead.fields ?? {};
    const { firstName, lastName } = splitFullName(fields.fullName ?? "");
    const created = await createContact(ctx.db, ctx.accountId, {
      firstName: firstName || "Caller",
      lastName,
      phone: toE164(fields.callbackNumber) ?? ctx.callerNumber ?? undefined,
      email: fields.email,
      source: "voice",
    }, ACTOR_ID, ACTOR_TYPE);
    if (created.existing) {
      try {
        await fillContactBlanks(ctx.db, ctx.accountId, created.id,
          { firstName: firstName || undefined, lastName, email: fields.email,
            phone: toE164(fields.callbackNumber) ?? ctx.callerNumber ?? undefined },
          ACTOR_ID, ACTOR_TYPE);
      } catch (e) {
        console.error(`finishCall fillContactBlanks failed for ${created.id}: ${String(e)}`);
      }
    }
    return created.id;
  }

  if (ctx.callerNumber) {
    const created = await createContact(ctx.db, ctx.accountId, {
      firstName: "Caller",
      phone: ctx.callerNumber,
      source: "voice",
    }, ACTOR_ID, ACTOR_TYPE);
    if (created.existing) {
      try {
        await fillContactBlanks(ctx.db, ctx.accountId, created.id,
          { phone: ctx.callerNumber ?? undefined },
          ACTOR_ID, ACTOR_TYPE);
      } catch (e) {
        console.error(`finishCall fillContactBlanks failed for ${created.id}: ${String(e)}`);
      }
    }
    return created.id;
  }

  return null;
}

/**
 * Runs after hangup and NEVER throws — the caller has already hung up by the
 * time this executes, so there is no request left to fail; a log line is the
 * only alert a bug here can raise (the "CALL LOST" line below is exactly
 * that, for the one failure mode that would otherwise vanish silently: both
 * the durable record and the staff alert missing at once).
 *
 * Four independent legs, each allowed to fail without taking the others
 * down: lead treatment (contact/conversation/message/unread), the staff
 * alert, the missed-call text-back, and the row write. A DB outage that
 * breaks the first and last still leaves the alert as the one surviving
 * signal a human sees; an email outage still leaves the row for the
 * dashboard; a carrier outage costs the abandoned caller their text and
 * nothing else.
 *
 * The text-back leg is deliberately SPLIT around the row write: its database
 * work runs before (the row records the contact and conversation the text
 * lives in, so those ids have to exist first), its carrier send runs after.
 * Ordering by cost, not by leg — a 10-second provider call ahead of the
 * durable record is how a slow carrier loses the call row on an invocation
 * running out of maxDuration. That is not the default case today (the voice
 * route's ceiling is 800s against a 240s call cap), but it is exactly the
 * case whenever an operator raises `PHONE_MAX_CALL_SECONDS` toward the
 * route's 750s clamp, so the ordering is not something the upgrade retires.
 */
export async function finishCall(
  state: CallState, ctx: FinishContext, meta: FinishMeta,
): Promise<FinishResult> {
  const outcome = classifyOutcome(state);
  const meaningful = isMeaningful(outcome);
  // Computed once, read twice: the `calls.language` column below, and the
  // language the missed-call text-back answers in. Deliberately the SAME
  // value — a caller the Calls page labels "Spanish" who then receives an
  // English text is the platform contradicting itself in front of the
  // customer, and two separate derivations is how that starts.
  const spokenLanguage = detectSpokenLanguage(state.transcript, ctx.profileLanguage);

  let summary: string;
  try {
    summary = await generateSummary(state, { timezone: ctx.timezone });
  } catch (e) {
    console.error(`finishCall: generateSummary failed, falling back to fact line: ${String(e)}`);
    summary = summaryFactLine(state);
  }

  // One try around the whole lead-treatment block (contact → conversation →
  // message → unread count): a failure partway through — say the contact
  // gets created but the conversation lookup then throws — must not repeat
  // any step above it on a hypothetical retry (there is none) and must not
  // suppress the staff alert below. Losing the CRM trail is recoverable from
  // the transcript in the row; losing the ONLY notification a human gets is
  // not, so the two are never allowed to share a failure.
  let contactId: string | null = null;
  let conversationId: string | null = null;
  if (meaningful) {
    try {
      contactId = await resolveContactId(state, ctx);
      if (contactId) {
        const conversation = await ensureConversation(ctx.db, ctx.accountId, contactId, ACTOR_ID, ACTOR_TYPE);
        conversationId = conversation.id;
        await createMessage(ctx.db, ctx.accountId, {
          conversationId, channel: "voice", direction: "inbound",
          subject: "Phone call", body: summary,
        }, ACTOR_ID, ACTOR_TYPE);
        await incrementUnreadCount(ctx.db, ctx.accountId, conversationId);
      }
    } catch (e) {
      console.error(`finishCall ${meta.callRowId ?? "(no row)"}: lead treatment failed: ${String(e)}`);
    }
  }

  // The staff alert, same outcomes only. Deliberately NOT inside the lead-
  // treatment try above (and not gated on it succeeding) — this is the one
  // channel a human is guaranteed to see, so a CRM-side failure must never
  // cost the call its notification.
  let notified = false;
  if (meaningful) {
    try {
      const callerDisplay = ctx.callerNumber ?? "Unknown caller";
      const brand = emailBrand(ctx.branding);
      const contactUrl = contactId
        ? `${ctx.origin}/dashboard/accounts/${ctx.accountId}/contacts/${contactId}`
        : null;
      const { html, text } = voiceCallAlertEmail({ brand, outcome, summary, callerDisplay, contactUrl });
      const provider = getEmailProvider();

      const failures: string[] = [];
      for (const to of ctx.notifyEmails) {
        try {
          // No fromAddress: same deliverability reasoning as the booking/lead
          // alerts — this goes to the CLIENT'S OWN staff, and a client-domain-
          // to-client-domain send through a third-party sender is the shape
          // corporate filters treat as spoofing. Platform From only.
          await provider.send({ to, fromName: brand.name, subject: `Call — ${outcome} — ${callerDisplay}`, body: text, html });
          notified = true;
        } catch (e) {
          failures.push(`${to} (${e instanceof Error ? e.message : String(e)})`);
        }
      }
      if (failures.length > 0) {
        console.error(`finishCall ${meta.callRowId ?? "(no row)"}: alert send failed for ${failures.join(", ")}`);
      }
    } catch (e) {
      // getEmailProvider() throws synchronously when RESEND_API_KEY or
      // EMAIL_FROM is missing or rotated in production (see @/lib/email/preflight).
      // An outer catch keeps config failure from violating never-throws.
      // Same fix as apps/web/src/app/b/[publicId]/actions.ts.
      console.error(`finishCall ${meta.callRowId ?? "(no row)"}: staff alert setup failed: ${String(e)}`);
    }
  }

  // The staff alert's SMS twin — ALONGSIDE the email above, never instead
  // (danlo, 2026-09-15). Its own leg, own try/catch, independent of the
  // email alert's: an email outage above must not cost the account its
  // text, and a carrier outage here must not cost the call its email. Gated
  // on `isMeaningful(outcome)` called directly (not the pre-computed
  // `meaningful` local) so `outcome` narrows to `composeCallAlertSms`'s own
  // literal union with no cast — matching the email alert's gate exactly,
  // per the brief.
  //
  // `ctx.notifyEmails.length > 0` tells `composeCallAlertSms` whether it may
  // promise "check your email" — an account with no notify emails never got
  // one from the block above, and the text used to claim it regardless
  // (alert-send-report follow-up review, finding 3).
  //
  // Only the PREPARE half — `getAlertPhone` and `prepareAlertSms`'s gate/
  // loop-guard reads — runs here. The carrier POST is deliberately held
  // until after `finishCallRow` below, mirroring the missed-call text-back's
  // own split around the same row write and for the identical reason
  // (finding 4): a 10-second provider call ahead of the durable call row is
  // how a slow carrier loses that row on an invocation running out of
  // budget. `sendAlertSms` (used unchanged by `app/b/[publicId]/actions.ts`,
  // which has no such ordering constraint) is `prepareAlertSms` immediately
  // followed by `deliverAlertSms`; this leg calls the two halves separately.
  let pendingAlertSms: PendingAlertSms | null = null;
  if (isMeaningful(outcome)) {
    try {
      const alertPhone = await getAlertPhone(ctx.db, ctx.accountId);
      pendingAlertSms = await prepareAlertSms(
        ctx.db, ctx.accountId, alertPhone,
        composeCallAlertSms(outcome, ctx.notifyEmails.length > 0),
      );
    } catch (e) {
      console.error(`finishCall ${meta.callRowId ?? "(no row)"}: alert SMS prepare failed: ${String(e)}`);
    }
  }

  // Fourth leg: the missed-call text-back. Its own try/catch for the same
  // reason as the three around it — finishCall is contractually never-throws,
  // because the caller has already hung up and there is nobody for a
  // rejection to reach. Both things in here that throw on CONFIGURATION alone
  // sit inside that catch on purpose: resolveSmsSender throws on a
  // phone_numbers read error, and getSmsProvider() throws synchronously when
  // TELNYX_API_KEY is missing in production — which is production's state as
  // this ships. Neither may cost the call its row.
  //
  // `abandoned` ONLY: classifyOutcome returns it when the caller actually
  // SPOKE, while a call with no caller speech is `spam`. That distinction is
  // what keeps silent robocalls out of the CRM by classification rather than
  // by rule, and it is why creating a contact here is acceptable at all.
  //
  // ...but `abandoned` is not the same question as "did we fail this caller".
  // A caller who rang in purely to CANCEL, or to check what time their
  // appointment is, leaves no booking, no lead and no message behind — and
  // for a booking made on an earlier call, not even a mirrored cancellation
  // (call-state.ts's `withBookingCancelled` maps over an array that is
  // empty). Those calls classify `abandoned` and were getting an automatic,
  // unretractable "Sorry we missed you just now" for a call that went
  // perfectly. `wasServed` is the second half of the gate, and it is
  // deliberately a separate flag rather than a new classifyOutcome value:
  // that value feeds the calls list, the outcome pill and the dashboard KPIs,
  // and re-labelling cancellation calls there is a product decision this
  // change is not entitled to make.
  //
  // SPLIT IN TWO around the row write below. Everything the call row itself
  // needs — the contact, the conversation, and the outbound message row —
  // happens here, because `finishCallRow` writes those ids and cannot write
  // ids that do not exist yet. The PROVIDER SEND does not belong to that set:
  // it is a network call to a carrier with a 10-second timeout, made inside
  // an invocation whose remaining `maxDuration` budget is whatever the call
  // cap left behind — comfortable at the default 240s cap under the route's
  // 800s ceiling, and nearly nothing once an operator raises
  // `PHONE_MAX_CALL_SECONDS` toward its 750s clamp — and running it ahead of
  // the durable record meant a long abandoned call plus a slow carrier could
  // lose the call row entirely — the row the entire dashboard reads. So this half prepares the send, and the half below `finishCallRow`
  // performs it. Write-then-send is preserved exactly as before: the message
  // row still exists before anything leaves the building.
  let pendingTextback: { messageId: string; to: string; from: string; body: string } | null = null;
  if (outcome === "abandoned" && !wasServed(state) && ctx.textbackEnabled && ctx.callerNumber) {
    try {
      // THE gate, and the only one — the same call the composer makes, never
      // re-derived (lib/sms/sender.ts). Consulted BEFORE any row is written,
      // so an account that is not cleared to text does not quietly accumulate
      // contacts and conversations for callers it can never reach.
      const gate = await resolveSmsSender(ctx.db, ctx.accountId);
      if (gate.ok) {
        // brandDisplayName, the ONE customer-facing name rule: this text is
        // signed and it goes to the client's CUSTOMER. `accounts.name` is the
        // agency's internal label for the company ("Rio Roofing — trial") —
        // the same column that was reaching the email From line before M4d —
        // and its em dash is outside GSM-7, so sending it also silently
        // doubles the message to two segments. The resolver takes the
        // branding and nothing else now, and `FinishContext` no longer
        // carries the label at all, so neither this line nor the staff alert
        // one leg up has anything to reach for.
        //
        // `spokenLanguage`, so a caller who spoke Spanish to Sofía is
        // answered in Spanish. Only the DEFAULT is chosen this way: an
        // operator's own body is sent exactly as they wrote it, never
        // translated — they chose those words for their own customers.
        //
        // withOptOut wraps BOTH branches, the operator's own body included.
        // That is deliberate and is the one place this platform overrides an
        // operator's exact words: the disclosure is not a style choice, it is
        // what CTIA requires of a programme message and what the A2P campaign
        // samples are checked against. It is idempotent, so an operator who
        // already wrote "Reply STOP to opt out" keeps their own wording and
        // gets nothing appended. Applied HERE, where the body is built, so
        // the message row below records the text that actually went out.
        const body = withOptOut(
          ctx.textbackBody.trim()
            || defaultTextbackBody(brandDisplayName(ctx.branding), spokenLanguage),
          spokenLanguage,
        );

        // resolveContactId, not createContact: it honours a contact the call
        // already established and backfills blanks on a dedupe hit. An
        // abandoned call has no lead and no contactId, so it lands on the
        // caller-ID branch — exactly the minimal "Caller" + number record
        // this leg wants, without a second copy of that logic.
        //
        // Assigned to the OUTER contactId/conversationId rather than shadowed:
        // this leg runs before the row write below, so the call row ends up
        // pointing at the contact and conversation the text lives in. Without
        // that, an abandoned call keeps writing the nulls it always has and
        // there is no path from the call to the text it sent — nothing for the
        // dashboard, or for a failed text-back, to join on.
        contactId = await resolveContactId(state, ctx);
        if (contactId) {
          const conversation = await ensureConversation(ctx.db, ctx.accountId, contactId, ACTOR_ID, ACTOR_TYPE);
          conversationId = conversation.id;

          // The cooldown, consulted AFTER the conversation exists (that is what
          // "this caller" is keyed on) and BEFORE the message row is written,
          // so a suppressed text-back writes no row and sends nothing — an
          // outbound row nobody sent would be a lie in the operator's inbox.
          // The contact and conversation resolved above are still handed to
          // the call row below, so a suppressed call is not orphaned.
          const since = new Date(Date.now() - TEXTBACK_COOLDOWN_MS);
          if (await hasRecentOutboundSms(ctx.db, ctx.accountId, conversationId, since)) {
            // Logged, not thrown, and at the same console.error level as every
            // other diagnostic in this function: suppression is the feature
            // working, not a failure, but it is also the ONLY trace a caller
            // who expected a text and did not get one leaves anywhere.
            console.error(
              `finishCall ${meta.callRowId ?? "(no row)"}: text-back suppressed — ` +
              `conversation ${conversationId} already had an outbound SMS ` +
              `within ${TEXTBACK_COOLDOWN_HOURS}h`,
            );
          } else {
            // WRITE THEN SEND, same ordering and same reason as sendSmsAction:
            // the row exists before anything leaves the building, so a provider
            // failure is a visible message rather than a silent gap. No unread
            // bump — this text is OURS, and unread counts inbound.
            const { id: messageId } = await createMessage(ctx.db, ctx.accountId, {
              conversationId, channel: "sms", direction: "outbound", body,
            }, ACTOR_ID, ACTOR_TYPE);
            pendingTextback = { messageId, to: ctx.callerNumber, from: gate.from, body };
          }
        }
      }
    } catch (e) {
      console.error(`finishCall ${meta.callRowId ?? "(no row)"}: text-back failed: ${String(e)}`);
    }
  }

  // The durable row. Its own try/catch, independent of both legs above — a
  // DB outage here must not un-send an alert already on the wire, and must
  // not roll back a contact/message already written.
  let stored = false;
  if (meta.callRowId) {
    try {
      const bookingId = state.bookings.find((b) => b.status === "booked")?.id;
      await finishCallRow(ctx.db, ctx.accountId, meta.callRowId, {
        outcome,
        endedAt: meta.endedAt,
        durationSecs: Math.max(0, Math.round((meta.endedAt.getTime() - meta.startedAt.getTime()) / 1000)),
        turnCount: state.transcript.length,
        transcript: state.transcript,
        summary,
        language: spokenLanguage,
        contactId: contactId ?? undefined,
        conversationId: conversationId ?? undefined,
        bookingId,
      });
      stored = true;
    } catch (e) {
      console.error(`finishCall ${meta.callRowId}: finishCallRow failed: ${String(e)}`);
    }
  }

  // The other half of the staff alert SMS leg: the actual carrier POST,
  // deliberately AFTER the durable row above — same ordering, same reason as
  // the text-back's own split just below (finding 4, alert-send-report
  // follow-up review). `deliverAlertSms` never throws by contract (its own
  // doc, @/lib/sms/alerts) but this try/catch stays anyway, the same
  // defense-in-depth every other leg in this function carries.
  if (pendingAlertSms) {
    try {
      await deliverAlertSms(ctx.accountId, pendingAlertSms);
    } catch (e) {
      console.error(`finishCall ${meta.callRowId ?? "(no row)"}: alert SMS deliver failed: ${String(e)}`);
    }
  }

  // The other half of the text-back leg: the actual send, deliberately AFTER
  // the durable row above. Everything before this point is database work
  // measured in milliseconds; this is a carrier round trip with a 10-second
  // timeout, inside an invocation that may or may not have budget left — the
  // voice route's 800s `maxDuration` leaves plenty at the default 240s call
  // cap, and almost none if `PHONE_MAX_CALL_SECONDS` is ever raised toward
  // the route's 750s clamp, which is the case this ordering is written for.
  // Ahead of the row write it was a way to lose the call record itself, which
  // is the one artefact of the call the dashboard, the KPIs and any later
  // investigation all read. The text is worth less than the record of the
  // call, so it goes second.
  //
  // Same try/catch contract as every other leg — finishCall never throws —
  // and the same two things that throw on CONFIGURATION alone still sit
  // inside it: getSmsProvider() throws synchronously when TELNYX_API_KEY is
  // missing in production, and it is called here, inside the inner try, so a
  // config failure still marks the message `failed` exactly as a carrier
  // failure does.
  if (pendingTextback) {
    const { messageId, to, from, body } = pendingTextback;
    try {
      // ONLY the send is guarded. Once send() has returned, the text is gone
      // and irrevocably out the door, so a failure recording that — the `sent`
      // write below — must never be re-labelled `failed`: that would tell the
      // operator a delivered text never went out, and drop the provider id the
      // delivery webhook correlates against. That failure falls through to the
      // outer catch instead, where it is logged and the message is left
      // exactly as written. Identical reasoning to sendSmsAction
      // (conversations/actions.ts).
      let providerMessageId: string;
      try {
        ({ providerMessageId } = await getSmsProvider().send({ to, from, body }));
      } catch (sendError) {
        // Nothing left the building, so `failed` is the honest label — and it
        // is the only signal this failure has, since there is no retry and no
        // human watching.
        //
        // Its own try/catch, because this write is BOOKKEEPING and `sendError`
        // is the news. Awaited bare, a rejection here would replace the throw
        // below entirely: the outer catch would log a database error, the
        // genuine carrier failure would vanish, and the row would sit `queued`
        // with nothing saying why. The original error survives its own
        // bookkeeping either way.
        try {
          await updateMessageStatus(ctx.db, ctx.accountId, messageId, "failed",
            { error: sendError instanceof Error ? sendError.message : "unknown send failure" },
            ACTOR_ID, ACTOR_TYPE);
        } catch (statusError) {
          console.error(
            `finishCall ${meta.callRowId ?? "(no row)"}: could not mark message ` +
            `${messageId} failed: ${String(statusError)}`,
          );
        }
        throw sendError;
      }
      await updateMessageStatus(ctx.db, ctx.accountId, messageId, "sent",
        { providerMessageId }, ACTOR_ID, ACTOR_TYPE);
    } catch (e) {
      console.error(`finishCall ${meta.callRowId ?? "(no row)"}: text-back failed: ${String(e)}`);
    }
  }

  // The one failure mode with no other trace anywhere: a real booked/lead/
  // message call that landed neither in the database nor in anyone's inbox.
  // This log line IS the alert for that case (see the function doc) — it
  // must fire even though nothing above threw.
  if (meaningful && !stored && !notified) {
    console.error(
      `CALL LOST — account ${ctx.accountId} call ${meta.callRowId ?? "(no row)"} outcome "${outcome}": ` +
      `neither the row nor the staff alert reached anyone. Summary: ${summary}`,
    );
  }

  // Best-effort, deliberately after everything above (including the CALL
  // LOST check): the activity feed is a convenience, not a channel anyone is
  // relying on to learn a call happened.
  try {
    await emit(ctx.db, ctx.accountId, "call.recorded", ACTOR_ID, { callId: meta.callRowId, outcome }, ACTOR_TYPE);
  } catch (e) {
    console.error(`finishCall ${meta.callRowId ?? "(no row)"}: emit failed: ${String(e)}`);
  }

  return { stored, notified, outcome };
}
